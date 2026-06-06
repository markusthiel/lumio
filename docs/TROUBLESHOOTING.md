**English** · [Deutsch](TROUBLESHOOTING.de.md)

# Troubleshooting

A collection of common self-hosting problems and their solutions.

## Diagnostic tools

Before anything else: look at the logs.

```bash
# Status of all containers
docker compose ps

# Logs of a service (follow live with -f)
docker compose logs api --tail=50 -f
docker compose logs caddy --tail=50 -f
docker compose logs worker --tail=50 -f

# All services at once
docker compose logs --tail=20 -f

# Last 30 seconds of all containers
docker compose logs --since=30s
```

API health check:

```bash
curl -s http://localhost/health
```

---

## Setup problems

### Containers won't start

```bash
docker compose ps
```

If a service shows `Restarting` or `Exited`, look at its logs:

```bash
docker compose logs <service-name> --tail=100
```

Common causes:

- **`POSTGRES_PASSWORD` not set** → the Postgres container exits with "POSTGRES_PASSWORD not specified". Check the `.env` file.
- **Port 80 or 443 in use** → another web server is already running. Find it with `ss -tlnp | grep -E ':80|:443'` and stop it, or change `CADDY_HTTP_PORT`/`CADDY_HTTPS_PORT` in `.env`.
- **Disk full** → check `df -h`. Docker images + logs quickly eat several GB.

### Domain unreachable (Connection Refused / Timeout)

Order of checks:

1. **DNS points to the right IP?** `dig your-domain.com +short`
2. **Firewall open?** On Hetzner Cloud: both the OS firewall (`ufw`) and the cloud-console firewall. Both!
3. **Is Caddy running?** `docker compose ps caddy` → must be "running"
4. **Does Caddy bind 80/443?** `docker compose ps caddy` shows ports like `0.0.0.0:80->80/tcp`. If only `127.0.0.1:...` → the Caddy service wasn't started.

Common mistake: `docker compose up -d --build api worker frontend` – this starts **only** the named services, Caddy is missing. Instead just use `docker compose up -d` (all services).

### Caddy doesn't get certificates

```bash
docker compose logs caddy | grep -iE "error|acme"
```

Typical errors:

- **`connection refused` during the ACME challenge** → port 80 not reachable from outside. Check firewall, cloud firewall, wrong DNS IP.
- **`no solvers available for remaining challenges (offered=[dns-01])`** → you're trying to get a wildcard cert (`*.your-domain.com`). Wildcards need the DNS-01 challenge, not HTTP-01. See [MULTI_TENANT.md](MULTI_TENANT.md#wildcard-zertifikate).
- **`too many requests` (rate limit)** → Let's Encrypt allows max. 50 certificates per domain per week. If you test often: switch Caddy to the staging CA.

---

## Upload problems

### "Failed" on image upload

The API is fine, the browser-to-S3 upload fails. The classic **CORS problem**.

Lumio uses presigned URLs – the browser uploads directly to the S3 bucket, not via the API. Without CORS headers on the bucket the browser blocks the PUT request.

**Fix for external S3** (Hetzner, R2, B2, Wasabi):

In the provider's bucket console create a CORS rule:

```json
{
  "CORSRules": [{
    "AllowedOrigins": ["https://your-domain.com"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}
```

If your storage provider has no web UI for it, via the AWS CLI:

```bash
docker run --rm \
  -e AWS_ACCESS_KEY_ID="<key>" \
  -e AWS_SECRET_ACCESS_KEY="<secret>" \
  amazon/aws-cli s3api put-bucket-cors \
  --bucket lumio-prod \
  --endpoint-url https://<your-s3-endpoint> \
  --region <your-region> \
  --cors-configuration file:///path/to/cors.json
```

**With MinIO** CORS is permissive by default and should just work. If not, in the MinIO container:

```bash
docker compose exec minio mc anonymous set download local/lumio
```

### "S3 connection refused" / upload init fails

Look at the API logs (`docker compose logs api`). Common causes:

