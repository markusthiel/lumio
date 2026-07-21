**English** · [Deutsch](DEVELOPMENT.de.md)

# Lumio — Development Guide

## Requirements

- **Docker** + **Docker Compose v2** (Compose v1 works too, but without the `docker compose` CLI)
- **Node.js 20+** (for API + frontend without Docker)
- **Python 3.12+** (for the worker without Docker)
- **pnpm** or **npm** (we use npm in the standard setup)
- **git** and a Forgejo/Git client

## First setup

```bash
git clone https://github.com/markusthiel/lumio.git
cd lumio
cp .env.example .env
```

**Important:** change at least these values in `.env`:

- `POSTGRES_PASSWORD` — any long random string
- `S3_ACCESS_KEY`, `S3_SECRET_KEY` — MinIO credentials
- `JWT_SECRET`, `SESSION_SECRET` — `openssl rand -base64 32`

## Fully in Docker

```bash
docker compose up -d --build
```

On the first start the following happens:

1. Postgres starts, creates the DB, loads extensions
2. MinIO starts, creates the bucket (via the `minio_init` service)
3. The API runs the Prisma migration and starts on port 3001
4. The frontend builds itself and starts on port 3000
5. Caddy binds 80/443

Reachable:

- Frontend: http://localhost:3000
- API health: http://localhost:3001/health
- MinIO console: http://localhost:9001
- (via Caddy on port 80, unified routing)

View logs:

```bash
docker compose logs -f api
docker compose logs -f worker
```

Stop:

```bash
docker compose down              # keeps volumes
docker compose down -v           # deletes everything incl. DB/storage
```

## Production deployment

The default `docker-compose.yml` brings up a working stack — but for a real deployment behind a public domain there are a few knobs that are guaranteed to hurt at first bring-up if you don't set them correctly from the start. This checklist sums up everything a self-hoster should know before the first `docker compose up`.

### Three topologies — which one fits you?

**A) Lumio does TLS itself**
- Own IP/VM, Lumio's Caddy binds 80+443
- Caddy fetches Let's Encrypt certificates automatically
- The simplest variant if the host is exclusively for Lumio

**B) Behind an external TLS proxy** (e.g. Caddy/Nginx/Traefik in the same household for several services)
- The external proxy does HTTPS termination
- Lumio's Caddy listens internally on HTTP, the external proxy passes through
- What we use here in this project

**C) Local setup / tests**
- Everything on `localhost`, no real hostnames
- The default `.env.example` is geared toward this

### DNS setup

Lumio needs **two** hostnames:

1. **App domain** (e.g. `galleries.example.com`) — frontend + API
2. **S3 subdomain** (e.g. `s3.galleries.example.com`) — MinIO/object storage

The S3 subdomain is not optional. We tried running it via a path prefix of the main domain (`/s3/...`), but MinIO doesn't support that — the V4 signature covers the full path, a reverse-proxy rewrite always produces `SignatureDoesNotMatch`. A separate subdomain is the standard way, also in MinIO's own docs.

Both A records point to the same IP.

### `.env` for each topology

**A) Lumio does TLS itself:**
```env
LUMIO_HOST=galleries.example.com
LUMIO_S3_HOST=s3.galleries.example.com
PUBLIC_URL=https://galleries.example.com
S3_PUBLIC_URL=https://s3.galleries.example.com
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443
```

Important: NO `http://` prefix on `LUMIO_HOST`/`LUMIO_S3_HOST` — otherwise Caddy thinks you only want HTTP and fetches no certificate.

**B) Behind an external TLS proxy:**
```env
LUMIO_HOST=http://galleries.example.com
LUMIO_S3_HOST=http://s3.galleries.example.com
PUBLIC_URL=https://galleries.example.com
S3_PUBLIC_URL=https://s3.galleries.example.com
CADDY_HTTP_PORT=32080
CADDY_HTTPS_PORT=32443
FRONTEND_PORT=33030
API_PORT=33031
MINIO_API_PORT=32091
MINIO_CONSOLE_PORT=32092
```

Here WITH the `http://` prefix — otherwise Lumio's Caddy tries Let's Encrypt for the hostnames itself and fails.

In the external proxy you then need:

```caddyfile
galleries.example.com {
    reverse_proxy <docker-host>:32080
}
s3.galleries.example.com {
    reverse_proxy <docker-host>:32080
}
```

