# Backup

> Ein nicht-getestetes Backup ist kein Backup. **Mache regelmäßige Restore-Tests.**

Lumio sichert zwei getrennte Datenbereiche, die unterschiedlich behandelt werden:

1. **Postgres** – die Anwendungsdatenbank (User, Galerien, Permissions, Subscriptions/Stripe-State). Klein, hochwertig, ändert sich ständig → **täglich**.
2. **S3-Bucket** – die eigentlichen Bild- und Videodateien. Groß, ändert sich langsam → **wöchentlich**.

Eisernes Prinzip: **Backups müssen weg vom Server.** Ein Dump, der auf demselben Server liegt wie die DB, hilft nicht, wenn der Server ausfällt. Deshalb folgt dieses Setup der **3-2-1-Regel**: die Daten (1) plus zwei Kopien (2) bei zwei verschiedenen Providern, davon eine außer Haus (1).

| Daten | Original | Kopie 1 | Kopie 2 |
|---|---|---|---|
| Postgres | Server-Volume | Hetzner Object Storage (zweiter Bucket) | Backblaze B2 |
| Bilder/Videos | `lumio-prod` (Hetzner) | Versioning + Object Lock auf `lumio-prod` | Backblaze B2 (rclone-Sync) |

`redis_data` (Job-Queue) und `caddy_data` (TLS-Certs) werden **nicht** gesichert — beides regeneriert sich beim Neustart. Details unten unter „Was nicht gebackupt werden muss".

Dieses Repo liefert die fertigen Skripte mit:

- `scripts/lumio-backup.sh` – täglicher Postgres-Dump in beide restic-Repos
- `scripts/lumio-media-sync.sh` – wöchentlicher rclone-Sync der Bilder zu B2
- `scripts/lumio-backup.env.example` – Konfigurationsvorlage (Secrets!)

---

## Überblick: was wird eingerichtet

1. Tools installieren: `restic`, `rclone`, `mc` (MinIO-Client, nur für Bucket-Versioning)
2. Zweiten Hetzner-Bucket `lumio-backups` anlegen (für das DB-restic-Repo)
3. Backblaze-B2-Buckets anlegen (`lumio-db-backup`, `lumio-media-backup`)
4. restic-Repos in beiden Zielen initialisieren
5. Versioning + Object Lock auf `lumio-prod` aktivieren
6. rclone-Remotes konfigurieren
7. Konfig-Datei `/etc/lumio-backup.env` ausfüllen
8. Cron-Jobs eintragen
9. Dead-Man's-Switch verkabeln
10. **Restore-Test** machen

---

## 1. Tools installieren

```bash
apt update && apt install -y restic rclone

# mc (MinIO-Client) — nur nötig, um Bucket-Versioning zu schalten.
# Architektur automatisch (amd64 oder arm64):
curl -sSL https://dl.min.io/client/mc/release/linux-$(dpkg --print-architecture)/mc -o /usr/local/bin/mc
chmod +x /usr/local/bin/mc
```

## 2. Zweiter Hetzner-Bucket

In der Hetzner Cloud Console einen **zweiten** Bucket anlegen, z.B. `lumio-backups` — **nicht** denselben wie `lumio-prod`, sonst Single-Point-of-Failure. Dann ein S3-Key-Paar erzeugen (Console → Object Storage → Credentials). Endpoint ist `fsn1.your-objectstorage.com`.

## 3. Backblaze-B2-Buckets

Im B2-Account zwei private Buckets anlegen:

- `lumio-db-backup` (für die DB)
- `lumio-media-backup` (für die Bilder)

Dann einen **Application Key** mit Zugriff auf beide Buckets erstellen (B2 → App Keys). Du bekommst `keyID` und `applicationKey` — letzteren nur **einmal** angezeigt, also direkt sichern.

## 4. restic-Repos initialisieren

restic verschlüsselt alles mit einem Passwort. Erzeuge ein starkes und lege es ab — es ist der **einzige** Weg, die Backups zu entschlüsseln:

