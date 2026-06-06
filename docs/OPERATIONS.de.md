[English](OPERATIONS.md) · **Deutsch**

# Lumio — Operations Cookbook

Alltagsaufgaben für den Betrieb einer produktiven Lumio-Instanz. Gedacht
für Self-Hoster die schon ein laufendes Setup haben (siehe
[DEVELOPMENT.md](./DEVELOPMENT.de.md) für die Erstinstallation).

Alle Befehle in diesem Dokument gehen davon aus, dass das aktuelle
Verzeichnis das Lumio-Repo-Root ist:

```bash
cd /opt/docker/lumio/lumio   # oder wo dein Klon liegt
```

Wenn dein Setup andere Compose-Files braucht (GPU, externer Proxy, etc.),
ersetze in jedem `docker compose`-Aufruf entsprechend. Die meisten
Beispiele nutzen das volle Set, das du auch im Production-Setup hast:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  <subcommand>
```

Für die Lesbarkeit schreiben wir das im Cookbook abgekürzt als
`docker compose <subcommand>` — vergiss die Flags nicht in echt.

---

## Inhaltsverzeichnis

1. [Deploy](#deploy)
2. [Service-Lifecycle](#service-lifecycle)
3. [ENV-Variable ändern und neu laden](#env-variable-ändern-und-neu-laden)
4. [Secrets & Passwörter rotieren](#secrets--passwörter-rotieren)
5. [Logs ansehen](#logs-ansehen)
6. [Datenbank-Zugriff](#datenbank-zugriff)
7. [Redis / Job-Streams](#redis--job-streams)
8. [Failed Files re-queuen](#failed-files-re-queuen)
9. [Worker-Backfills](#worker-backfills)
10. [Storage-Inspektion (S3 / MinIO)](#storage-inspektion-s3--minio)
11. [Tenant-Verwaltung](#tenant-verwaltung)
12. [Diagnose: ist das wirklich kaputt?](#diagnose-ist-das-wirklich-kaputt)
13. [Backup & Restore](#backup--restore)
14. [Storage-Aufräumen](#storage-aufräumen)
15. [Häufige Probleme](#häufige-probleme)

---

## Deploy

### Code aktualisieren

```bash
git pull
docker compose up -d --build api frontend worker
```

`--build` ist wichtig: ohne läuft das alte Image weiter, auch wenn du
gepullt hast. `up -d` ohne `--build` zieht **nur dann** neu, wenn der
Image-Tag sich geändert hat (Compose merkt File-Änderungen nicht).

**Selektiv pro Service deployen** wenn du z.B. nur Frontend-Änderungen
hattest:

```bash
docker compose up -d --build frontend
```

Service-Namen: `api`, `frontend`, `worker`, `caddy`, `postgres`, `redis`,
`minio`. Letztere drei rebuildet man fast nie — sie nutzen vorgefertigte
Images.

### Rebuild ohne Cache (wenn Build-Probleme)

```bash
docker compose build --no-cache worker
docker compose up -d worker
```

Hilft bei seltsamen „die Datei ist im Repo, fehlt aber im Container"-
Bugs, normalerweise nicht nötig.

### Frontend Hard-Reload für User

Nach CSS- oder JS-Änderungen müssen Customers ggf. Ctrl+F5 machen, weil
Next.js statische Assets cached. Bei kritischen Änderungen kannst du den
Frontend-Container neustarten, das invalidiert die Build-Hashes:

```bash
docker compose restart frontend
```

---

## Service-Lifecycle

### Alle Services starten

```bash
docker compose up -d
```

### Alle stoppen

```bash
docker compose stop
```

`stop` vs `down`: `stop` behält die Container, `down` löscht sie (Volumes
bleiben). Im Normalbetrieb `stop`.

### Einzelner Service Restart

```bash
docker compose restart api
```

Praktisch z.B. nach einer `.env`-Änderung — der Container liest die ENV
beim Start neu, kein Image-Rebuild nötig.

### Container-Status

```bash
docker compose ps
```

Zeigt welche Services laufen, welche Ports gemappt sind, ob welcher
unhealthy ist.

---

## ENV-Variable ändern und neu laden

`.env`-Änderungen greifen erst beim **Container-Restart**, nicht
automatisch im laufenden Prozess. Workflow:

```bash
cd /opt/docker/lumio/lumio

# 1) ENV bearbeiten
nano .env

# 2) Service restarten (kein --build nötig, kein git pull nötig)
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  restart api