Important: **don't overwrite the Host header** in the external proxy. The default behavior in Caddy/Nginx is correct, but if someone wrote `proxy_set_header Host $proxy_host` or Caddy's `header_up Host {upstream_hostport}` in there — remove it. MinIO verifies the V4 signature via the request's Host header, which must match the one the API signed the URL with (`S3_PUBLIC_URL`).

**C) Local setup:** the `.env.example` defaults fit, change nothing.

### Check for port conflicts before the start

Before you run `docker compose up`, check that the ports are free just in case:

```bash
ss -tlnp | grep -E ':(32080|32443|33030|33031|32091|32092)\s'
```

No output = all free. Important: `127.0.0.1:3000` mappings (loopback binding) do **not protect** against conflicts with `0.0.0.0:3000` listeners — the kernel reserves the port regardless of address.

### Generate secrets

```bash
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -base64 24   # S3_ACCESS_KEY (shorter looks more like a real access key)
openssl rand -base64 32   # S3_SECRET_KEY
```

Put those into the `.env`.

### Bring-up

```bash
docker compose up -d --build
docker compose ps                    # all "Up" / "healthy"?
docker compose logs --tail=30 api    # "Lumio API ready" visible?
```

If containers come up but then restart again: `docker compose logs --tail=50 <service>` shows why for each.

### Create an admin user

```bash
docker compose exec api npm run create-admin -- \
    --email=you@example.com --password=long_password --name="Your Studio"
```

In multi-tenant mode additionally `--tenant=<slug> --tenant-name="..."`.

### Smoke test

After the start, click through systematically, in this order:

1. **Login** at `https://galleries.example.com/login` → studio
2. **Create branding** → upload a logo (PNG ~200 KB) → the logo shows in the editor
3. **Create a gallery** → link the branding → status to `live`
4. **Upload a test image** in the studio gallery detail → status runs through `uploading → processing → ready`, a thumbnail appears
5. **Optional: test video** (~30 s, MP4 H.264) → the same flow, the worker additionally does HLS transcoding
6. **Copy the share link** → open it in an incognito tab → the images are visible

If one of these steps goes wrong, `docker compose logs --tail=80 api worker` shows the cause. The most common first-deploy errors are below under "Common pitfalls".

### Backups

Back up at least these two volumes:

- `postgres_data` — metadata (users, galleries, file records, sessions)
- `minio_data` — all image/video files

Example with `restic` for a daily backup of both:

```bash
docker run --rm \
    --volumes-from lumio_postgres \
    --volumes-from lumio_minio \
    -e RESTIC_REPOSITORY=... -e RESTIC_PASSWORD=... \
    restic/restic backup /var/lib/postgresql/data /data
```

(Adapt to your backup stack.)

### Hardware video encoding (optional)

HLS transcoding dominates the worker load on large galleries. By default Lumio uses `libx264` (CPU) — portable, runs everywhere without configuration. If you have a GPU, you can switch the worker to hardware encoding and transcode 5–10× faster depending on the source.

Controlled via the env variable `LUMIO_HW_ENCODER` in the worker container:

| Value | Meaning |
|---|---|
| `auto` (default) | Tries NVENC → QSV → VAAPI, falls back to software |
| `nvenc` | NVIDIA GPU (RTX/Quadro/etc.) |
| `qsv` | Intel QuickSync |
| `vaapi` | VA-API (Intel/AMD on Linux) |
| `software` | Forces `libx264`, no hardware probes |

With `auto` the worker will probe on the first video which encoders the ffmpeg binary actually ships (`ffmpeg -encoders`), and cache the result.

**Container-side prerequisites:**

- **VAAPI** (easiest — Intel GPU or AMD GPU on a Linux host):
  ```yaml
  worker:
    devices:
      - /dev/dri/renderD128:/dev/dri/renderD128
    group_add:
      - "render"   # GID of the render group on the host (cat /etc/group | grep render)
    environment:
      LUMIO_HW_ENCODER: "vaapi"
  ```
  The Debian ffmpeg package in the standard worker image already has VAAPI in it.

- **NVENC** (NVIDIA GPU): NVIDIA Container Toolkit installed + start the worker with `--gpus all`. The standard ffmpeg from the Debian repos has **no** NVENC compiled in — you need an image with `jellyfin/ffmpeg` or a self-built ffmpeg with `--enable-nvenc`.

- **QSV** (Intel): like VAAPI, plus additionally `intel-media-va-driver`.

