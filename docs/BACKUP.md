# Backup

Ein nicht-getestetes Backup ist kein Backup. **Mache regelmäßige Restore-Tests.**

Du brauchst zwei Backup-Streams:

1. **Postgres** – die Anwendungsdatenbank (User, Galerien, Permissions, Subscriptions)
2. **S3-Bucket** – die eigentlichen Bild- und Videodateien

Plus optional `redis_data` (Job-Queue, kann verloren gehen – nur in-flight Jobs sind weg) und `caddy_data` (TLS-Certs, lassen sich neu holen).

---

## Quick-Setup: tägliches Postgres-Backup lokal

Auf dem Server:

```bash
mkdir -p /backup/lumio
chmod 700 /backup
```

In Crontab (`crontab -e`):

```cron
0 3 * * * cd /opt/docker/lumio && /usr/bin/docker compose exec -T postgres pg_dump -U lumio lumio | gzip > /backup/lumio/db-$(date +\%Y\%m\%d).sql.gz 2>>/var/log/lumio-backup.log

# Alte Backups nach 14 Tagen wegputzen
0 4 * * * find /backup/lumio -name "db-*.sql.gz" -mtime +14 -delete
```

Das reicht für lokales Disaster-Recovery. **Aber das ist auf demselben Server** – wenn der ausfällt, sind auch die Backups weg.

---

## Production-Setup: extern mit restic

`restic` macht inkrementelle, deduplicated, verschlüsselte Backups. Idealer Begleiter zu S3-kompatiblem Storage.

### Installation

```bash
apt install -y restic
```

### Repository initialisieren

Backup-Ziel: ein **zweiter Bucket** (NICHT der gleiche wie dein Lumio-Bucket! Sonst Single-Point-of-Failure). Beispiel mit Hetzner Object Storage:

```bash
export AWS_ACCESS_KEY_ID="<backup-bucket-key>"
export AWS_SECRET_ACCESS_KEY="<backup-bucket-secret>"
export RESTIC_REPOSITORY="s3:https://fsn1.your-objectstorage.com/lumio-backups"
export RESTIC_PASSWORD="<langer-zufalliger-string>"

restic init
```

**Wichtig:** das `RESTIC_PASSWORD` ist der einzige Weg, dein Backup zu entschlüsseln. Wenn du es verlierst, ist das Backup tot. **Speichere es in einem Password-Manager auf einem anderen Gerät.**

### Backup-Script

```bash
nano /usr/local/bin/lumio-backup.sh
```

```bash
#!/bin/bash
set -e

export AWS_ACCESS_KEY_ID="<backup-bucket-key>"
export AWS_SECRET_ACCESS_KEY="<backup-bucket-secret>"
export RESTIC_REPOSITORY="s3:https://fsn1.your-objectstorage.com/lumio-backups"
export RESTIC_PASSWORD_FILE="/root/.restic-pwd"

LUMIO_DIR=/opt/docker/lumio
DUMP_DIR=/tmp/lumio-dump-$$

mkdir -p "$DUMP_DIR"
trap "rm -rf $DUMP_DIR" EXIT

# 1. Postgres-Dump
cd "$LUMIO_DIR"
docker compose exec -T postgres pg_dump -U lumio lumio -Fc -Z 9 \
  > "$DUMP_DIR/lumio.dump"

# 2. .env (sicher: nur lesen, nicht ändern)
cp "$LUMIO_DIR/.env" "$DUMP_DIR/env"

# 3. Backup hochladen
restic backup "$DUMP_DIR" --tag scheduled --host lumio-prod

# 4. Rotation: behalten 7 Daily, 4 Weekly, 6 Monthly
restic forget --keep-daily 7 --keep-weekly 4 --keep-monthly 6 --prune

# 5. Integrität gelegentlich prüfen (alle 7 Tage)
if [ $(date +%u) -eq 1 ]; then
  restic check --read-data-subset=5%
fi
```

```bash
echo "<dein-restic-password>" > /root/.restic-pwd
chmod 600 /root/.restic-pwd
chmod +x /usr/local/bin/lumio-backup.sh
```

### Crontab

```cron
0 3 * * * /usr/local/bin/lumio-backup.sh >> /var/log/lumio-backup.log 2>&1
```

### Auf E-Mail-Benachrichtigung bei Fehler