# 3) Verifizieren dass der neue Wert wirklich drin ist
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  exec api env | grep <DEIN_KEY>

# 4) Optional: Logs verfolgen während er hochkommt
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  logs -f api
```

**Welcher Service muss restarten?** ENV-Variablen werden pro Service in
`docker-compose.yml` ans Container-Image gebunden, der Restart-Service
hängt davon ab was du änderst:

| ENV-Variable | Restart |
|---|---|
| `MAX_FILE_SIZE_MIB`, `MAX_UPLOAD_HARD_CAP_MIB` | `api` |
| `BILLING_ENABLED`, `STRIPE_*` | `api` |
| `LUMIO_DOMAIN_BASE`, `PUBLIC_URL` | `api`, `frontend` |
| Caddy-Domain-Konfiguration | `caddy` |
| `S3_*`, `MINIO_*` | `api`, `worker` |
| Worker-Tuning (Concurrency etc.) | `worker` |
| Postgres-Credentials | `api`, `worker`, `postgres` |
| Im Zweifel | alle: `docker compose restart` |

**Warum nicht `docker compose up -d`?** Geht auch — aber `up` baut
nur dann neu, wenn das Image sich geändert hat. Bei reinen
`.env`-Änderungen ist `restart` schneller (kein Image-Check) und
expliziter („ich wollte wirklich nur ENV neu laden").

**Warum nicht `kill -HUP`?** Node-Apps haben kein SIGHUP-Reload. Bei
Caddy ginge das, aber wir nutzen für alle Services dasselbe Pattern
weil's leichter zu merken ist.

---

## Secrets & Passwörter rotieren

> ⚠️ Hier gibt es zwei Fallen, die jeweils einen Ausfall verursachen, wenn
> man "einfach nur die `.env` ändert". Bitte den passenden Abschnitt
> komplett lesen, bevor du etwas änderst.

### Boot-Guard: Platzhalter-Secrets blockieren den Start

Die API **verweigert den Start**, wenn `JWT_SECRET` oder `SESSION_SECRET`
noch die öffentlich bekannten Platzhalter aus `.env.example` sind:

```
[lumio:api] Refusing to start: insecure secret(s) detected: JWT_SECRET, SESSION_SECRET.
```

Das ist Absicht — diese Werte sind im Repo einsehbar, jeder könnte damit
Tokens fälschen. Starke Werte setzen:

```
openssl rand -base64 32   # → JWT_SECRET
openssl rand -base64 32   # → SESSION_SECRET
```

### App-Secrets rotieren (`JWT_SECRET` / `SESSION_SECRET`)

Sessions und API-Tokens werden **DB-seitig gehasht** und hängen NICHT an
diesen Secrets. Heißt: eine Rotation **loggt niemanden aus**, eingeloggte
User bleiben drin. Was `SESSION_SECRET` aber sehr wohl betrifft (es ist
HMAC-/Ableitungs-Basis):

- **Galerie-Visitor-Cookies** sind HMAC-signiert über `SESSION_SECRET`.
  Nach Rotation müssen aktive Galerie-Besucher das Galerie-Passwort einmal
  neu eingeben. Die geteilten Links selbst bleiben gültig — nichts neu
  erzeugen.
- **Print-Shop-Credentials** werden mit einem Key verschlüsselt, der per
  HKDF aus `SESSION_SECRET` abgeleitet wird. Nach Rotation sind zuvor
  gespeicherte Lab-Zugangsdaten nicht mehr entschlüsselbar → einmal neu
  hinterlegen. (Wer das Print-Feature nicht nutzt: irrelevant.)
- Login-Challenge-Tokens sind kurzlebig → unkritisch.

`JWT_SECRET` wird zwar erzwungen, signiert im aktuellen Code aber nichts,
woran bestehende Sessions/Tokens hängen → Rotation ohne User-Impact.
Trotzdem stark halten.

Vorgehen (kein Build, kein `git pull`):

```
# .env auf dem Hauptserver anpassen, dann:
docker compose --profile wildcard \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml \
  up -d --force-recreate api
