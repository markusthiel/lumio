**English** · [Deutsch](README.de.md)

# Lumio

**Self-hosted photo and video gallery for photographers and studios.**
A self-hostable alternative to Picdrop, Pixieset and Pic-Time — your data stays with you.

![Lumio gallery from the client's perspective](docs/images/01-gallery.jpg)

---

## Who is Lumio for?

Three typical setups — the Quick Start below covers the first; everything else is optional.

| You are… | Setup | Docs |
|---|---|---|
| **Photographer or studio** | Single mode, MinIO, one domain | [Quick Start](#quick-start) — 5 minutes |
| **Agency with several photographer clients** (self-hosted, for your own business) | Multi mode without billing, tenants created manually via super admin | [docs/MULTI_TENANT.md](docs/MULTI_TENANT.md) |

In **single mode** the tenant is created automatically on first start — you only need `create-admin` for your first user. No super admin, no Stripe.

> **Want to offer Lumio as a SaaS to paying third parties?** That's *Competing Use* and not freely permitted under the license (it's the business model behind our own lumio-cloud.de). A commercial license is available on request — see [License](#license). The SaaS mode is documented in [docs/SAAS_MODE.md](docs/SAAS_MODE.md).

---

## Features

- 🚀 **Fast** — Direct-to-S3 uploads, virtualized galleries, libvips thumbnails
- 📷 **RAW support** — CR2, CR3, NEF, ARW, RAF, DNG, ORF, PEF, RW2, X3F via LibRaw
- 🎬 **Video streaming** — HLS adaptive bitrate, scrubbing previews, poster frames
- 💬 **Proofing** — Likes, color tags, star ratings, comments, drawn annotations on photo **and video** (time-anchored), team voting
- 🎨 **Whitelabel** — Logo, colors, custom domains per studio or gallery
- 🔐 **Secure** — Signed URLs, Argon2 passwords, audit log
- ☁️ **Storage-flexible** — MinIO, S3, R2, B2, Wasabi, Hetzner Object Storage
- 🐳 **Docker-first** — `docker compose up` and it runs

The studio — manage galleries, smart collections, tag filters, team proofing:

![Lumio studio dashboard](docs/images/02-studio-dashboard.png)

---

## A closer look

**Proofing & annotation** — Clients like images, assign color tags and draw annotations directly on the photo, with per-photo comments.

![Proofing with annotations and color tags](docs/images/03-proofing.jpg)

![Annotating directly on the image](docs/images/feat-annotation.jpg)

**Video proofing** — Moving images get reviewed just like a photo: clients scrub through the video via filmstrip, place annotations at a specific point in time and draw directly on the still frame — with an optional note per annotation.

![Video annotation at a point in time](docs/images/feat-video-annotation.jpg)

Filmstrip scrubbing — dragging across the bar shows a preview of the respective frame with its timestamp:

![Scrubbing preview with frame and timestamp](docs/images/feat-video-scrubbing.jpg)

**Upload & formats** — Drag & drop with parallel uploads, duplicate detection and smart sections. JPEG, PNG, WebP, RAW, HEIC/HEIF, video and PDF — up to the configurable file limit.

![Upload with supported formats](docs/images/feat-upload.png)

**AI auto-tagging** — Images are tagged automatically (CLIP model); suggestions can be filtered by a confidence threshold and applied. Clients can optionally filter by tags.

![AI auto-tagging with image grid](docs/images/04-ai-tagging.jpg)

**Gallery design** — Per gallery: layout, image arrangement, slideshow transitions, hero image, event logo, colors. Whitelabel down to the detail.

![Gallery design and layouts](docs/images/05-gallery-design.png)

**Analytics** — Views, most popular images, downloads and an engagement funnel from visit to order.

![Statistics and engagement funnel](docs/images/06-analytics.png)

**Print shop** — Sell prints, canvases and photo books straight from the gallery. Your own providers, products, shipping, optionally with Stripe payment.

![Print shop setup](docs/images/07-print-shop.png)

**Security & GDPR** — Data processing agreement under Art. 28 GDPR signable electronically, share links with expiry and password, audit log and two-factor authentication.

![Data processing agreement (DPA) under Art. 28 GDPR](docs/images/feat-dsgvo.jpg)

**Webhooks & integrations** — Notify external tools via HTTP POST about gallery events. Every request is signed with your webhook secret.

![Webhooks configuration](docs/images/feat-webhooks.jpg)

**Light or dark mode** — The studio backend in light or dark, with its own accent color and logo variants for both modes. (The other screenshots here show dark mode.)

![Studio backend in light mode with base-tone switcher](docs/images/feat-theme.jpg)

---

## Quick Start

**5 minutes from zero to your first gallery.** Requirements: Docker + Docker Compose v2 (amd64 or arm64). Details: [docs/REQUIREMENTS.md](docs/REQUIREMENTS.md).

### 1. Get the repo and set secrets

```bash
git clone https://github.com/markusthiel/lumio.git
cd lumio
cp .env.example .env

# Generate and insert secure passwords
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=$(openssl rand -hex 12)|" .env
sed -i "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$(openssl rand -base64 32 | tr -d '/+=')|" .env
```

### 2. Start

```bash
docker compose up -d
```

This builds the containers and starts Postgres, Redis, MinIO, API, frontend, worker and Caddy. The first start takes 3–5 min (build + DB migration).

Check status:

```bash
docker compose ps
```

All services should be `running` (healthy).

### 3. Create an admin user

```bash
docker compose exec api npm run create-admin -- \
  --email=you@example.com \
  --password=atleast12chars \
  --name="Your Studio"
```

### 4. Log in

In your browser:

→ **http://localhost** (studio login)

> **Note:** Always access Lumio through **port 80** (the Caddy proxy) — it routes
> `/api/*` to the API. On a remote server, tunnel port 80, not 3000:
> `ssh -L 8080:127.0.0.1:80 your-server` → then open `http://localhost:8080`.
> (Since v0.49.1 the frontend port 3000 also proxies API calls as a fallback,
> but port 80 remains the intended entry point.)

After logging in you'll find gallery creation in the top left. Upload a photo, share the gallery link — done.

---

## It's running. What now?

- **Attach your own domain** → [docs/SELFHOSTING.md](docs/SELFHOSTING.md) (15-min setup with HTTPS)
- **Images disappear on container restart?** → MinIO stores data in the `minio_data` volume, which persists. Just make sure you don't accidentally `docker volume rm` it.
- **Set up backups** → [docs/BACKUP.md](docs/BACKUP.md)
- **Something going wrong?** → [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

---

## Architecture

```
┌──────────┐    ┌──────────┐    ┌────────────────┐
│ Frontend │◄──►│   API    │◄──►│ Postgres/Redis │
│ Next.js  │    │ Fastify  │    │  + S3 Storage  │
└──────────┘    └────┬─────┘    └────────────────┘
                     │
                     ▼
                ┌─────────┐
                │ Worker  │  RAW decode, thumbnails,
                │ Python  │  video transcode, ZIP build
                │ Celery  │
                └─────────┘
```

- **`apps/frontend`** — Next.js 16 (App Router) + Tailwind
- **`apps/api`** — Fastify + Prisma (Postgres) + BullMQ (Redis)
- **`apps/worker`** — Python + Celery + rawpy/pyvips/ffmpeg
- **`packages/shared`** — Shared TypeScript types + Zod schemas
- **`infra/`** — Caddy config, Postgres init

---

## Advanced setups

All optional. The Quick Start above is enough for a single studio.

| Scenario | Docs |
|---|---|
| Production behind your own domain with HTTPS | [docs/SELFHOSTING.md](docs/SELFHOSTING.md) |
| Multiple studios on one instance | [docs/MULTI_TENANT.md](docs/MULTI_TENANT.md) |
| SaaS mode with Stripe billing | [docs/SAAS_MODE.md](docs/SAAS_MODE.md) |
| GPU acceleration (NVENC + AI tags) | [docs/GPU.md](docs/GPU.md) |
| AI auto-tagging (CLIP) | [docs/ML.md](docs/ML.md) |
| Tenant subdomains via wildcard cert | [docs/WILDCARD.md](docs/WILDCARD.md) |
| Distribute load across multiple servers | [docs/SCALING.md](docs/SCALING.md) |
| External S3 instead of MinIO (R2, B2, Hetzner, Wasabi) | [docs/STORAGE.md](docs/STORAGE.md) |
| Backups, migrations, re-queue | [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| Contributing / development | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |

---

## License

[Functional Source License 1.1 (FSL-1.1-ALv2)](LICENSE) — a *source-available* license (not OSI open source).

**Permitted for everyone:**
- Individuals, professional photographers and studios: use, self-host, modify — including commercially for your own business
- Agencies: run Lumio as part of services for your own clients

**Not permitted:**
- Building a competing, hosted SaaS/cloud offering that provides the same or substantially similar functionality as Lumio to third parties as a product (*Competing Use*)

**Time-limited:** Each version automatically becomes available under the [Apache License 2.0](http://www.apache.org/licenses/LICENSE-2.0) two years after its release — then without restriction.

For a hosted/competing offering, a commercial license is available on request.

---

## Contributing

Pull requests welcome. See [CONTRIBUTING.md](CONTRIBUTING.md).

Issues & discussions: https://github.com/markusthiel/lumio/issues