In `/etc/aliases` deine Mail-Adresse für `root` setzen, dann liefert `cron` Fehler per Mail. Oder besser: einen Healthcheck-Service wie [healthchecks.io](https://healthchecks.io) einbinden:

```cron
0 3 * * * /usr/local/bin/lumio-backup.sh && curl -fsS -m 10 --retry 5 https://hc-ping.com/<deine-uuid> >> /var/log/lumio-backup.log 2>&1
```

Wenn das Script länger als die erwartete Cron-Periode nicht pingt, alarmiert healthchecks.io.

---

## S3-Bucket-Backup (die Bilder)

Drei Strategien, von einfach zu robust:

### Strategie A: Provider-internes Versioning

Bei allen großen S3-Providern aktivierbar (Hetzner, R2, B2, Wasabi):

- **Versioning** an, behält gelöschte und überschriebene Versionen für N Tage
- **Lifecycle-Rule** deletet alte Versionen nach z.B. 30 Tagen

Kostet zusätzlichen Storage, aber 1-Klick-Setup. Schützt vor versehentlichem Löschen, **nicht** vor Account-Kompromittierung oder Provider-Ausfall.

### Strategie B: Sync zu zweitem Bucket

`rclone` syncen das ganze Lumio-Bucket zu einem zweiten Bucket bei einem **anderen Provider** (z.B. Lumio bei Hetzner → Backup bei B2). Cross-Provider schützt auch vor Account-Lockout.

```bash
apt install -y rclone
rclone config    # zwei Remotes anlegen: src (Lumio-Bucket) + dst (Backup-Bucket)

rclone sync src:lumio-prod dst:lumio-backup --bwlimit 50M --transfers 4
```

Als Cron, z.B. wöchentlich vollständig:

```cron
30 3 * * 0 /usr/bin/rclone sync src:lumio-prod dst:lumio-backup --bwlimit 50M >> /var/log/lumio-s3-backup.log 2>&1
```

### Strategie C: restic auch für S3-Inhalte

`restic` mit `--read-source` auf einen S3-Mount (rclone-mount oder ähnliches). Funktioniert, aber bei vielen kleinen Dateien (= viele Bilder + Thumbnails) wird das langsam und teuer (viele List-Operations). Strategie B ist meist besser für S3 → S3.

---

## Restore-Test

**Mach das einmal pro Quartal.** Idealerweise auf einer fresh Test-VM.

### Postgres restore

```bash
# Aus restic
restic restore latest --target /tmp/restored
docker compose exec -T postgres psql -U lumio -c "DROP DATABASE IF EXISTS lumio_test;"
docker compose exec -T postgres psql -U lumio -c "CREATE DATABASE lumio_test;"
docker compose exec -T postgres pg_restore -U lumio -d lumio_test < /tmp/restored/lumio-dump-*/lumio.dump

# Test: Tabellen da?
docker compose exec -T postgres psql -U lumio -d lumio_test -c "\dt"
```

Wenn Tabellen vorhanden und Row-Counts plausibel: Postgres-Backup ist OK.

### Voll-Restore (komplette neue Instanz)

1. Auf neuer VM Lumio frisch installieren (siehe SELFHOSTING.md)
2. Container stoppen: `docker compose stop`
3. Postgres-Dump aus Backup einspielen
4. S3-Bucket aus Backup zurücksyncen
5. `.env` aus Backup wiederherstellen (passwords + S3-Credentials!)
6. Container starten
7. Login testen

Wenn das funktioniert: kompletter Restore klappt. Damit weißt du: im echten Disaster bist du in einer Stunde wieder online.

---

## Was nicht gebackupt werden muss

- `redis_data` – nur Job-Queue. In-flight-Jobs gehen verloren, aber das System bootet sauber neu.
- `caddy_data` – TLS-Certs. Caddy holt sie automatisch neu (außer du bist im Let's-Encrypt-Rate-Limit, dann unbequem aber kein Datenverlust).
- `minio_data` falls du externes S3 nutzt – ist leer.
- Container-Images – kommen aus dem Registry.

---

## Backup-Frequenz

| Asset | Frequenz | Begründung |
|---|---|---|
| Postgres | täglich | Hoher Datenwert, kleine Größe |
| S3-Bucket (Bilder) | wöchentlich | Große Datenmenge, langsame Veränderung |
| `.env` | bei jeder Änderung | Restore ohne `.env` ist schmerzhaft |
| Volle Restore-Probe | quartalsweise | Backup-Integrität validieren |

Bei sehr aktiven SaaS-Setups Postgres-Frequenz auf alle 6 oder 12 Stunden hochsetzen (Stripe-Transaktionen!).