```

### DB-Passwort rotieren (`POSTGRES_PASSWORD`) — die größere Falle

Das Postgres-Image liest `POSTGRES_PASSWORD` **nur beim allerersten Init**
eines leeren Datenverzeichnisses. Bei vorhandenem Volume wird die Variable
beim Neustart **ignoriert** — das echte Passwort der Rolle liegt in der DB.
Wer nur die `.env` ändert und neu startet, verbindet die API mit dem neuen
Passwort gegen eine DB mit dem alten → Auth-Fehler → API unten.

Das Passwort muss also **zuerst in Postgres selbst** geändert werden:

```
# 1) Backup als Sicherheitsnetz (Hauptserver)
docker exec lumio_postgres pg_dump -U lumio lumio | gzip > ~/lumio-db-$(date +%F).sql.gz

# 2) Neues Passwort OHNE Sonderzeichen (sonst bricht die DATABASE_URL-Syntax)
openssl rand -hex 24        # → im Folgenden NEUESPW

# 3) Passwort in Postgres ändern (ändert nur das Passwort, keine Daten)
docker exec -it lumio_postgres psql -U lumio -d lumio
#   im psql-Prompt:  \password lumio   (fragt 2× ab, ohne Echo)  →  \q
```

Danach das neue Passwort überall nachziehen, **wo die `lumio`-Rolle genutzt
wird**:

- **Hauptserver** `.env`: `POSTGRES_PASSWORD=NEUESPW`
- **Jede Worker-Node** `.env.worker`:
  `DATABASE_URL=postgres://lumio:NEUESPW@10.0.0.2:5432/lumio`

Und neu erzeugen:

```
# Hauptserver
cd /opt/docker/lumio/lumio && docker compose --profile wildcard \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml up -d

# danach jede Worker-Node
cd /opt/docker/lumio/lumio && docker compose \
  -f docker-compose.worker.yml --env-file .env.worker up -d
```

Postgres wird dabei zwar mit-recreated, läuft aber **nicht** erneut durch den
Init (Volume ist voll) — das Passwort aus Schritt 3 bleibt gültig.
Verifizieren: `curl -s https://<deine-domain>/health` → `status: ok` heißt,
die API hat sich mit dem neuen Passwort verbunden.

**Nicht betroffen** von dieser Rotation: Umami (eigene Postgres-Instanz mit
eigenem `UMAMI_DB_PASSWORD`) und acme-dns (eigene DB-Rolle).

---

## Logs ansehen

### Live-Logs eines Services

```bash
docker compose logs -f worker
```

`-f` ist follow (Ctrl+C zum Beenden). Ohne `-f` einmaliger Dump.

### Letzte N Zeilen

```bash
docker compose logs --tail=200 worker
```

### Logs mehrerer Services kombiniert

```bash
docker compose logs -f api worker
```

### Filter nach Zeitfenster

```bash
docker compose logs --since 10m worker
docker compose logs --since 2026-05-21T15:00:00 worker
```

### Logs in Datei sichern

```bash
docker compose logs --tail=500 worker > /tmp/worker.log
```

### Strukturierte JSON-Logs durchsuchen

Worker- und API-Logs sind JSON (über structlog/pino). Mit `jq` filtern:

```bash
docker compose logs --no-log-prefix --tail=1000 worker | \
  grep -oE '\{.*\}' | jq -r 'select(.level == "error") | .event'
```

---

## Datenbank-Zugriff

### psql-Shell öffnen

```bash
docker compose exec postgres psql -U lumio lumio
```

`-U lumio` ist der DB-User, das zweite `lumio` ist der DB-Name. Beide
Standard. Wenn du eigene Credentials hast (`.env`), entsprechend.

### Einzelne Query ohne interaktive Shell

```bash
docker compose exec postgres psql -U lumio lumio -c \
  "SELECT id, name, status FROM tenants;"
```

### Spalten mit Großbuchstaben escapen

Prisma generiert Tabellen mit camelCase und braucht doppelte
Anführungszeichen drumherum. Die müssen im Shell-Aufruf geescaped werden:

```bash
docker compose exec postgres psql -U lumio lumio -c \
  "SELECT id, status, \"errorMessage\" FROM files WHERE status = 'failed';"
```

### Hilfreiche Queries

**Status eines Files prüfen:**
```sql
SELECT id, "originalFilename", status, "errorMessage",
       "sizeBytes"/1024/1024 AS mb
FROM files
WHERE id = '<file-id>';
```

**Failed Files der letzten Stunde:**
```sql
SELECT id, "originalFilename", "errorMessage", "updatedAt"
FROM files
WHERE status = 'failed'
  AND "updatedAt" > NOW() - INTERVAL '1 hour'
ORDER BY "updatedAt" DESC;
```