Without these setup steps only `software` works; `auto` detects that and falls back accordingly, a warning lands in the worker log (`encoder.requested_unavailable`).

### Deployment from the container registry

> **Note:** this path is maintainer-internal (private registry). Self-hosters and external contributors build the images from source (`docker compose up -d --build`) and need no registry access.

The CI builds three container images on every push to `main` and pushes them to the Forgejo container registry:

```
forgejo.thiel.tools/thiel/lumio-api:<tag>
forgejo.thiel.tools/thiel/lumio-frontend:<tag>
forgejo.thiel.tools/thiel/lumio-worker:<tag>
```

Tag scheme:

- `:latest` and `:main` — the last successful `main` build
- `:v0.2.0` — Git tags (`v*`) are taken over 1:1 as the image tag
- `:<short-sha>` — every build additionally gets its commit SHA as a tag, so you can pin to exactly one code version

On the production host you use the `docker-compose.prod.yml` as an override, which replaces the `build:` blocks with `image:` references:

```bash
cd /opt/docker/lumio/lumio
git pull   # only to keep docker-compose.* up to date

docker compose \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    pull

docker compose \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    up -d
```

Tag selection via the env variable `LUMIO_TAG`:

```bash
LUMIO_TAG=v0.2.0 docker compose \
    -f docker-compose.yml \
    -f docker-compose.prod.yml \
    up -d
```

If your Forgejo registry is private (the default for non-public repos), you need a pull login on the server:

```bash
docker login forgejo.thiel.tools
# Username: your Forgejo name
# Password: Forgejo personal access token with scope `read:package`
```

The login is persisted in `~/.docker/config.json` (or `/root/.docker/config.json` for the root Compose) and is enough for all subsequent pulls.

**CI setup:** the registry push workflow needs two secrets in Forgejo under `Settings → Actions → Secrets`:

| Name | Value |
|---|---|
| `REGISTRY_USER` | Your Forgejo username |
| `REGISTRY_TOKEN` | Personal access token with scope `write:package` |

**Registry cleanup:** Forgejo has built-in cleanup rules under `User settings → Packages → Cleanup Rules`. Sensible defaults for Lumio:

- Match: `lumio-*`
- Keep the most recent: `5`
- Keep versions matching: `^(latest|main|v.*)$` (keep branch and release tags)
- Remove versions older than: `30 days`

This keeps the last 5 SHA builds plus all release tags and the branch pointer; older SHA tags are removed automatically.

### Outbound webhooks (studio → external tools)

Per tenant you can configure HTTPS endpoints that are called with a signed POST on certain events. Configuration in the studio under `/studio/webhooks`. The current event whitelist (comes from `apps/api/src/services/webhooks.ts`):

| Event | When |
|---|---|
| `gallery.created` | A new gallery created |
| `gallery.live` | Gallery status changes to `live` |
| `gallery.deleted` | Gallery permanently deleted |
| `selection.finalized` | The customer finalized their selection |
| `comment.posted` | A comment on a file |
| `file.uploaded` / `file.failed` | reserved, not currently fired |

**Request format:** JSON body
`{ "event": "<type>", "timestamp": "<iso>", "data": { ... } }`
Headers:

```
Content-Type:      application/json
X-Lumio-Event:     gallery.created
X-Lumio-Timestamp: 1730000000
X-Lumio-Signature: sha256=<hex>
User-Agent:        Lumio-Webhook/1.0
```

**Signature:** HMAC-SHA256 over `<timestamp>.<body>` with the webhook secret. Identical scheme to GitHub/Stripe. Example verification on the receiver side:

**Node/Express:**

```js
const crypto = require("node:crypto");
const SECRET = process.env.LUMIO_WEBHOOK_SECRET;
app.post("/lumio-hook",
  express.raw({ type: "application/json" }),
  (req, res) => {
    const ts = req.header("X-Lumio-Timestamp");
    const sig = req.header("X-Lumio-Signature");
    const expected = "sha256=" + crypto
      .createHmac("sha256", SECRET)
      .update(`${ts}.${req.body.toString("utf-8")}`)
      .digest("hex");
    if (!crypto.timingSafeEqual(Buffer.from(sig), Buffer.from(expected))) {
      return res.status(401).end();
    }
    // Replay protection: check the timestamp (e.g. max 5 min old)
    const age = Math.abs(Date.now() / 1000 - Number(ts));
    if (age > 300) return res.status(401).end();

    const event = JSON.parse(req.body);
    // ... process ...
    res.status(204).end();
  });
```

