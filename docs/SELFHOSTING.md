**English** · [Deutsch](SELFHOSTING.de.md)

# Production Self-Hosting

You've finished the Quick Start and now want to run Lumio cleanly under your own domain, with HTTPS and backups. This guide takes **15 minutes** and assumes:

- A Linux server with a public IP (Hetzner, Netcup, your own metal – doesn't matter),
  **amd64 or arm64** — both are supported
- A domain (e.g. `gallery.your-studio.com`)
- Docker + Docker Compose v2

Detailed hardware/architecture requirements: [REQUIREMENTS.md](REQUIREMENTS.md).

This guide covers **single studio**. For multi-tenant see [MULTI_TENANT.md](MULTI_TENANT.md).

---

## 1. Set up DNS

At your DNS provider, create an A record (and optionally AAAA for IPv6):

```
gallery.your-studio.com.   A     <server-ip>
```

Keep the TTL low for now (300s); you can raise it later.

Check:

```bash
dig gallery.your-studio.com +short
```

Should return your server IP.

## 2. Open the firewall

On the server (or via the cloud console):

```bash
# UFW as an example
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

**Important on Hetzner Cloud**: in addition to the OS firewall there's also the Cloud Firewall in the Hetzner console – open 80 and 443 there too, otherwise nothing gets through.

## 3. Install Lumio

```bash
mkdir -p /opt/docker && cd /opt/docker
git clone https://github.com/markusthiel/lumio.git
cd lumio
cp .env.example .env
```

Generate secure secrets:

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=$(openssl rand -hex 12)|" .env
sed -i "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$(openssl rand -base64 32 | tr -d '/+=')|" .env
```

## 4. Set the domain in .env

```bash
nano .env
```

Set these values:

```bash
LUMIO_HOST=gallery.your-studio.com
PUBLIC_URL=https://gallery.your-studio.com

# S3 public URL for browser uploads — same domain with the /s3 path,
# or a dedicated subdomain (see below)
S3_PUBLIC_URL=https://gallery.your-studio.com/s3
```

## 5. Start

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Caddy automatically obtains a Let's Encrypt certificate (takes about 30 seconds). Watch it:

```bash
docker compose logs -f caddy
```

Success looks like this: `certificate obtained successfully ... gallery.your-studio.com`.

## 6. Create an admin user

In single mode Lumio automatically creates a tenant named "My Studio" on first start – you don't need a super admin and don't create a tenant manually. Just the first user:

```bash
docker compose exec api npm run create-admin -- \
  --email=you@your-studio.com \
  --password=atleast12chars \
  --name="Your Studio"
```

## 7. Log in

→ `https://gallery.your-studio.com`

On first login create a test gallery, upload an image, share the gallery link, open it from another device. If everything works: you're live.

---

## Backups

Back up at least two things:

1. **Postgres** – the whole application database (users, galleries, permissions)
2. **S3 bucket** – the actual images/videos

### Nightly Postgres dump

Add to crontab (`crontab -e`):

```cron
0 3 * * * cd /opt/docker/lumio && docker compose exec -T postgres pg_dump -U lumio lumio | gzip > /backup/lumio-$(date +\%Y\%m\%d).sql.gz && find /backup -name "lumio-*.sql.gz" -mtime +14 -delete
```

Keeps 14 days. Then sync off-site (e.g. with `rclone` to a backup provider).

### S3 bucket backup

With MinIO simply rsync the `minio_data` volume. With external S3 (Hetzner, R2, B2) enable versioning + lifecycle – the providers do this in their console.

### Restore test

**Run a restore test on a test VM regularly.** An untested backup is not a backup.

---

## Updates

```bash
cd /opt/docker/lumio
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Prisma migrations run automatically on API start. **Take a Postgres dump before every update** – migrations are rarely reversible.

You can see the currently running version with `docker compose logs api | grep "Lumio API ready"`.

---

## Your own external S3 instead of MinIO

MinIO works well for smaller setups (up to ~500 GB). For more volume external S3 pays off:

- **Hetzner Object Storage** – cheap, GDPR, can be in the same datacenter as the server
- **Cloudflare R2** – free egress, good for CDN setups
- **Backblaze B2** – cheapest storage price, slightly higher latency

Setup steps: see [STORAGE.md](STORAGE.md).

**Important with external S3**: set CORS on the bucket! Lumio uploads images directly from the browser to S3 (presigned URLs). Without CORS that fails. Specifically:

```json
{
  "CORSRules": [{
    "AllowedOrigins": ["https://gallery.your-studio.com"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}
```

For Hetzner Object Storage additionally set `S3_FORCE_PATH_STYLE=true` and `S3_REGION=fsn1` (or your bucket location).

---

## Security

- **Never commit `.env`** – it's in `.gitignore`, but check anyway
- **Don't expose the Postgres port externally** – the default is already correct, only reachable internally
- **Secure the MinIO console (port 9001)** – in the production compose it isn't reachable from outside by default, only via `docker exec`
- **Encrypt backups** when stored on third-party storage (`gpg`, `restic`, `borg`)
- **SSH key-only login** on the server, no password auth
- **Enable unattended upgrades** for OS patches

---

## Common pitfalls

→ see [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