**Tenant-Storage-Übersicht:**
```sql
SELECT t.slug, t.name,
       COUNT(DISTINCT g.id) AS galleries,
       COUNT(f.id) AS files,
       pg_size_pretty(SUM(f."sizeBytes")) AS storage
FROM tenants t
LEFT JOIN galleries g ON g."tenantId" = t.id
LEFT JOIN files f ON f."galleryId" = g.id AND f.status = 'ready'
GROUP BY t.id, t.slug, t.name
ORDER BY SUM(f."sizeBytes") DESC NULLS LAST;
```

**Renditions eines Files anschauen** (welche existieren, wie groß):
```sql
SELECT kind, format, "sizeBytes"/1024/1024 AS mb, "storageKey"
FROM renditions
WHERE "fileId" = '<file-id>'
ORDER BY kind;
```

**Tenant-Owner finden** (z.B. für Support-Kontakt):
```sql
SELECT t.slug, u.email, u.role
FROM tenants t
JOIN users u ON u."tenantId" = t.id
WHERE u.role = 'owner';
```

### Dump erstellen

```bash
docker compose exec postgres pg_dump -U lumio lumio > /backup/lumio-$(date +%F).sql
```

### Aus Dump wiederherstellen

```bash
cat /backup/lumio-2026-05-21.sql | \
  docker compose exec -T postgres psql -U lumio lumio
```

`-T` deaktiviert die TTY-Allokation, sonst hängt das Cat-Pipe.

---

## Redis / Job-Streams

Lumio nutzt Redis als Job-Queue zwischen API und Worker. Streams:

| Stream | Inhalt |
|---|---|
| `lumio:jobs:file_processing` | Bildverarbeitung (Renditions) |
| `lumio:jobs:video_processing` | Video (HLS + MP4 + Sprite) |
| `lumio:jobs:zip_build` | ZIP-Erstellung |
| `lumio:jobs:webhook_delivery` | Outgoing Webhooks |

Consumer-Group: `lumio_workers` (alle Worker-Container teilen sich diese).

### Redis-CLI

```bash
docker compose exec redis redis-cli
```

### Stream-Status

**Wie viele Messages im Stream insgesamt:**
```bash
docker compose exec redis redis-cli XLEN lumio:jobs:video_processing
```

**Pending = abgeholt aber nicht acked** (Worker hat die noch in Arbeit
oder ist gecrasht):
```bash
docker compose exec redis redis-cli XPENDING lumio:jobs:video_processing lumio_workers
```

Ausgabe-Format: `[count, min-id, max-id, [[consumer, count], ...]]`. Wenn
da seit Minuten was hängt, hat ein Worker einen Job angenommen aber nicht
fertiggemacht (Stale-Reclaim kommt nach `CLAIM_MIN_IDLE_MS` = 60s
automatisch, dann übernimmt ein anderer Consumer).

**Letzte 5 Einträge im Stream zeigen** (zum Debug):
```bash
docker compose exec redis redis-cli XREVRANGE lumio:jobs:video_processing + - COUNT 5
```

### Einen Job manuell ins Stream pushen

Format: ein einzelnes `payload`-Feld mit JSON-Body. Das ist wichtig — der
Stream-Consumer im Worker liest `fields.get("payload")` und JSON.parsed
das, **nicht** mehrere separate Felder.

```bash
docker compose exec redis redis-cli XADD lumio:jobs:video_processing '*' \
  payload '{"type":"process_video","fileId":"<uuid>"}'
```

Für andere Job-Typen siehe `consumer.py` im Worker-Code — z.B.:
- `{"type":"process_file","fileId":"..."}` → Image-Renditions
- `{"type":"process_raw","fileId":"..."}` → RAW-Preview
- `{"type":"process_watermark","fileId":"..."}` → Watermarking

---

## Failed Files re-queuen

Wenn ein File-Processing fehlgeschlagen ist (`status = 'failed'`) und du
willst, dass es noch mal versucht wird:

```bash
# 1. Status zurücksetzen
docker compose exec postgres psql -U lumio lumio -c \
  "UPDATE files SET status='processing', \"errorMessage\"=NULL \
   WHERE id = '<file-id>';"

# 2. Passenden Job in den Redis-Stream pushen
docker compose exec redis redis-cli XADD lumio:jobs:video_processing '*' \
  payload '{"type":"process_video","fileId":"<file-id>"}'

# 3. Logs verfolgen
docker compose logs -f worker
```

