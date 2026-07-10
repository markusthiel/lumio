**English** · [Deutsch](SELFHOSTING-SYNOLOGY.de.md)

# Running Lumio on a Synology NAS

Lumio is a plain Docker Compose stack that brings everything it needs with it
(PostgreSQL, Redis, MinIO for object storage, Caddy, the app itself). That
means it *can* run on a Synology NAS — with some caveats around model, RAM and
TLS. This page is the Synology-specific companion to
[SELFHOSTING.md](SELFHOSTING.md); read that one too, this only covers the
deltas.

> **Status:** Synology is not an officially tested target. It works because it
> is standard Docker Compose on amd64/arm64 — but there is no one-click package
> and you should be comfortable with SSH and the DSM Reverse Proxy.

## Can your Synology run it?

- [ ] **DSM 7.2 or newer with the *Container Manager* package.** Container
      Manager ships Docker Engine ≥ 24 **and Compose v2** (`docker compose`),
      which Lumio requires. The older "Docker" package on DSM 6/early 7 only
      had Compose v1 and will *not* work without manual effort.
- [ ] **64-bit model.** Both `amd64` (Intel/AMD) and `arm64` (aarch64) are
      supported. **x86-64 "Plus"/"+" models are strongly recommended**
      (e.g. DS920+/DS923+, DS1522+/DS1621+). Old 32-bit ARM models are **not**
      supported.
- [ ] **RAM** (this is the usual bottleneck):
    - Photos only: **4 GB minimum**
    - With video transcoding: **8 GB**
    - With AI auto-tagging (ML worker): **+4 GB** on top — best left **off** on
      a NAS
- [ ] **Free disk** on a volume for the `minio_data` / `postgres_data` volumes,
      sized to your photo/video library.

If your NAS has 2 GB RAM or is a 32-bit ARM model, stop here — it won't be a
good experience.

## Performance — what to expect

- **The first `up` builds the images from source** (frontend, API and the
  Python worker with libvips). On a NAS CPU this is slow and RAM-hungry;
  budget **10–30+ minutes** and make sure you have a couple of GB of RAM free
  during the build. A weak/low-RAM NAS can OOM here — if so, build the images
  on a stronger machine and copy them over, or add RAM.
- **Video transcoding is by far the heaviest task** (x264 on CPU). A 2-core
  NAS will transcode a wedding's worth of clips slowly and one at a time.
  Photo-only studios are much lighter.
- **AI auto-tagging (CLIP) is optional and heavy** — the ML worker image is
  ~2.5 GB and wants +4 GB RAM. On a NAS, **don't enable the ML profile**;
  everything else works without it.
- **Local MinIO storage** is fine for a single studio; rule of thumb sensible
  up to ~500 GB. Beyond that, point Lumio at external S3 (see
  [STORAGE.md](STORAGE.md)) so the NAS only runs the app, not the storage.
- **Client downloads run directly from MinIO on your NAS**, so download speed
  for your clients is capped by your **home upload bandwidth**. For large
  galleries that matters more than the NAS itself. (Large ZIPs are split into
  parts automatically, which helps with flaky connections.)

Reference hardware table: [REQUIREMENTS.md](REQUIREMENTS.md).

## Limitations on a Synology

- **No GPU auto-tagging.** GPU acceleration needs NVIDIA/CUDA (amd64 only) —
  not available on any Synology. On CPU, tagging is functionally identical,
  just slower. See [GPU.md](GPU.md).
- **Ports 80/443 are taken by DSM.** You will remap Lumio's Caddy to high
  ports and front it with the DSM Reverse Proxy (below).
- **Building on the NAS can be painful** on low-end models (see Performance).
- **DSM updates / reboots restart containers.** With `restart: unless-stopped`
  the stack comes back on its own, but expect a few minutes of downtime during
  DSM maintenance.
- **This is single-studio self-hosting.** Multi-tenant/wildcard-TLS
  ([MULTI_TENANT.md](MULTI_TENANT.md)) is not something you want to run on a
  home NAS.

## Setup

### 1. Enable Container Manager

Install **Container Manager** from the Package Center (DSM 7.2+). Confirm over
SSH:

```bash
sudo docker compose version   # must print v2.x
```

### 2. Put the files on the NAS

Create a folder on a data volume, e.g. `/volume1/docker/lumio`, and get the
source there. Easiest over SSH (Control Panel → Terminal & SNMP → enable SSH):

```bash
mkdir -p /volume1/docker && cd /volume1/docker
git clone https://github.com/markusthiel/lumio.git
cd lumio
cp .env.example .env
```

