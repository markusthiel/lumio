**English** · [Deutsch](OPERATIONS.de.md)

# Lumio — Operations Cookbook

Everyday tasks for operating a production Lumio instance. Intended for self-hosters who already have a running setup (see [DEVELOPMENT.md](./DEVELOPMENT.md) for the first installation).

All commands in this document assume the current directory is the Lumio repo root:

```bash
cd /opt/docker/lumio/lumio   # or wherever your clone lives
```

If your setup needs different Compose files (GPU, external proxy, etc.), replace accordingly in every `docker compose` call. Most examples use the full set you also have in the production setup:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  <subcommand>
```

For readability we abbreviate this in the cookbook as `docker compose <subcommand>` — don't forget the flags in real life.

---

## Table of contents

1. [Deploy](#deploy)
2. [Service lifecycle](#service-lifecycle)
3. [Changing an ENV variable and reloading](#changing-an-env-variable-and-reloading)
4. [Rotating secrets & passwords](#rotating-secrets--passwords)
5. [Viewing logs](#viewing-logs)
6. [Database access](#database-access)
7. [Redis / job streams](#redis--job-streams)
8. [Re-queueing failed files](#re-queueing-failed-files)
9. [Worker backfills](#worker-backfills)
10. [Storage inspection (S3 / MinIO)](#storage-inspection-s3--minio)
11. [Tenant management](#tenant-management)
12. [Diagnosis: is it really broken?](#diagnosis-is-it-really-broken)
13. [Backup & restore](#backup--restore)
14. [Storage cleanup](#storage-cleanup)
15. [Common problems](#common-problems)

---

## Deploy

### Update the code

```bash
git pull
docker compose up -d --build api frontend worker
```

`--build` is important: without it the old image keeps running, even after you pulled. `up -d` without `--build` only pulls anew **if** the image tag changed (Compose doesn't notice file changes).

**Deploy selectively per service** if, for example, you only had frontend changes:

```bash
docker compose up -d --build frontend
```

Service names: `api`, `frontend`, `worker`, `caddy`, `postgres`, `redis`, `minio`. The latter three are almost never rebuilt — they use prebuilt images.

### Rebuild without cache (on build problems)

```bash
docker compose build --no-cache worker
docker compose up -d worker
```

Helps with weird "the file is in the repo but missing in the container" bugs, normally not needed.

### Frontend hard reload for users

After CSS or JS changes, customers may need to do Ctrl+F5, because Next.js caches static assets. For critical changes you can restart the frontend container, which invalidates the build hashes:

```bash
docker compose restart frontend
```

---

## Service lifecycle

### Start all services

```bash
docker compose up -d
```

### Stop all

```bash
docker compose stop
```

`stop` vs `down`: `stop` keeps the containers, `down` removes them (volumes remain). In normal operation use `stop`.

### Restart a single service

```bash
docker compose restart api
```

Handy e.g. after a `.env` change — the container re-reads the ENV on start, no image rebuild needed.

### Container status

```bash
docker compose ps
```

Shows which services are running, which ports are mapped, whether any is unhealthy.

---

## Changing an ENV variable and reloading

`.env` changes only take effect on a **container restart**, not automatically in the running process. Workflow:

```bash
cd /opt/docker/lumio/lumio

# 1) Edit the ENV
nano .env

# 2) Restart the service (no --build needed, no git pull needed)
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  restart api

# 3) Verify the new value really made it in
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  exec api env | grep <YOUR_KEY>

