**English** · [Deutsch](BACKUP.de.md)

# Backup

> An untested backup is not a backup. **Run restore tests regularly.**

Lumio backs up two separate data areas that are handled differently:

1. **Postgres** – the application database (users, galleries, permissions, subscriptions/Stripe state). Small, high-value, changes constantly → **daily**.
2. **S3 bucket** – the actual image and video files. Large, changes slowly → **weekly**.

Iron principle: **backups must leave the server.** A dump that sits on the same server as the DB doesn't help if the server fails. This setup therefore follows the **3-2-1 rule**: the data (1) plus two copies (2) at two different providers, one of them off-site (1).

| Data | Original | Copy 1 | Copy 2 |
|---|---|---|---|
| Postgres | Server volume | Hetzner Object Storage (second bucket) | Backblaze B2 |
| Images/videos | `lumio-prod` (Hetzner) | Versioning + Object Lock on `lumio-prod` | Backblaze B2 (rclone sync) |

`redis_data` (job queue) and `caddy_data` (TLS certs) are **not** backed up — both regenerate on restart. Details below under "What doesn't need backing up".

This repo ships the ready-made scripts:

- `scripts/lumio-backup.sh` – daily Postgres dump into both restic repos
- `scripts/lumio-media-sync.sh` – weekly rclone sync of the images to B2
- `scripts/lumio-backup.env.example` – configuration template (secrets!)

---

## Overview: what gets set up

1. Install tools: `restic`, `rclone`, `mc` (MinIO client, only for bucket versioning)
2. Create a second Hetzner bucket `lumio-backups` (for the DB restic repo)
3. Create Backblaze B2 buckets (`lumio-db-backup`, `lumio-media-backup`)
4. Initialize restic repos in both targets
5. Enable versioning + Object Lock on `lumio-prod`
6. Configure rclone remotes
7. Fill in the config file `/etc/lumio-backup.env`
8. Add cron jobs
9. Wire up a dead man's switch
10. Run a **restore test**

---

## 1. Install tools

```bash
apt update && apt install -y restic rclone

# mc (MinIO client) — only needed to toggle bucket versioning.
# Architecture automatic (amd64 or arm64):
curl -sSL https://dl.min.io/client/mc/release/linux-$(dpkg --print-architecture)/mc -o /usr/local/bin/mc
chmod +x /usr/local/bin/mc
```

## 2. Second Hetzner bucket

In the Hetzner Cloud Console create a **second** bucket, e.g. `lumio-backups` — **not** the same one as `lumio-prod`, otherwise it's a single point of failure. Then generate an S3 key pair (Console → Object Storage → Credentials). The endpoint is `fsn1.your-objectstorage.com`.

## 3. Backblaze B2 buckets

In the B2 account create two private buckets:

- `lumio-db-backup` (for the DB)
- `lumio-media-backup` (for the images)

Then create an **application key** with access to both buckets (B2 → App Keys). You get a `keyID` and an `applicationKey` — the latter is shown only **once**, so save it immediately.

## 4. Initialize restic repos

restic encrypts everything with a password. Generate a strong one and store it — it is the **only** way to decrypt the backups:

```bash
openssl rand -base64 48 > /root/.lumio-restic-pwd
chmod 600 /root/.lumio-restic-pwd
```

> **Also store this password in a password manager on a different device.** If you lose it AND the server, the backups are unrecoverable.

Initialize both repos once (same password for both):

```bash
export RESTIC_PASSWORD_FILE=/root/.lumio-restic-pwd

# Hetzner (S3 backend)
export AWS_ACCESS_KEY_ID="<hetzner-backup-key>"
export AWS_SECRET_ACCESS_KEY="<hetzner-backup-secret>"
restic -r s3:https://fsn1.your-objectstorage.com/lumio-backups/db init
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY

# Backblaze B2 (B2 backend)
export B2_ACCOUNT_ID="<b2-key-id>"
export B2_ACCOUNT_KEY="<b2-app-key>"
restic -r b2:lumio-db-backup:db init
```

## 5. Versioning + Object Lock on `lumio-prod`

Protects the images against accidental/malicious deletion before the weekly sync even runs. On Hetzner this is only togglable via CLI (not in the UI):

```bash
mc alias set lumio https://fsn1.your-objectstorage.com <prod-key> <prod-secret>
mc version enable lumio/lumio-prod

# Optional but recommended: expire old versions after 30 days (cost!)
mc ilm rule add lumio/lumio-prod --noncurrent-expire-days 30
```

Object Lock (WORM, ransomware protection) can only be enabled at **bucket creation** — for an existing `lumio-prod`, versioning + lifecycle is the pragmatic path. For maximum hardening, create a new bucket with Object Lock and migrate (a separate project).

## 6. rclone remotes

```bash
rclone config
```

Create two remotes:

- **`hetzner`** — type `s3`, provider `Other`, endpoint `fsn1.your-objectstorage.com`, the `lumio-prod` credentials.
- **`b2`** — type `b2`, with `keyID` and `applicationKey`.

Test:

```bash
rclone lsd hetzner:lumio-prod
rclone lsd b2:
```

## 7. Config file

```bash
cp /opt/docker/lumio/lumio/scripts/lumio-backup.env.example /etc/lumio-backup.env
chmod 600 /etc/lumio-backup.env
nano /etc/lumio-backup.env   # fill in all __PLACEHOLDERS__
```

Copy the scripts to a fixed location and make them executable:

```bash
install -m 700 /opt/docker/lumio/lumio/scripts/lumio-backup.sh     /usr/local/bin/
install -m 700 /opt/docker/lumio/lumio/scripts/lumio-media-sync.sh /usr/local/bin/
```

Test the first run manually:

```bash
/usr/local/bin/lumio-backup.sh
restic -r b2:lumio-db-backup:db snapshots   # snapshot there?
```

## 8. Cron

```cron
# Postgres daily at 03:00
0 3 * * * /usr/local/bin/lumio-backup.sh >> /var/log/lumio-backup.log 2>&1

# Images/videos weekly, Sunday 03:30
30 3 * * 0 /usr/local/bin/lumio-media-sync.sh >> /var/log/lumio-media-sync.log 2>&1
```

For a very active SaaS operation (many Stripe transactions), raise the Postgres frequency to every 6 or 12 hours.

## 9. Dead man's switch

The most dangerous failure is a **silent** one — the cron stops running and nobody notices. Create two checks at [healthchecks.io](https://healthchecks.io) (free) and enter the ping URLs as `HEALTHCHECK_URL` and `MEDIA_HEALTHCHECK_URL` in `/etc/lumio-backup.env`. The scripts ping `/start`, success and `/fail` automatically; if a job doesn't run within the expected period, the service alerts you by email/push.

## 10. Backup status light in the super admin (optional)

After each success the script writes a status file (`STATUS_FILE`, default `/backup/lumio/status.txt`). Lumio's built-in backup status light in the super-admin area can read this and show age/size (green < 24 h, yellow < 72 h, red beyond that).

For this the API container needs to see the file. In `docker-compose.prod.yml` add to the `api` service:

```yaml
    environment:
      - BACKUP_STATUS_PATH=/backup-status/status.txt
    volumes:
      - /backup/lumio:/backup-status:ro
```

> This is a Compose/deploy change (main server only, `BACKUP_STATUS_PATH` is an optional env with a default). Without this step the backup works fully — only the status light stays at "not active".

---

## Restore test

**Do this once per quarter**, ideally on a throwaway VM.

### Postgres restore (into a test DB)

```bash
export RESTIC_PASSWORD_FILE=/root/.lumio-restic-pwd
export B2_ACCOUNT_ID="<b2-key-id>"; export B2_ACCOUNT_KEY="<b2-app-key>"

restic -r b2:lumio-db-backup:db restore latest --target /tmp/restored
cd /opt/docker/lumio/lumio
docker compose exec -T postgres psql -U lumio -c "DROP DATABASE IF EXISTS lumio_test;"
docker compose exec -T postgres psql -U lumio -c "CREATE DATABASE lumio_test;"
docker compose exec -T postgres pg_restore -U lumio -d lumio_test < /tmp/restored/tmp/lumio-dump.*/lumio.dump

# Sanity: tables + row counts
docker compose exec -T postgres psql -U lumio -d lumio_test -c "\dt"
```

Tables present and row counts plausible → the Postgres backup is OK.

### Full restore (a complete new instance)

1. Install Lumio fresh on a new VM (see `SELFHOSTING.md`).
2. Stop the containers: `docker compose stop`.
3. Restore `.env` from the restic snapshot (`env.backup`) — it contains passwords + S3 credentials!
4. Load the Postgres dump (as above, but into the real DB instead of `lumio_test`).
5. Sync the images back from the B2 bucket: `rclone sync b2:lumio-media-backup hetzner:lumio-prod`.
6. Start the containers, test login + a gallery.

If that works, in a real disaster you're back online in ~1 hour.

---

## What doesn't need backing up

- `redis_data` – just the job queue. In-flight jobs are lost, the system boots cleanly.
- `caddy_data` – TLS certs, Caddy fetches them again automatically (just watch the Let's Encrypt rate limit).
- `minio_data` – empty when external S3 is used.
- Container images – come from the registry.

---

## Backup frequency (summary)

| Asset | Frequency | Rationale |
|---|---|---|
| Postgres | daily (SaaS maybe 6–12 h) | High data value, small size |
| S3 bucket (images) | weekly | Large data volume, slow change |
| `.env` | with every DB backup | Restore without `.env` is painful (included in the dump directory) |
| Full restore test | quarterly | Validate backup integrity |