If `git` isn't available on your NAS, download the repository as a ZIP on your
PC and upload the extracted folder via **File Station** instead.

### 3. Secrets and mode

Generate secrets (same as the generic guide):

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=$(openssl rand -hex 12)|" .env
sed -i "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$(openssl rand -base64 32 | tr -d '/+=')|" .env
```

`DEPLOYMENT_MODE=single` is the default — leave it. Single mode auto-creates a
studio on first start; no super admin needed.

### 4. Remap the ports away from DSM

DSM already listens on 80/443. Set Lumio's Caddy to high ports in `.env` so the
containers don't clash with DSM:

```bash
CADDY_HTTP_PORT=8080
CADDY_HTTPS_PORT=8443
```

(You can leave the MinIO ports at their defaults 9000/9001 unless something
else on the NAS uses them.)

### 5. TLS — use the DSM Reverse Proxy (recommended)

On a NAS the cleanest path is to let **DSM terminate HTTPS** with a
Synology-managed certificate and forward plain HTTP to Lumio's Caddy. Lumio's
Caddy explicitly supports running behind an external reverse proxy.

1. **DNS:** point a hostname at your NAS — a real domain, or Synology DDNS
   (`something.synology.me`). You need two names, e.g.
   `gallery.example.com` and `s3.example.com` (an S3 subdomain is the
   documented reverse-proxy pattern).
2. **Certificate:** in **Control Panel → Security → Certificate**, get a
   Let's Encrypt cert for both names (Synology does this for you with DDNS or
   your own domain).
3. **Reverse Proxy:** **Control Panel → Login Portal → Advanced → Reverse
   Proxy**, create two rules, both forwarding to the Caddy HTTP port:
    - `https://gallery.example.com` → `http://localhost:8080`
    - `https://s3.example.com` → `http://localhost:8080`
   Enable HTTP/2 and, under *Custom Header*, forward the `Host` header (WebSocket
   support on too — Lumio uses `/ws`).
4. **`.env`:** tell Lumio its public identity:

```bash
LUMIO_HOST=gallery.example.com
LUMIO_S3_HOST=s3.example.com
PUBLIC_URL=https://gallery.example.com
S3_PUBLIC_URL=https://s3.example.com
```

Lumio's Caddy trusts `X-Forwarded-Proto` from private ranges, so it correctly
sees the DSM-terminated HTTPS.

**Alternative (Caddy does TLS itself):** if you'd rather let Lumio handle
certificates, you must free up ports 80/443 — either move DSM's own ports
(Control Panel → Login Portal → change DSM HTTP/HTTPS ports) so Caddy can use
`CADDY_HTTP_PORT=80` / `CADDY_HTTPS_PORT=443`, or port-forward router
80→8080 / 443→8443. Caddy then obtains Let's Encrypt itself (needs port 80
reachable from the internet). The DSM Reverse Proxy route above is usually less
fuss on a NAS.

### 6. Start

```bash
sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

The first run builds the images (see Performance — be patient). Watch progress:

```bash
sudo docker compose logs -f
```

### 7. Create your admin user

```bash
sudo docker compose exec api npm run create-admin -- \
  --email=you@example.com \
  --password=atleast12chars \
  --name="Your Studio"
```

### 8. Log in

Open `https://gallery.example.com`, create a test gallery, upload an image,
share the link and open it from your phone. If that round-trip works, you're
live.

## Operating notes

- **Caddyfile changes need a restart, not a reload** (`admin off` is set):
  `sudo docker compose restart caddy`.
- **Back up two things:** the Postgres database and the MinIO object data
  (`minio_data` volume). See [BACKUP.md](BACKUP.md). Synology Hyper Backup can
  back up the `/volume1/docker/lumio` folder and the Docker volumes.
- **Updating:** `git pull` in the project folder, then re-run the `up -d`
  command from step 6 (add `--build` to force a rebuild). DB migrations run
  automatically on API start.
- Stuck? [TROUBLESHOOTING.md](TROUBLESHOOTING.md).

## See also

- [SELFHOSTING.md](SELFHOSTING.md) — the generic self-hosting guide (read first)
- [REQUIREMENTS.md](REQUIREMENTS.md) — hardware, architecture, sizing
- [STORAGE.md](STORAGE.md) — MinIO vs. external S3
- [BACKUP.md](BACKUP.md) — backup strategy
- [GPU.md](GPU.md) — why GPU tagging isn't available here