# 4) Optional: follow the logs while it comes up
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  logs -f api
```

**Which service has to restart?** ENV variables are bound to the container image per service in `docker-compose.yml`; the service to restart depends on what you change:

| ENV variable | Restart |
|---|---|
| `MAX_FILE_SIZE_MIB`, `MAX_UPLOAD_HARD_CAP_MIB` | `api` |
| `BILLING_ENABLED`, `STRIPE_*` | `api` |
| `LUMIO_DOMAIN_BASE`, `PUBLIC_URL` | `api`, `frontend` |
| Caddy domain configuration | `caddy` |
| `S3_*`, `MINIO_*` | `api`, `worker` |
| Worker tuning (concurrency etc.) | `worker` |
| Postgres credentials | `api`, `worker`, `postgres` |
| When in doubt | all: `docker compose restart` |

**Why not `docker compose up -d`?** That works too — but `up` only rebuilds if the image changed. For pure `.env` changes `restart` is faster (no image check) and more explicit ("I really just wanted to reload ENV").

**Why not `kill -HUP`?** Node apps have no SIGHUP reload. For Caddy it would work, but we use the same pattern for all services because it's easier to remember.

---

## Rotating secrets & passwords

> ⚠️ There are two traps here, each of which causes an outage if you "just change the `.env`". Please read the relevant section completely before changing anything.

### Boot guard: placeholder secrets block the start

The API **refuses to start** if `JWT_SECRET` or `SESSION_SECRET` are still the publicly known placeholders from `.env.example`:

```
[lumio:api] Refusing to start: insecure secret(s) detected: JWT_SECRET, SESSION_SECRET.
```

That's intentional — these values are visible in the repo, anyone could forge tokens with them. Set strong values:

```
openssl rand -base64 32   # → JWT_SECRET
openssl rand -base64 32   # → SESSION_SECRET
```

### Rotating app secrets (`JWT_SECRET` / `SESSION_SECRET`)

Sessions and API tokens are **hashed on the DB side** and do NOT depend on these secrets. Meaning: a rotation **logs nobody out**, logged-in users stay in. What `SESSION_SECRET` does affect, however (it's the HMAC/derivation base):

- **Gallery visitor cookies** are HMAC-signed with `SESSION_SECRET`. After a rotation, active gallery visitors have to enter the gallery password once again. The shared links themselves stay valid — nothing to regenerate.
- **Print shop credentials** are encrypted with a key derived from `SESSION_SECRET` via HKDF. After a rotation, previously stored lab credentials can no longer be decrypted → re-enter them once. (If you don't use the print feature: irrelevant.)
- Login challenge tokens are short-lived → not critical.

`JWT_SECRET` is enforced but in the current code signs nothing that existing sessions/tokens depend on → rotation without user impact. Keep it strong anyway.

Procedure (no build, no `git pull`):

```
# Adjust .env on the main server, then:
docker compose --profile wildcard \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml \
  up -d --force-recreate api
```

### Rotating the DB password (`POSTGRES_PASSWORD`) — the bigger trap

The Postgres image reads `POSTGRES_PASSWORD` **only on the very first init** of an empty data directory. With an existing volume the variable is **ignored** on restart — the role's real password lives in the DB. If you only change the `.env` and restart, the API connects with the new password against a DB with the old one → auth error → API down.

So the password must be changed **in Postgres itself first**:

```
# 1) Backup as a safety net (main server)
docker exec lumio_postgres pg_dump -U lumio lumio | gzip > ~/lumio-db-$(date +%F).sql.gz

# 2) New password WITHOUT special characters (otherwise the DATABASE_URL syntax breaks)
openssl rand -hex 24        # → referred to below as NEWPW

# 3) Change the password in Postgres (changes only the password, no data)
docker exec -it lumio_postgres psql -U lumio -d lumio
#   at the psql prompt:  \password lumio   (asks twice, no echo)  →  \q
```

Then propagate the new password everywhere **the `lumio` role is used**:

- **Main server** `.env`: `POSTGRES_PASSWORD=NEWPW`
- **Every worker node** `.env.worker`:
  `DATABASE_URL=postgres://lumio:NEWPW@10.0.0.2:5432/lumio`

And recreate:

```
# Main server
cd /opt/docker/lumio/lumio && docker compose --profile wildcard \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml up -d

# then every worker node
cd /opt/docker/lumio/lumio && docker compose \
  -f docker-compose.worker.yml --env-file .env.worker up -d
```