**Python/Flask:**

```python
import hashlib, hmac, time
from flask import request, abort

SECRET = b"..."

@app.post("/lumio-hook")
def hook():
    ts = request.headers["X-Lumio-Timestamp"]
    sig = request.headers["X-Lumio-Signature"]
    body = request.get_data()
    expected = "sha256=" + hmac.new(
        SECRET, f"{ts}.".encode() + body, hashlib.sha256
    ).hexdigest()
    if not hmac.compare_digest(sig, expected):
        abort(401)
    if abs(time.time() - int(ts)) > 300:
        abort(401)
    payload = request.get_json()
    # ... process ...
    return "", 204
```

**Retry behavior:** on 2xx the delivery is complete. On 4xx (except 408/429) the worker gives up directly — the receiver signaled that the request isn't right as is. On 5xx, a timeout or a network error, the worker retries with exponential backoff (5s, 25s, 2min, 10min, 1h, then finally dead). Receivers therefore don't have to deliver 100% uptime, but the handling should be idempotent — the same event can arrive multiple times if the first attempt was a 5xx and the retry still got through.

**Audit:** in the studio under `/studio/webhooks` → select a webhook → "Last deliveries" lists the last 50 attempts with HTTP status and error text. Successful = green, dead = red, pending = yellow. Via `POST /webhooks/:id/test` (the "Test" button in the UI) you can send a `test.ping` event immediately to check the receiver verification, without having to wait for a real trigger.

**Secret lifecycle:** on creation it's generated once and returned in the create response. Later GETs no longer return the secret. If lost: delete the webhook, create a new one.

## Hybrid: infra in Docker, apps local

For fast hot reload:

```bash
# 1. Only the infrastructure in Docker
docker compose up -d postgres redis minio minio_init

# 2. API locally
cd apps/api
npm install
npx prisma migrate deploy
npm run dev          # port 3001, watch mode

# 3. Frontend locally
cd apps/frontend
npm install
npm run dev          # port 3000, fast refresh

# 4. Worker locally (in a venv)
cd apps/worker
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
celery -A app worker -l info -c 2
```

`.env` is read in all three apps (dotenv). For a local setup adjust `DATABASE_URL` so it reads `localhost:5432` instead of `postgres:5432` — for that, expose the Postgres port in the Compose file (see the comment in `docker-compose.yml`).

## Create an admin user (dev)

In the development setup (apps local, no production domain):

```bash
# Via Docker
docker compose exec api npm run create-admin -- --email=you@example.com --password=secret --name="Your Studio"

# Locally (from source, without a build)
cd apps/api && npm run create-admin:dev -- --email=you@example.com --password=secret
```

In the production container use `create-admin` instead (without the `:dev` suffix), see the "Production deployment" section further up.

## Database migrations

We use Prisma:

```bash
# Change the schema in apps/api/prisma/schema.prisma, then:
cd apps/api
npx prisma migrate dev --name description_of_the_change

# Roll out in the container:
docker compose exec api npx prisma migrate deploy
```

## Tests

```bash
cd apps/api && npm test         # Vitest
cd apps/frontend && npm test    # not set up yet
cd apps/worker && pytest        # not set up yet
```

## Code style