Job-Typ je nach `files.kind`:
- `image` → `lumio:jobs:file_processing`, type=`process_file`
- `heic` → `lumio:jobs:file_processing`, type=`process_file`
- `raw` → `lumio:jobs:file_processing`, type=`process_raw`
- `video` → `lumio:jobs:video_processing`, type=`process_video`

### Mehrere Failed Files auf einmal

```sql
-- Erst SQL nachgucken welche es sind
SELECT id, "originalFilename", kind, "errorMessage"
FROM files
WHERE status = 'failed'
  AND "galleryId" = '<gallery-id>'
ORDER BY "updatedAt" DESC;
```

Dann ein Bash-Loop:

```bash
# Alle failed video-Files einer Galerie neu starten
docker compose exec postgres psql -U lumio lumio -At -c \
  "SELECT id FROM files WHERE status='failed' AND kind='video' AND \"galleryId\"='<gallery-id>'" | \
while read FILE_ID; do
  echo "Re-queueing $FILE_ID"
  docker compose exec postgres psql -U lumio lumio -c \
    "UPDATE files SET status='processing', \"errorMessage\"=NULL WHERE id='$FILE_ID';" > /dev/null
  docker compose exec redis redis-cli XADD lumio:jobs:video_processing '*' \
    payload "{\"type\":\"process_video\",\"fileId\":\"$FILE_ID\"}" > /dev/null
done
```

`-At` macht das Output rein (`A` = unaligned, `t` = tuples only).

---

## Worker-Backfills

Wenn Worker-Code neue Renditions hinzufügt (z.B. `web_jpeg` oder
`video_mp4`), existieren die natürlich nicht für die Files, die vor dem
Sprint hochgeladen wurden. Dafür gibt es Backfill-Tasks.

### video_mp4 (Web-MP4-Variante für Customer-Download)

Pro Galerie:

```bash
docker compose exec worker celery -A app call \
  tasks.backfill_video_mp4.run_for_gallery --args='["<gallery-id>"]'
```

Global mit Limit (idempotent, kann mehrmals laufen):

```bash
# 5 Videos zum Antesten
docker compose exec worker celery -A app call \
  tasks.backfill_video_mp4.run_global --args='[5]'

# Größerer Batch wenn Test ok
docker compose exec worker celery -A app call \
  tasks.backfill_video_mp4.run_global --args='[200]'
```

Auswirkung: pro Video ~5-15% Original-Größe extra im S3. Mit NVENC läuft
ein 5-Min-1080p-Video in ~30 Sekunden durch, ohne GPU 2-5 Minuten. Bei
großen Backfills den Worker-Log mitlaufen lassen:

```bash
docker compose logs -f worker
```

### web_jpeg (JPEG-Version für Customer-Bilder-Download)

Pro Galerie:

```bash
docker compose exec worker celery -A app call \
  tasks.backfill_web_jpeg.run_for_gallery --args='["<gallery-id>"]'
```

Pro Tenant (alle Galerien des Tenants):

```bash
docker compose exec worker celery -A app call \
  tasks.backfill_web_jpeg.run_for_tenant --args='["<tenant-id>"]'
```

### Backfill-Fortschritt verfolgen

```sql
-- Wieviele Files haben (noch) keine video_mp4-Rendition?
SELECT COUNT(*)
FROM files f
WHERE f.kind = 'video' AND f.status = 'ready'
  AND NOT EXISTS (
    SELECT 1 FROM renditions r
    WHERE r."fileId" = f.id AND r.kind = 'video_mp4'
  );
```

---

## Storage-Inspektion (S3 / MinIO)

### MinIO Console-UI

```
http://docker5.lan:32092
```

Login mit `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` aus `.env`.

### mc-CLI (MinIO Client) — von außen

```bash
# Alias anlegen (einmalig)
mc alias set lumio http://localhost:32091 <root-user> <root-password>

# Bucket-Inhalt zählen
mc ls --recursive lumio/lumio-bucket/ | wc -l

# Storage-Verbrauch
mc du lumio/lumio-bucket/

# Pro Tenant
mc du lumio/lumio-bucket/t/<tenant-id>/
```

### Storage-Key eines Files in der DB nachschauen

```sql
SELECT "storageKey" FROM files WHERE id = '<file-id>';
SELECT "storageKey", kind FROM renditions WHERE "fileId" = '<file-id>';
```

Die Keys beginnen typisch mit `t/<tenant-id>/galleries/<gallery-id>/...`.

### Object aus MinIO holen (zum Debug)