Postgres is recreated in the process but does **not** run through init again (the volume is full) — the password from step 3 stays valid. Verify: `curl -s https://<your-domain>/health` → `status: ok` means the API connected with the new password.

**Not affected** by this rotation: Umami (its own Postgres instance with its own `UMAMI_DB_PASSWORD`) and acme-dns (its own DB role).

---

## Viewing logs

### Live logs of a service

```bash
docker compose logs -f worker
```

`-f` is follow (Ctrl+C to quit). Without `-f` a one-off dump.

### Last N lines

```bash
docker compose logs --tail=200 worker
```

### Logs of several services combined

```bash
docker compose logs -f api worker
```

### Filter by time window

```bash
docker compose logs --since 10m worker
docker compose logs --since 2026-05-21T15:00:00 worker
```

### Save logs to a file

```bash
docker compose logs --tail=500 worker > /tmp/worker.log
```

### Searching structured JSON logs

Worker and API logs are JSON (via structlog/pino). Filter with `jq`:

```bash
docker compose logs --no-log-prefix --tail=1000 worker | \
  grep -oE '\{.*\}' | jq -r 'select(.level == "error") | .event'
```

---

## Database access

### Open a psql shell

```bash
docker compose exec postgres psql -U lumio lumio
```

`-U lumio` is the DB user, the second `lumio` is the DB name. Both default. If you have your own credentials (`.env`), use those.

### A single query without an interactive shell

```bash
docker compose exec postgres psql -U lumio lumio -c \
  "SELECT id, name, status FROM tenants;"
```

### Escaping columns with uppercase letters

Prisma generates tables with camelCase and needs double quotes around them. Those have to be escaped in the shell call:

```bash
docker compose exec postgres psql -U lumio lumio -c \
  "SELECT id, status, \"errorMessage\" FROM files WHERE status = 'failed';"
```

### Useful queries

**Check the status of a file:**
```sql
SELECT id, "originalFilename", status, "errorMessage",
       "sizeBytes"/1024/1024 AS mb
FROM files
WHERE id = '<file-id>';
```

**Failed files in the last hour:**
```sql
SELECT id, "originalFilename", "errorMessage", "updatedAt"
FROM files
WHERE status = 'failed'
  AND "updatedAt" > NOW() - INTERVAL '1 hour'
ORDER BY "updatedAt" DESC;
```

**Tenant storage overview:**
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

**Look at a file's renditions** (which exist, how large):
```sql
SELECT kind, format, "sizeBytes"/1024/1024 AS mb, "storageKey"
FROM renditions
WHERE "fileId" = '<file-id>'
ORDER BY kind;
```

**Find a tenant owner** (e.g. for support contact):
```sql
SELECT t.slug, u.email, u.role
FROM tenants t
JOIN users u ON u."tenantId" = t.id
WHERE u.role = 'owner';
```

### Create a dump

```bash
docker compose exec postgres pg_dump -U lumio lumio > /backup/lumio-$(date +%F).sql
```

### Restore from a dump

```bash
cat /backup/lumio-2026-05-21.sql | \
  docker compose exec -T postgres psql -U lumio lumio
```

`-T` disables TTY allocation, otherwise the cat pipe hangs.

---

## Redis / job streams

Lumio uses Redis as the job queue between the API and the worker. Streams:

| Stream | Content |
|---|---|
| `lumio:jobs:file_processing` | Image processing (renditions) |
| `lumio:jobs:video_processing` | Video (HLS + MP4 + sprite) |
| `lumio:jobs:zip_build` | ZIP creation |
| `lumio:jobs:webhook_delivery` | Outgoing webhooks |

Consumer group: `lumio_workers` (all worker containers share it).

### Redis CLI

```bash
docker compose exec redis redis-cli
```

### Stream status

**How many messages in the stream in total:**
```bash
docker compose exec redis redis-cli XLEN lumio:jobs:video_processing
```

**Pending = picked up but not acked** (the worker still has it in progress or crashed):
```bash
docker compose exec redis redis-cli XPENDING lumio:jobs:video_processing lumio_workers
```

