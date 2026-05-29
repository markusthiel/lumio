# Lumio

**Self-hosted Foto- und Video-Galerie für Fotograf:innen und Studios.**
Open-Source-Alternative zu Picdrop, Pixieset und Pic-Time — Daten bleiben bei dir.

> ⚠️ **Status: Pre-Alpha.** In aktiver Entwicklung. Noch nicht produktionsreif. Daten sichern.

---

## Für wen ist Lumio?

Drei typische Setups – das Quick-Start unten deckt den ersten ab, alles andere ist optional.

| Du bist… | Setup | Doku |
|---|---|---|
| **Fotograf:in oder Studio** | Single-Mode, MinIO, eine Domain | [Quick Start](#quick-start) — 5 Minuten |
| **Agentur mit mehreren Fotograf-Kunden** (selbst hostend, keine Abrechnung über Lumio) | Multi-Mode ohne Billing, Tenants manuell per Super-Admin | [docs/MULTI_TENANT.md](docs/MULTI_TENANT.md) |
| **SaaS-Anbieter mit zahlenden Kunden** | Multi-Mode mit Stripe-Billing, Self-Service-Signup über Marketing-Site | [docs/SAAS_MODE.md](docs/SAAS_MODE.md) |

Im **Single-Mode** wird der Tenant beim ersten Start automatisch angelegt – du brauchst nur `create-admin` für deinen ersten User. Kein Super-Admin, kein Stripe.

---

## Features

- 🚀 **Schnell** — Direkt-zu-S3-Uploads, virtualisierte Galerien, libvips-Thumbnails
- 📷 **RAW-Support** — CR2, CR3, NEF, ARW, RAF, DNG, ORF, PEF, RW2, X3F via LibRaw
- 🎬 **Video-Streaming** — HLS Adaptive Bitrate, Scrubbing-Previews, Poster-Frames
- 💬 **Proofing** — Likes, Color-Tags, Star-Ratings, Kommentare, Team-Voting
- 🎨 **Whitelabel** — Logo, Farben, Custom Domains pro Studio oder Galerie
- 🔐 **Sicher** — Signed URLs, Argon2-Passwörter, Audit-Log
- ☁️ **Storage-flexibel** — MinIO, S3, R2, B2, Wasabi, Hetzner Object Storage
- 🐳 **Docker-First** — `docker compose up` und es läuft

---

## Quick Start

**5 Minuten von Null zu erster Galerie.** Voraussetzungen: Docker + Docker Compose v2.

### 1. Repo holen und Secrets setzen

```bash
git clone https://forgejo.thiel.tools/thiel/lumio.git
cd lumio
cp .env.example .env

# Sichere Passwörter generieren und einsetzen
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=$(openssl rand -hex 12)|" .env
sed -i "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$(openssl rand -base64 32 | tr -d '/+=')|" .env
```

### 2. Starten

```bash
docker compose up -d
```

Das baut die Container und startet Postgres, Redis, MinIO, API, Frontend, Worker und Caddy. Der erste Start dauert 3–5 Min (Build + DB-Migration).

Status prüfen:

```bash
docker compose ps
```

Alle Services sollten `running` (healthy) sein.

### 3. Admin-User anlegen

```bash
docker compose exec api npm run create-admin -- \
  --email=du@example.com \
  --password=mindestens12zeichen \
  --name="Dein Studio"
```

### 4. Einloggen

Im Browser:

→ **http://localhost** (Studio-Login)

Nach dem Login findest du oben links die Galerie-Erstellung. Lade ein Foto hoch, teile den Galerie-Link — fertig.

---

## Es läuft. Was jetzt?

- **Eigene Domain dranhängen** → [docs/SELFHOSTING.md](docs/SELFHOSTING.md) (15-Min-Setup mit HTTPS)
- **Bilder gehen verloren beim Container-Restart?** → MinIO speichert in `caddy_data`-Volume, das persistiert. Sicher dass du das Volume nicht versehentlich `docker volume rm`'st.
- **Backups einrichten** → [docs/BACKUP.md](docs/BACKUP.md)
- **Was läuft schief?** → [docs/TROUBLESHOOTING.md](docs/TROUBLESHOOTING.md)

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

- **`apps/frontend`** — Next.js 16 (App Router) + Tailwind
- **`apps/api`** — Fastify + Prisma (Postgres) + BullMQ (Redis)
- **`apps/worker`** — Python + Celery + rawpy/pyvips/ffmpeg
- **`packages/shared`** — Geteilte TypeScript-Typen + Zod-Schemas
- **`infra/`** — Caddy-Config, Postgres-Init

---

## Erweiterte Setups

Alles optional. Das Quick-Start oben reicht für ein einzelnes Studio.

| Szenario | Doku |
|---|---|
| Production hinter eigener Domain mit HTTPS | [docs/SELFHOSTING.md](docs/SELFHOSTING.md) |
| Mehrere Studios auf einer Instanz | [docs/MULTI_TENANT.md](docs/MULTI_TENANT.md) |
| SaaS-Modus mit Stripe-Billing | [docs/SAAS_MODE.md](docs/SAAS_MODE.md) |
| GPU-Beschleunigung (NVENC + KI-Tags) | [docs/GPU.md](docs/GPU.md) |
| KI-Auto-Tagging (CLIP) | [docs/ML.md](docs/ML.md) |
| Tenant-Subdomains via Wildcard-Cert | [docs/MULTI_TENANT.md#wildcards](docs/MULTI_TENANT.md#wildcards) |
| Externes S3 statt MinIO (R2, B2, Hetzner, Wasabi) | [docs/STORAGE.md](docs/STORAGE.md) |
| Backups, Migrationen, Re-Queue | [docs/OPERATIONS.md](docs/OPERATIONS.md) |
| Mitwirken / Entwicklung | [docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) |

---

## Lizenz

[AGPL-3.0](LICENSE) — Self-Hosting frei für jeden Zweck (auch kommerziell für die eigene Geschäftstätigkeit). SaaS-Anbieter, die Lumio für Dritte betreiben, müssen ihre Änderungen veröffentlichen.

Kommerzielle Lizenz für proprietäre Forks/Hosted-Services auf Anfrage.

---

## Mitwirken

Pull Requests willkommen. Siehe [CONTRIBUTING.md](CONTRIBUTING.md).

Issues & Diskussionen: https://forgejo.thiel.tools/thiel/lumio/issues