```bash
mc cp lumio/lumio-bucket/t/.../source /tmp/test.jpg
```

---

## Tenant-Verwaltung

### Alle Tenants anzeigen

```sql
SELECT id, slug, name, status, plan, "createdAt"
FROM tenants
ORDER BY "createdAt" DESC;
```

### Tenant via Super-Admin-UI verwalten

```
https://studio.lumio-cloud.de/super/login
```

Login mit Super-Admin-Credentials (siehe `.env` oder eigene Notizen).

### Tenant manuell anlegen

Geht im Super-Admin per UI. Per CLI nur über die Prisma-API — am
einfachsten via Studio-UI.

### Tenant sperren (suspend)

```sql
UPDATE tenants SET status = 'suspended' WHERE slug = '<slug>';
```

`active` / `suspended` / `archived`. Bei suspended kommen weder Customers
noch Studio-User rein.

### Custom-Subdomain für Tenant aktivieren

Drei Dinge müssen stimmen:

1. **DNS-Record**: `mueller.lumio-cloud.de A <server-ip>` (oder
   Wildcard `*.lumio-cloud.de`)
2. **Externer Caddy-Block**:
   ```caddyfile
   mueller.lumio-cloud.de {
       reverse_proxy 192.168.178.90:32080
   }
   ```
   Oder bei Wildcard-Block:
   ```caddyfile
   *.lumio-cloud.de {
       reverse_proxy 192.168.178.90:32080
   }
   ```
3. **App-seitig**: `LUMIO_DOMAIN_BASE=lumio-cloud.de` muss in `.env`
   gesetzt sein. Die App parsed die Subdomain raus und mappt sie auf
   `tenants.slug`.

Reload Caddy nach Änderungen:

```bash
sudo systemctl reload caddy   # oder docker exec caddy ...
```

### Tenant-Custom-Domain (full-custom statt Subdomain)

Im Studio unter Settings → Custom-Domain einen Hostname eintragen (z.B.
`galerien.studio-mueller.de`). Plus auch hier DNS + Caddy außerhalb.

---

## Diagnose: ist das wirklich kaputt?

### Im Worker-Container nachgucken

```bash
# Was läuft an Prozessen?
docker compose exec worker ps auxf

# Speziell ffmpeg-Subprozesse
docker compose exec worker pgrep -af ffmpeg

# GPU-Auslastung (wenn GPU-Compose-Overlay aktiv)
docker compose exec worker nvidia-smi

# Temp-Verzeichnis (laufende Verarbeitung)
docker compose exec worker ls -lh /tmp/lumio_vid_* 2>/dev/null
docker compose exec worker du -sh /tmp/lumio_vid_* 2>/dev/null
```

### Speicher / Disk

```bash
# Container-RAM
docker stats --no-stream

# Host-Disk
df -h

# Container-Disk (Image + Overlay)
docker system df
```

### Healthcheck-Endpoint

API hat einen Health-Endpoint:

```bash
curl -s http://localhost:33031/api/v1/health
# {"status":"ok","db":"ok","redis":"ok","storage":"ok"}
```

Wenn einer auf `error`/`down` springt → das ist das Problem.

### Imports im Worker testen

Wenn Worker-Tasks mit ModuleNotFoundError abbrechen, schnell verifizieren:

```bash
docker compose exec worker python -c \
  "from encoder_profile import profile_for; print(profile_for(1080))"

docker compose exec worker env | grep PYTHONPATH
# erwartet: PYTHONPATH=/app
```

### Last-Run eines Tasks anschauen

```sql
-- Failed Jobs in den letzten 24h
SELECT id, "originalFilename", kind, "errorMessage", "updatedAt"
FROM files
WHERE status = 'failed' AND "updatedAt" > NOW() - INTERVAL '24 hour'
ORDER BY "updatedAt" DESC;
```

`errorMessage` enthält den `str(err)` der Exception. Für volle Tracebacks
in die Worker-Logs schauen — seit Commit `d590520` werden Stack-Traces
korrekt mit `format_exc_info` im structlog-Pipeline geloggt.

---

## Backup & Restore

### Was muss gesichert werden

Drei Dinge:
1. **Postgres-DB** — alle Tenants, Galerien, Files, Selections, etc.
2. **S3/MinIO-Bucket** — die eigentlichen Dateien
3. **`.env`-File** — Credentials, Secrets

Was **nicht** gesichert werden muss:
- Redis (Job-Queue, ephemerer State)
- Docker-Images (lokal gebaut, jederzeit rebuildbar)