Output format: `[count, min-id, max-id, [[consumer, count], ...]]`. If something has been hanging there for minutes, a worker accepted a job but didn't finish it (stale reclaim happens automatically after `CLAIM_MIN_IDLE_MS` = 60s, then another consumer takes over).

**Show the last 5 entries in the stream** (for debugging):
```bash
docker compose exec redis redis-cli XREVRANGE lumio:jobs:video_processing + - COUNT 5
```

### Push a job into the stream manually

Format: a single `payload` field with a JSON body. This is important — the stream consumer in the worker reads `fields.get("payload")` and JSON.parses it, **not** several separate fields.

```bash
docker compose exec redis redis-cli XADD lumio:jobs:video_processing '*' \
  payload '{"type":"process_video","fileId":"<uuid>"}'
```

For other job types see `consumer.py` in the worker code — e.g.:
- `{"type":"process_file","fileId":"..."}` → image renditions
- `{"type":"process_raw","fileId":"..."}` → RAW preview
- `{"type":"process_watermark","fileId":"..."}` → watermarking

---

## Re-queueing failed files

If a file processing failed (`status = 'failed'`) and you want it retried:

```bash
# 1. Reset the status
docker compose exec postgres psql -U lumio lumio -c \
  "UPDATE files SET status='processing', \"errorMessage\"=NULL \
   WHERE id = '<file-id>';"

# 2. Push the matching job into the Redis stream
docker compose exec redis redis-cli XADD lumio:jobs:video_processing '*' \
  payload '{"type":"process_video","fileId":"<file-id>"}'

# 3. Follow the logs
docker compose logs -f worker
```

Job type depending on `files.kind`:
- `image` → `lumio:jobs:file_processing`, type=`process_file`
- `heic` → `lumio:jobs:file_processing`, type=`process_file`
- `raw` → `lumio:jobs:file_processing`, type=`process_raw`
- `video` → `lumio:jobs:video_processing`, type=`process_video`

### Several failed files at once

```sql
-- First check via SQL which ones they are
SELECT id, "originalFilename", kind, "errorMessage"
FROM files
WHERE status = 'failed'
  AND "galleryId" = '<gallery-id>'
ORDER BY "updatedAt" DESC;
```

Then a bash loop:

```bash
# Restart all failed video files of a gallery
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

`-At` makes the output clean (`A` = unaligned, `t` = tuples only).

---

## Worker backfills

When worker code adds new renditions (e.g. `web_jpeg` or `video_mp4`), they naturally don't exist for files uploaded before the sprint. That's what the backfill tasks are for.

### video_mp4 (web MP4 variant for customer download)

Per gallery:

```bash
docker compose exec worker celery -A app call \
  tasks.backfill_video_mp4.run_for_gallery --args='["<gallery-id>"]'
```

Globally with a limit (idempotent, can run multiple times):

```bash
# 5 videos to try it out
docker compose exec worker celery -A app call \
  tasks.backfill_video_mp4.run_global --args='[5]'

# Larger batch when the test is OK
docker compose exec worker celery -A app call \
  tasks.backfill_video_mp4.run_global --args='[200]'
```

Effect: ~5-15% of the original size extra in S3 per video. With NVENC a 5-min 1080p video runs through in ~30 seconds, without a GPU 2-5 minutes. For large backfills, keep the worker log running:

```bash
docker compose logs -f worker
```

### web_jpeg (JPEG version for customer image download)

Per gallery:

```bash
docker compose exec worker celery -A app call \
  tasks.backfill_web_jpeg.run_for_gallery --args='["<gallery-id>"]'
```

Per tenant (all of the tenant's galleries):

```bash
docker compose exec worker celery -A app call \
  tasks.backfill_web_jpeg.run_for_tenant --args='["<tenant-id>"]'