```bash
openssl rand -base64 48 > /root/.lumio-restic-pwd
chmod 600 /root/.lumio-restic-pwd
```

> **Speichere dieses Passwort zusätzlich im Passwort-Manager auf einem anderen Gerät.** Verlierst du es UND den Server, sind die Backups unwiederbringlich.

Beide Repos einmalig initialisieren (gleiches Passwort für beide):

```bash
export RESTIC_PASSWORD_FILE=/root/.lumio-restic-pwd

# Hetzner (S3-Backend)
export AWS_ACCESS_KEY_ID="<hetzner-backup-key>"
export AWS_SECRET_ACCESS_KEY="<hetzner-backup-secret>"
restic -r s3:https://fsn1.your-objectstorage.com/lumio-backups/db init
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

# Backblaze B2 (B2-Backend)
export B2_ACCOUNT_ID="<b2-key-id>"
export B2_ACCOUNT_KEY="<b2-app-key>"
restic -r b2:lumio-db-backup:db init
```

## 5. Versioning + Object Lock auf `lumio-prod`

Schützt die Bilder gegen versehentliches/böswilliges Löschen, bevor der wöchentliche Sync überhaupt greift. Bei Hetzner nur per CLI (nicht im UI) schaltbar:

```bash
mc alias set lumio https://fsn1.your-objectstorage.com <prod-key> <prod-secret>
mc version enable lumio/lumio-prod

# Optional, aber empfohlen: alte Versionen nach 30 Tagen wegräumen (Kosten!)
mc ilm rule add lumio/lumio-prod --noncurrent-expire-days 30
```

Object Lock (WORM, Ransomware-Schutz) lässt sich nur bei der **Bucket-Erstellung** aktivieren — bei einem bestehenden `lumio-prod` ist Versioning + Lifecycle der pragmatische Weg. Für maximale Härte einen neuen Bucket mit Object Lock anlegen und umziehen (separates Projekt).

## 6. rclone-Remotes

```bash
rclone config
```

Zwei Remotes anlegen:

- **`hetzner`** — Typ `s3`, Provider `Other`, Endpoint `fsn1.your-objectstorage.com`, die `lumio-prod`-Credentials.
- **`b2`** — Typ `b2`, mit `keyID` und `applicationKey`.

Test:

```bash
rclone lsd hetzner:lumio-prod
rclone lsd b2:
```

## 7. Konfig-Datei

```bash
cp /opt/docker/lumio/lumio/scripts/lumio-backup.env.example /etc/lumio-backup.env
chmod 600 /etc/lumio-backup.env
nano /etc/lumio-backup.env   # alle __PLATZHALTER__ ausfüllen
```

Skripte an einen festen Ort kopieren und ausführbar machen:

```bash
install -m 700 /opt/docker/lumio/lumio/scripts/lumio-backup.sh     /usr/local/bin/
install -m 700 /opt/docker/lumio/lumio/scripts/lumio-media-sync.sh /usr/local/bin/
```

Ersten Lauf manuell testen:

```bash
/usr/local/bin/lumio-backup.sh
restic -r b2:lumio-db-backup:db snapshots   # Snapshot da?
```

## 8. Cron

```cron
# Postgres täglich 03:00
0 3 * * * /usr/local/bin/lumio-backup.sh >> /var/log/lumio-backup.log 2>&1

# Bilder/Videos wöchentlich, Sonntag 03:30
30 3 * * 0 /usr/local/bin/lumio-media-sync.sh >> /var/log/lumio-media-sync.log 2>&1
```

Bei sehr aktivem SaaS-Betrieb (viele Stripe-Transaktionen) die Postgres-Frequenz auf alle 6 oder 12 Stunden hochsetzen.

## 9. Dead-Man's-Switch