- **`S3_ENDPOINT` wrong** – should be `http://minio:9000` for MinIO or `https://<your-endpoint>` for external S3. **Not** localhost, the container can't reach that.
- **`S3_REGION` wrong** – default is `us-east-1`. For Hetzner it must be `fsn1` (or `nbg1`/`hel1`), otherwise a signature mismatch (403).
- **`S3_FORCE_PATH_STYLE` missing** – for most S3-compatibles (except AWS itself) this must be `true`.
- **Bucket doesn't exist** – some providers don't create it automatically. Create it manually in the provider console.

---

## Login problems

### No login button, blank page

Frontend logs:

```bash
docker compose logs frontend --tail=50
```

If `ECONNREFUSED` to port 3001 → the API is unreachable. Often due to a migration error in Postgres. Check the API logs:

```bash
docker compose logs api | grep -iE "error|migration"
```

### "Invalid credentials" despite correct details

Most common cause: the user was created in a different tenant and you're logging in on the wrong domain.

Not critical in single mode. In multi mode: check the tenant slug in the login URL.

List users:

```bash
docker compose exec api npx prisma studio
```

(Opens a web UI on port 5555 where you can inspect the user table.)

### `create-admin` runs, but login doesn't work

The password must be at least 12 characters long. With shorter passwords the script aborts – but if you call `create-admin` via custom code, a too-short password could slip through and fail at login.

Solution: create the admin again, the script is idempotent (overwrites an existing one).

---

## SaaS mode problems

### `price_not_configured` on sign-up

The Stripe plans haven't been created yet. Once:

```bash
docker compose exec api npm run stripe-bootstrap
```

Prerequisite: `STRIPE_SECRET_KEY` must be set in `.env` (with `sk_test_...` for test mode).

The script is idempotent and can run multiple times. It creates three plans (Solo, Studio, Pro) + a storage pack in Stripe and writes the price IDs into the Lumio DB.

### Stripe webhooks don't arrive

Check in the Stripe Dashboard → Developers → Webhooks:

- Endpoint URL correct: `https://your-domain.com/api/billing/webhook`
- Events subscribed: at least `customer.subscription.*`, `invoice.payment_*`, `checkout.session.completed`
- Signing secret in `.env` as `STRIPE_WEBHOOK_SECRET`
- Restart the API container after the .env change: `docker compose restart api`

Test: in the Stripe Dashboard you can trigger test events and see whether Lumio accepts them.

---

## Performance problems

### Upload slow

From the frontend to the API → to S3 storage and back to the browser is a detour. Lumio uses **presigned URLs**: the browser uploads directly to S3, without an API hop.

If that's slow:

- **External S3 instead of MinIO** – MinIO on a small VM saturates the disk quickly
- **Storage in the same datacenter** as the server (e.g. Hetzner Cloud + Hetzner Object Storage in Falkenstein)
- **`UPLOAD_CHUNK_SIZE_MIB`** in `.env` raised from 8 to 16 for large files

### Thumbnail generation takes forever

Worker logs:

```bash
docker compose logs worker --tail=50
```

- **High CPU usage?** Scale the workers: `docker compose up -d --scale worker=4`
- **Many large RAW files?** That's inherently CPU-intensive. For GPU acceleration see [GPU.md](GPU.md).
- **AI auto-tagging active?** CLIP runs on the CPU at 1–3 s per image. Here too GPU or more workers help.

---

## Last-resort debugging

When nothing else helps, reset everything (⚠️ **all data gone**):

```bash
docker compose down -v   # -v also deletes volumes!
docker compose up -d --build
```

Or partially – just the DB anew:

```bash
docker compose down
docker volume rm lumio_postgres_data
docker compose up -d
```

And beforehand, clone Lumio anew in a **fresh** directory to be sure there's no local drift in the configs.

---

## Report an issue

If you've found a bug that isn't listed here: open an issue at https://github.com/markusthiel/lumio/issues with:

1. What were you trying to do?
2. What happened?
3. Logs (`docker compose logs --tail=200`)
4. Setup mode (single/multi, MinIO or external S3, Caddy or external proxy)
5. Lumio version (`git rev-parse HEAD`)