```

### Tracking backfill progress

```sql
-- How many files (still) have no video_mp4 rendition?
SELECT COUNT(*)
FROM files f
WHERE f.kind = 'video' AND f.status = 'ready'
  AND NOT EXISTS (
    SELECT 1 FROM renditions r
    WHERE r."fileId" = f.id AND r.kind = 'video_mp4'
  );
```

---

## Storage inspection (S3 / MinIO)

### MinIO console UI

```
http://docker5.lan:32092
```

Log in with `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` from `.env`.

### mc CLI (MinIO client) — from outside

```bash
# Set up the alias (once)
mc alias set lumio http://localhost:32091 <root-user> <root-password>

# Count bucket contents
mc ls --recursive lumio/lumio-bucket/ | wc -l

# Storage usage
mc du lumio/lumio-bucket/

# Per tenant
mc du lumio/lumio-bucket/t/<tenant-id>/
```

### Look up a file's storage key in the DB

```sql
SELECT "storageKey" FROM files WHERE id = '<file-id>';
SELECT "storageKey", kind FROM renditions WHERE "fileId" = '<file-id>';
```

The keys typically start with `t/<tenant-id>/galleries/<gallery-id>/...`.

### Fetch an object from MinIO (for debugging)

```bash
mc cp lumio/lumio-bucket/t/.../source /tmp/test.jpg
```

---

## Tenant management

### Show all tenants

```sql
SELECT id, slug, name, status, plan, "createdAt"
FROM tenants
ORDER BY "createdAt" DESC;
```

### Manage a tenant via the super admin UI

```
https://studio.lumio-cloud.de/super/login
```

Log in with super admin credentials (see `.env` or your own notes).

### Create a tenant manually

Works in the super admin via the UI. Via CLI only through the Prisma API — easiest via the studio UI.

### Suspend a tenant

```sql
UPDATE tenants SET status = 'suspended' WHERE slug = '<slug>';
```

`active` / `suspended` / `archived`. With suspended, neither customers nor studio users get in.

### Enable a custom subdomain for a tenant

Three things must be right:

1. **DNS record**: `mueller.lumio-cloud.de A <server-ip>` (or wildcard `*.lumio-cloud.de`)
2. **External Caddy block**:
   ```caddyfile
   mueller.lumio-cloud.de {
       reverse_proxy 192.168.178.90:32080
   }
   ```
   Or with a wildcard block:
   ```caddyfile
   *.lumio-cloud.de {
       reverse_proxy 192.168.178.90:32080
   }
   ```
3. **App side**: `LUMIO_DOMAIN_BASE=lumio-cloud.de` must be set in `.env`. The app parses the subdomain out and maps it to `tenants.slug`.

Reload Caddy after changes:

```bash
sudo systemctl reload caddy   # or docker exec caddy ...
```

### Tenant custom domain (full custom instead of subdomain)

In the studio under Settings → Custom domain enter a hostname (e.g. `gallery.studio-mueller.de`). Plus DNS + Caddy outside, here too.

---

## Diagnosis: is it really broken?

### Look inside the worker container

```bash
# What processes are running?
docker compose exec worker ps auxf

# Specifically ffmpeg subprocesses
docker compose exec worker pgrep -af ffmpeg

# GPU utilization (if the GPU compose overlay is active)
docker compose exec worker nvidia-smi

# Temp directory (processing in progress)
docker compose exec worker ls -lh /tmp/lumio_vid_* 2>/dev/null
docker compose exec worker du -sh /tmp/lumio_vid_* 2>/dev/null
```

### Memory / disk

```bash
# Container RAM
docker stats --no-stream

# Host disk
df -h

# Container disk (image + overlay)
docker system df
```

### Healthcheck endpoint

The API has a health endpoint:

```bash
curl -s http://localhost:33031/api/v1/health
# {"status":"ok","db":"ok","redis":"ok","storage":"ok"}
```

If one flips to `error`/`down` → that's the problem.

### Test imports in the worker

If worker tasks abort with a ModuleNotFoundError, verify quickly:

```bash
docker compose exec worker python -c \
  "from encoder_profile import profile_for; print(profile_for(1080))"