### Postgres-Dump (manuell)

```bash
docker compose exec postgres pg_dump -U lumio lumio \
  | gzip > /backup/lumio-db-$(date +%F).sql.gz
```

### MinIO mirror auf externen Storage

```bash
# Erstinstallation
mc alias set backup s3.backup-provider.example <key> <secret>

# Sync (idempotent, kopiert nur neue/geänderte Objects)
mc mirror lumio/lumio-bucket/ backup/lumio-backup/
```

### Cron-Backup-Skript (Beispiel)

```bash
#!/bin/bash
set -e
DATE=$(date +%F)
DEST=/backup/lumio
mkdir -p $DEST

cd /opt/docker/lumio/lumio
docker compose exec -T postgres pg_dump -U lumio lumio \
  | gzip > $DEST/db-$DATE.sql.gz

mc mirror lumio/lumio-bucket/ $DEST/storage/

# 14 Tage Retention für DB-Dumps
find $DEST -name "db-*.sql.gz" -mtime +14 -delete
```

Crontab:
```
0 3 * * * /opt/scripts/lumio-backup.sh >> /var/log/lumio-backup.log 2>&1
```

### Restore (DB)

```bash
# Container muss laufen und DB leer sein (oder erst dropdb)
gunzip -c /backup/lumio-db-2026-05-21.sql.gz | \
  docker compose exec -T postgres psql -U lumio lumio
```

### Restore (Storage)

```bash
mc mirror /backup/lumio/storage/ lumio/lumio-bucket/
```

---

## Storage-Aufräumen

### Verwaiste S3-Objects identifizieren

Verwaist = liegt im Bucket, aber kein DB-Eintrag verweist darauf. Kann
passieren wenn Files gelöscht wurden aber das Cleanup-Job nicht durchlief.

Eingebautes Cleanup gibt's noch nicht (Roadmap). Manuelle Detection:

```bash
# Alle Storage-Keys aus der DB
docker compose exec postgres psql -U lumio lumio -At -c \
  "SELECT \"storageKey\" FROM files
   UNION SELECT \"storageKey\" FROM renditions
   UNION SELECT \"storageKey\" FROM zip_downloads
   WHERE \"storageKey\" IS NOT NULL" > /tmp/db-keys.txt

# Alle Storage-Keys aus MinIO
mc ls --recursive lumio/lumio-bucket/ \
  | awk '{print $NF}' > /tmp/minio-keys.txt

# Differenz
comm -23 <(sort /tmp/minio-keys.txt) <(sort /tmp/db-keys.txt) > /tmp/orphans.txt
wc -l /tmp/orphans.txt
```

**Bevor du löschst:** Sample reinschauen und prüfen ob das wirklich
verwaiste Dateien sind. Vorsicht bei laufenden Uploads — die haben kurz
ein S3-Object ohne DB-Eintrag.

### Abgelaufene ZIP-Downloads aufräumen

```sql
SELECT COUNT(*) FROM zip_downloads
WHERE "expiresAt" < NOW();
```

```sql
DELETE FROM zip_downloads
WHERE "expiresAt" < NOW() - INTERVAL '7 day';
```

(S3-Objects bleiben — wenn nicht via Cleanup-Job entfernt. Sprint-2-Item.)

### File komplett löschen (Studio + S3)

Im Studio per UI. Programmatisch ohne UI:

```sql
-- File-ID merken
SELECT id, "storageKey" FROM files WHERE id = '<file-id>';

-- Renditions löschen (CASCADE würde das auch machen, hier explizit)
DELETE FROM renditions WHERE "fileId" = '<file-id>';

-- File-Row löschen
DELETE FROM files WHERE id = '<file-id>';
```

Dann S3-Objects manuell entfernen (Keys aus der vorherigen SELECT-Abfrage).

---

## Häufige Probleme

### „No module named 'encoder_profile'" im Worker

**Symptom:** `process_video.failed` mit `errorMessage = "No module named 'encoder_profile'"`.

**Ursache:** Worker-Image wurde nicht rebuilded nach Code-Update, oder
`PYTHONPATH=/app` ist nicht gesetzt.

**Lösung:**
```bash
git pull
docker compose up -d --build worker

# Verifizieren
docker compose exec worker env | grep PYTHONPATH
docker compose exec worker python -c "from encoder_profile import profile_for; print('ok')"
```