- **TypeScript** strict mode, no `any`
- **Python** PEP 8 + type hints, `ruff` as the linter (still coming)
- **Commits** per Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- **PRs** describe the what and why, not the how (that's in the code)

## Common pitfalls

### General

- **`pyvips` needs libvips42 on the system.** In the Docker image it's there; locally `apt install libvips42` (Linux) or `brew install vips` (macOS).
- **`rawpy` needs libraw.** In the Docker image: `libraw-bin`. Locally: `apt install libraw-dev` and reinstall.
- **MinIO with `S3_FORCE_PATH_STYLE=true`** — AWS S3 itself wants `false`.
- **CORS with a local frontend without Caddy:** the API has to know `PUBLIC_URL=http://localhost:3000` and set CORS accordingly. MinIO allows browser uploads via `MINIO_API_CORS_ALLOW_ORIGIN=*` (already set in `docker-compose.yml`).
- **Forgot prisma generate:** after a schema change run `npx prisma generate`, otherwise the types are stale.
- **Multipart upload needs the ETag header.** S3/MinIO must **expose** the `ETag` response header on `UploadPart` requests (CORS `ExposeHeaders`). MinIO does that automatically with `MINIO_API_CORS_ALLOW_ORIGIN=*`; with AWS S3 the bucket CORS must explicitly set `<ExposeHeader>ETag</ExposeHeader>`.

### Deployment

Pitfalls that typically strike on the FIRST real deploy:

- **`ambiguous site definition: :80`** in the Caddy log → both `LUMIO_HOST` and `LUMIO_S3_HOST` evaluate to the same address. Fix: use real hostnames, then Caddy does host-based routing on the same port.
- **`Bind for 0.0.0.0:3000 failed: port is already allocated`** despite a `127.0.0.1:` binding → another service on the host is already listening on `0.0.0.0:3000`. Loopback and 0.0.0.0 share the same port reservation in the kernel. Fix: pick a free port in the `.env` (`FRONTEND_PORT=33030` or similar).
- **Browser upload fails with "DNS error: minio"** → only affects versions before v0.51.0 (since then, without `S3_PUBLIC_URL` the API automatically signs against `http://<request-host>:9000`). If it still happens: `S3_PUBLIC_URL` points at the internal container hostname — set it to the public S3 subdomain (`https://s3.galleries.example.com`) or unset it.
- **Browser upload gets a 403 `SignatureDoesNotMatch`** → a proxy between the browser and MinIO changes the Host header. MinIO verifies V4 via the Host. Fix: `header_up Host {host}` in Lumio's Caddy, and in the external proxy pass the Host header through **unchanged** (the default in Caddy, in Nginx `proxy_set_header Host $host;`).
- **The studio branding logo shows a 404 in the console** → the API wasn't rebuilt after the `serializeBranding` fix. `docker compose up -d --build api`.
- **The API restarts endlessly with `Could not parse schema engine response`** → Prisma doesn't find libssl in the Alpine image. Shouldn't happen with the default `Dockerfile` (we install `openssl3` and set `binaryTargets`), but if it does: check whether the current image was built.
- **The worker restarts endlessly with `wait: Illegal option -n`** → `entrypoint.sh` runs in the wrong shell. The shebang is `#!/bin/bash`, that should fit with the default image.
- **`create-admin` reports `tsx: not found`** → the production image ships only `node` + compiled JS. `npm run create-admin` now calls `node dist/scripts/create-admin.js`; in dev mode `npm run create-admin:dev`.
- **The gallery shows files with thumbnails in the studio, but the customer page is empty** → the files are probably on `status='failed'`. The customer page hides `failed`, the studio shows everything. Check the API/worker log for what went wrong. Delete the files and re-upload — `failed` doesn't retry automatically.

## Upload pipeline (data flow)

This is how a file flows through the system on upload:

```
Browser (uploadFiles)
   │
   │ 1) POST /api/v1/uploads/init  (filenames + sizes)
   ▼
API
   │ 1a) Check gallery ownership, check the size limit
   │ 1b) Per file: file record (status=uploading) + generate a storage key
   │ 1c) Return presigned PUT URLs (single or multipart parts)
   ▼
Browser
   │ 2) PUT directly to S3/MinIO with progress
   │ 3) POST /api/v1/uploads/complete  (with the ETag list for multipart)
   ▼
API
   │ 3a) Multipart complete at S3 (if multipart)
   │ 3b) files.status = "processing"
   │ 3c) Push a job into the Redis stream "lumio:jobs:file_processing"
   ▼
Worker (stream consumer)
   │ 4) xreadgroup → receives the job
   │ 5) Celery send_task → process_file.generate_renditions
   ▼
Celery worker
   │ 6) Load S3 → /tmp/source
   │ 7) pyvips: autorotate → resize → WebP (thumb/preview/web)
   │ 8) Upload renditions to S3, create DB records
   │ 9) files.status = "ready"
   ▼
The frontend polls /api/v1/galleries/:id every 2s
   → once ready, the thumb URL is visible in the grid
```

In phase 2 we replace the polling with WebSocket push.

## Architecture decisions (ADRs)

Larger architecture decisions are documented in `docs/adr/` as short records. Format:

```
# ADR-NNNN: Title

## Status
accepted / proposed / superseded

## Context
Why was the decision due?

## Decision
What was decided?

## Consequences
What does that mean positively/negatively?
```