docker compose exec worker env | grep PYTHONPATH
# expected: PYTHONPATH=/app
```

### Look at the last run of a task

```sql
-- Failed jobs in the last 24h
SELECT id, "originalFilename", kind, "errorMessage", "updatedAt"
FROM files
WHERE status = 'failed' AND "updatedAt" > NOW() - INTERVAL '24 hour'
ORDER BY "updatedAt" DESC;
```

`errorMessage` contains the `str(err)` of the exception. For full tracebacks look in the worker logs — since commit `d590520` stack traces are logged correctly with `format_exc_info` in the structlog pipeline.

---

## Backup & restore

### What must be backed up

Three things:
1. **Postgres DB** — all tenants, galleries, files, selections, etc.
2. **S3/MinIO bucket** — the actual files
3. **`.env` file** — credentials, secrets

What does **not** need backing up:
- Redis (job queue, ephemeral state)
- Docker images (built locally, rebuildable any time)

### Postgres dump (manual)

```bash
docker compose exec postgres pg_dump -U lumio lumio \
  | gzip > /backup/lumio-db-$(date +%F).sql.gz
```

### MinIO mirror to external storage

```bash
# Initial setup
mc alias set backup s3.backup-provider.example <key> <secret>

# Sync (idempotent, copies only new/changed objects)
mc mirror lumio/lumio-bucket/ backup/lumio-backup/
```

### Cron backup script (example)

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

# 14 days retention for DB dumps
find $DEST -name "db-*.sql.gz" -mtime +14 -delete
```

Crontab:
```
0 3 * * * /opt/scripts/lumio-backup.sh >> /var/log/lumio-backup.log 2>&1
```

### Restore (DB)

```bash
# The container must be running and the DB empty (or dropdb first)
gunzip -c /backup/lumio-db-2026-05-21.sql.gz | \
  docker compose exec -T postgres psql -U lumio lumio
```

### Restore (storage)

```bash
mc mirror /backup/lumio/storage/ lumio/lumio-bucket/
```

---

## Storage cleanup

### Identify orphaned S3 objects

Orphaned = sits in the bucket, but no DB entry references it. Can happen if files were deleted but the cleanup job didn't run.

Built-in cleanup doesn't exist yet (roadmap). Manual detection:

```bash
# All storage keys from the DB
docker compose exec postgres psql -U lumio lumio -At -c \
  "SELECT \"storageKey\" FROM files
   UNION SELECT \"storageKey\" FROM renditions
   UNION SELECT \"storageKey\" FROM zip_downloads
   WHERE \"storageKey\" IS NOT NULL" > /tmp/db-keys.txt

# All storage keys from MinIO
mc ls --recursive lumio/lumio-bucket/ \
  | awk '{print $NF}' > /tmp/minio-keys.txt

# Difference
comm -23 <(sort /tmp/minio-keys.txt) <(sort /tmp/db-keys.txt) > /tmp/orphans.txt
wc -l /tmp/orphans.txt
```

**Before you delete:** look at a sample and check whether these really are orphaned files. Be careful with uploads in progress — they briefly have an S3 object without a DB entry.

### Clean up expired ZIP downloads

```sql
SELECT COUNT(*) FROM zip_downloads
WHERE "expiresAt" < NOW();
```

```sql
DELETE FROM zip_downloads
WHERE "expiresAt" < NOW() - INTERVAL '7 day';
```

(S3 objects remain — unless removed via the cleanup job. Sprint-2 item.)

### Delete a file completely (studio + S3)

In the studio via the UI. Programmatically without the UI:

```sql
-- Note the file ID
SELECT id, "storageKey" FROM files WHERE id = '<file-id>';

-- Delete the renditions (CASCADE would do this too, here explicitly)
DELETE FROM renditions WHERE "fileId" = '<file-id>';

-- Delete the file row
DELETE FROM files WHERE id = '<file-id>';
```

Then remove the S3 objects manually (keys from the previous SELECT query).

