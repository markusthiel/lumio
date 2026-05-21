# Lumio

**Self-hosted, schnelle, datenschutzfreundliche Plattform zum Teilen, Proofing und Ausliefern von Foto- und Video-Shootings.**

Open-Source-Alternative zu Picdrop / Pixieset / Pic-Time — gebaut für Fotograf:innen und Studios, die ihre Daten unter eigener Kontrolle behalten wollen.

> ⚠️ **Status: Pre-Alpha.** Das Projekt steckt in der initialen Entwicklung. Noch nicht produktionsreif.

---

## Features (Zielbild)

- 🚀 **Crazy fast** — Direkt-zu-S3-Uploads, virtualisierte Galerien, libvips-basierte Thumbnail-Pipeline
- 📷 **RAW-Support** — CR2, CR3, NEF, ARW, RAF, DNG, ORF, PEF, RW2, X3F via LibRaw
- 🎬 **Video-Streaming** — HLS Adaptive Bitrate, Scrubbing-Previews, Poster-Frames
- 💬 **Proofing & Collaboration** — Likes, Color-Tags, Star-Ratings, Kommentare, Team-Voting
- 🎨 **Whitelabel-Branding** — Logo, Farben, Custom Domains pro Studio oder pro Galerie
- 🔐 **Sicher** — Signed URLs, Argon2-Passwörter, Audit-Log, NDA-tauglich
- 🏢 **Multi-Tenant** — Eine Instanz für ein Studio oder für viele (konfigurierbar)
- ☁️ **Storage-flexibel** — MinIO lokal, AWS S3, Cloudflare R2, Backblaze B2, Wasabi
- 💳 **Hosted-Mode mit Billing** — Optionales Abrechnungsmodul (Stripe) für SaaS-Anbieter
- 🐳 **Docker-First** — `docker compose up` und es läuft. Portainer-tauglich.

Vollständige Feature-Liste und Architektur: siehe [docs/KONZEPT.md](docs/KONZEPT.md).

---

## Quick Start

**Voraussetzungen:** Docker + Docker Compose v2.

```bash
git clone https://forgejo.thiel.tools/thiel/lumio.git
cd lumio
cp .env.example .env
# Editiere .env und setze sichere Passwörter!
docker compose up -d
```

Nach dem Start:

- **Frontend (Studio + Galerien):** http://localhost:3000
- **API:** http://localhost:3001
- **MinIO Console:** http://localhost:9001
- **API Health Check:** http://localhost:3001/health

Den initialen Admin-Account legst du mit folgendem Befehl an:

```bash
docker compose exec api npm run create-admin -- --email=du@example.com --password=...
```

> 💡 Für ein echtes Production-Deployment hinter einer Domain (mit DNS, externem Reverse-Proxy o.ä.) siehe die [Production Deployment Checkliste](docs/DEVELOPMENT.md#production-deployment).

---

## Architektur

```
┌──────────┐    ┌──────────┐    ┌────────────────┐
│ Frontend │◄──►│   API    │◄──►│ Postgres/Redis │
│ Next.js  │    │ Fastify  │    │  + S3 Storage  │
└──────────┘    └────┬─────┘    └────────────────┘
                     │
                     ▼
                ┌─────────┐
                │ Worker  │  RAW decode, Thumbnails,
                │ Python  │  Video transcode, ZIP build
                │ Celery  │
                └─────────┘
```

- **`apps/frontend`** — Next.js 15 (App Router) + React + TypeScript + Tailwind
- **`apps/api`** — Fastify + TypeScript + Prisma (Postgres) + BullMQ (Redis)
- **`apps/worker`** — Python + Celery + rawpy/pyvips/ffmpeg
- **`packages/shared`** — geteilte TypeScript-Typen, Zod-Schemas
- **`infra/`** — Caddy-Config, Postgres-Init, Docker-Helper
- **`docs/`** — Konzept, Architektur, ADRs

---

## Entwicklung

Für lokale Entwicklung (mit Hot-Reload außerhalb von Docker):

```bash
# 1. Nur Infrastruktur in Docker starten
docker compose up -d postgres redis minio

# 2. Pro App in eigenem Terminal:
cd apps/api      && npm install && npm run dev
cd apps/frontend && npm install && npm run dev
cd apps/worker   && pip install -r requirements.txt && celery -A app worker -l info
```

Siehe [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) für Setup-Details.
Für den laufenden Betrieb (Deploy, Re-queue, Backfills, Diagnose) siehe
[docs/OPERATIONS.md](docs/OPERATIONS.md) — ein Cookbook für die häufigen
Alltagsaufgaben.

---

## Roadmap

Siehe [docs/ROADMAP.md](docs/ROADMAP.md) und die Issues im [Forgejo](https://forgejo.thiel.tools/thiel/lumio).

**Aktueller Stand:** Phase 0 — Skeleton & Infrastruktur.

---

## Lizenz

[AGPL-3.0](LICENSE) — Self-Hosting frei für jeden Zweck. SaaS-Anbieter, die das Tool für Dritte betreiben, müssen ihre Änderungen veröffentlichen.

Eine kommerzielle Lizenz für proprietäre Forks/Hosted-Services kann auf Anfrage erworben werden.

---

## Mitwirken

Pull Requests willkommen. Siehe [CONTRIBUTING.md](CONTRIBUTING.md).

Issues und Diskussionen: https://forgejo.thiel.tools/thiel/lumio/issues