Der gefährlichste Fehler ist ein **stilles** Versagen — der Cron läuft nicht mehr und niemand merkt es. Lege bei [healthchecks.io](https://healthchecks.io) (kostenlos) zwei Checks an und trage die Ping-URLs als `HEALTHCHECK_URL` und `MEDIA_HEALTHCHECK_URL` in `/etc/lumio-backup.env` ein. Die Skripte pingen `/start`, Erfolg und `/fail` automatisch; läuft ein Job nicht in der erwarteten Periode, alarmiert dich der Dienst per Mail/Push.

## 10. Backup-Ampel im Super-Admin (optional)

Das Skript schreibt nach jedem Erfolg eine Status-Datei (`STATUS_FILE`, Default `/backup/lumio/status.txt`). Lumios eingebaute Backup-Ampel im Super-Admin-Bereich kann diese lesen und Alter/Größe anzeigen (grün < 24 h, gelb < 72 h, rot darüber).

Dafür muss der API-Container die Datei sehen. In `docker-compose.prod.yml` beim `api`-Service ergänzen:

```yaml
    environment:
      - BACKUP_STATUS_PATH=/backup-status/status.txt
    volumes:
      - /backup/lumio:/backup-status:ro
```

> Das ist eine Compose-/Deploy-Änderung (nur Hauptserver, `BACKUP_STATUS_PATH` ist optionale Env mit Default). Ohne diesen Schritt funktioniert das Backup vollständig — nur die Ampel bleibt auf „nicht aktiv".

---

## Restore-Test

**Mach das einmal pro Quartal**, idealerweise auf einer Wegwerf-VM.

### Postgres-Restore (in eine Test-DB)

```bash
export RESTIC_PASSWORD_FILE=/root/.lumio-restic-pwd
export B2_ACCOUNT_ID="<b2-key-id>"; export B2_ACCOUNT_KEY="<b2-app-key>"

restic -r b2:lumio-db-backup:db restore latest --target /tmp/restored
cd /opt/docker/lumio/lumio
docker compose exec -T postgres psql -U lumio -c "DROP DATABASE IF EXISTS lumio_test;"
docker compose exec -T postgres psql -U lumio -c "CREATE DATABASE lumio_test;"
docker compose exec -T postgres pg_restore -U lumio -d lumio_test < /tmp/restored/tmp/lumio-dump.*/lumio.dump

# Plausibilität: Tabellen + Row-Counts
docker compose exec -T postgres psql -U lumio -d lumio_test -c "\dt"
```

Tabellen vorhanden und Row-Counts plausibel → Postgres-Backup ist OK.

### Voll-Restore (komplette neue Instanz)

1. Auf neuer VM Lumio frisch installieren (siehe `SELFHOSTING.md`).
2. Container stoppen: `docker compose stop`.
3. `.env` aus dem restic-Snapshot wiederherstellen (`env.backup`) — enthält Passwörter + S3-Credentials!
4. Postgres-Dump einspielen (wie oben, aber in die echte DB statt `lumio_test`).
5. Bilder aus dem B2-Bucket zurücksyncen: `rclone sync b2:lumio-media-backup hetzner:lumio-prod`.
6. Container starten, Login + eine Galerie testen.

Wenn das klappt, bist du im echten Disaster in ~1 Stunde wieder online.

---

## Was nicht gebackupt werden muss

- `redis_data` – nur Job-Queue. In-flight-Jobs gehen verloren, das System bootet sauber neu.
- `caddy_data` – TLS-Certs, Caddy holt sie automatisch neu (Vorsicht nur beim Let's-Encrypt-Rate-Limit).
- `minio_data` – leer, wenn externes S3 genutzt wird.
- Container-Images – kommen aus der Registry.

---

## Backup-Frequenz (Zusammenfassung)

| Asset | Frequenz | Begründung |
|---|---|---|
| Postgres | täglich (SaaS ggf. 6–12 h) | Hoher Datenwert, kleine Größe |
| S3-Bucket (Bilder) | wöchentlich | Große Datenmenge, langsame Veränderung |
| `.env` | mit jedem DB-Backup | Restore ohne `.env` ist schmerzhaft (im Dump-Verzeichnis enthalten) |
| Voller Restore-Test | quartalsweise | Backup-Integrität validieren |