---

## Common problems

### "No module named 'encoder_profile'" in the worker

**Symptom:** `process_video.failed` with `errorMessage = "No module named 'encoder_profile'"`.

**Cause:** the worker image wasn't rebuilt after a code update, or `PYTHONPATH=/app` isn't set.

**Fix:**
```bash
git pull
docker compose up -d --build worker

# Verify
docker compose exec worker env | grep PYTHONPATH
docker compose exec worker python -c "from encoder_profile import profile_for; print('ok')"
```

### "column f.tenantId does not exist" in a backfill task

**Symptom:** SQL error when `backfill_video_mp4.run_global` is called.

**Cause:** an old bug, should be fixed with commit `74fcb50`. If still present: not the current image.

**Fix:** `git pull && docker compose up -d --build worker`.

### Tenant subdomain not reachable

**Symptom:** `mueller.lumio-cloud.de` doesn't load, login only works via the main app domain.

**Cause:** the external Caddy block is missing or the DNS record is missing.

**Fix:** check both, see the section [Tenant management > Enable a custom subdomain](#enable-a-custom-subdomain-for-a-tenant).

### The web MP4 is larger than the original

**Symptom:** the customer download "web version" delivers a larger file than the original.

**Cause:** the source video is already heavily compressed (e.g. 720p at 1300 kbps), our re-encoding target of 2800 kbps is counterproductive there.

**Fix:** since commit `36146f8` the web MP4 generation is skipped if the source bitrate ≤ target. For old files clean up manually (see [Storage cleanup](#storage-cleanup)) or via SQL:

```sql
DELETE FROM renditions r
USING files f
WHERE r."fileId" = f.id
  AND r.kind = 'video_mp4'
  AND r."sizeBytes" >= f."sizeBytes";
```

Plus delete the S3 objects manually.

### Input fields in the studio are white / unreadable

**Symptom:** in the dark-theme studio, inputs are white with unreadable text.

**Cause:** before commit `2b20607` this affected some studio pages with raw `<input>` tags without explicit `bg-`/`text-`. Since the fix all should work.

**Fix:** rebuild the frontend with the current code:
```bash
docker compose up -d --build frontend
```

### "Processing failed" — where's the stack trace?

**Before commit `d590520`:** the structlog pipeline hadn't included `format_exc_info`, so tracebacks were thrown away on `log.exception()` and `exc_info=True`. The log then only said `"exc_info": true` without the actual stack.

**Since `d590520`:** the full traceback is in the worker log under the key `"exception"`. Plus the `errorMessage` column in `files` has the short form.

### The worker stops every job after a short time

**Possible cause:** disk full, the OOM killer active, or the Redis connection gone. Check:

```bash
df -h
docker stats --no-stream
dmesg | tail -50 | grep -i "oom\|kill"
docker compose logs --tail=100 redis
```

---

## Important commits for reference

These commits are behind bugs / migrations mentioned in the cookbook. When a symptom appears, `git log --oneline | grep <key>` helps:

- `0d8ba99` — app domain migration to studio.lumio-cloud.de
- `62921b8` — web MP4 rendition introduced
- `74fcb50` — backfill SQL `tenantId` joined from galleries
- `d590520` — structlog format_exc_info
- `6085c58` — encoder_profile top-of-module import + PYTHONPATH
- `88b6fe0` — procps in the worker image (pgrep/ps/watch)
- `36146f8` — web MP4 skipped when the source is already small
- `2b20607` — global dark-theme fix for form inputs
- `4a7625f` — theme-aware sticky toolbar
- `7509cc6` — accent contrast fix
- `867edb1` — customer pick mode with localStorage
- `7cbbc37` — lightbox comments readability
- `e3e50fd` — upload links MVP (backend + studio + public drop zone)
- `3fbb24d` — upload links bulk approve, pending filter, header counter
- `16221bb` — upload links per-file + bulk reject with reason
- `0dd5c7b` — configurable per-file upload limit per tenant + link