### „column f.tenantId does not exist" in Backfill-Task

**Symptom:** SQL-Error wenn `backfill_video_mp4.run_global` aufgerufen wird.

**Ursache:** Alter Bug, sollte mit Commit `74fcb50` gefixt sein. Wenn
weiter da: nicht das aktuelle Image.

**Lösung:** `git pull && docker compose up -d --build worker`.

### Tenant-Subdomain nicht erreichbar

**Symptom:** `mueller.lumio-cloud.de` lädt nicht, Login geht nur über die
Haupt-App-Domain.

**Ursache:** Externer Caddy-Block fehlt oder DNS-Record fehlt.

**Lösung:** Beides prüfen, siehe Abschnitt
[Tenant-Verwaltung > Custom-Subdomain](#custom-subdomain-für-tenant-aktivieren).

### Web-MP4 ist größer als das Original

**Symptom:** Customer-Download „Web-Version" liefert eine größere Datei
als das Original.

**Ursache:** Source-Video ist schon stark komprimiert (z.B. 720p mit
1300 kbps), unser Re-Encoding-Target von 2800 kbps ist da kontraproduktiv.

**Lösung:** Seit Commit `36146f8` wird die Web-MP4-Generierung
übersprungen wenn Source-Bitrate ≤ Target. Für alte Files manuell
aufräumen (siehe [Storage-Aufräumen](#storage-aufräumen)) oder per SQL:

```sql
DELETE FROM renditions r
USING files f
WHERE r."fileId" = f.id
  AND r.kind = 'video_mp4'
  AND r."sizeBytes" >= f."sizeBytes";
```

Plus die S3-Objects manuell löschen.

### Input-Felder im Studio sind weiß / unlesbar

**Symptom:** Im Dark-Theme Studio sind Inputs weiß mit unlesbarem Text.

**Ursache:** Vor Commit `2b20607` betraf das einige Studio-Seiten mit raw
`<input>`-Tags ohne explizites `bg-`/`text-`. Seit dem Fix sollten alle
funktionieren.

**Lösung:** Frontend rebuilden mit aktuellem Code:
```bash
docker compose up -d --build frontend
```

### „Processing failed" — wo ist der Stack-Trace?

**Vor Commit `d590520`:** structlog-Pipeline hatte `format_exc_info`
nicht eingebunden, daher wurden Tracebacks bei `log.exception()` und
`exc_info=True` weggeschmissen. Im Log stand dann nur `"exc_info": true`
ohne den eigentlichen Stack.

**Seit `d590520`:** im Worker-Log unter dem Key `"exception"` steht der
volle Traceback. Plus die `errorMessage`-Spalte in `files` hat die Kurz-
Form.

### Worker stoppt jeden Job nach kurzer Zeit

**Mögliche Ursache:** Disk voll, OOM-Killer aktiv, oder Redis-Verbindung
weg. Check:

```bash
df -h
docker stats --no-stream
dmesg | tail -50 | grep -i "oom\|kill"
docker compose logs --tail=100 redis
```

---

## Wichtige Commits zum Nachschlagen

Diese Commits sind hinter Bugs / Migrationen, die im Cookbook erwähnt
sind. Wenn ein Symptom auftaucht, hilft `git log --oneline | grep <key>`:

- `0d8ba99` — App-Domain-Migration zu studio.lumio-cloud.de
- `62921b8` — Web-MP4-Rendition eingeführt
- `74fcb50` — Backfill-SQL `tenantId` aus galleries gejoint
- `d590520` — structlog format_exc_info
- `6085c58` — encoder_profile top-of-module import + PYTHONPATH
- `88b6fe0` — procps im Worker-Image (pgrep/ps/watch)
- `36146f8` — Web-MP4 skip wenn Source schon klein
- `2b20607` — Globaler Dark-Theme-Fix für Form-Inputs
- `4a7625f` — Theme-aware Sticky-Toolbar
- `7509cc6` — Akzent-Contrast-Fix
- `867edb1` — Customer-Pick-Modus mit localStorage
- `7cbbc37` — Lightbox-Comments-Lesbarkeit
- `e3e50fd` — Upload-Links MVP (Backend + Studio + Public Drop-Zone)
- `3fbb24d` — Upload-Links Bulk-Approve, Pending-Filter, Header-Counter
- `16221bb` — Upload-Links Per-File + Bulk-Reject mit Reason
- `0dd5c7b` — Einstellbares Pro-File Upload-Limit pro Tenant + Link
