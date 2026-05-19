# Lumio — Development Guide

## Voraussetzungen

- **Docker** + **Docker Compose v2** (Compose v1 funktioniert auch, aber ohne `docker compose`-CLI)
- **Node.js 20+** (für API + Frontend ohne Docker)
- **Python 3.12+** (für Worker ohne Docker)
- **pnpm** oder **npm** (wir verwenden npm im Standard-Setup)
- **git** und ein Forgejo/Git-Client

## Erstes Setup

```bash
git clone https://forgejo.thiel.tools/thiel/lumio.git
cd lumio
cp .env.example .env
```

**Wichtig:** In der `.env` mindestens diese Werte ändern:

- `POSTGRES_PASSWORD` — irgendein langer Random-String
- `S3_ACCESS_KEY`, `S3_SECRET_KEY` — MinIO-Credentials
- `JWT_SECRET`, `SESSION_SECRET` — `openssl rand -base64 32`

## Komplett in Docker

```bash
docker compose up -d --build
```

Beim ersten Start passiert:

1. Postgres startet, legt DB an, lädt Extensions
2. MinIO startet, legt Bucket an (über `minio_init`-Service)
3. API führt Prisma-Migration aus und startet auf Port 3001
4. Frontend baut sich und startet auf Port 3000
5. Caddy bindet 80/443

Erreichbar:

- Frontend: http://localhost:3000
- API Health: http://localhost:3001/health
- MinIO Console: http://localhost:9001
- (via Caddy auf Port 80, einheitliches Routing)

Logs ansehen:

```bash
docker compose logs -f api
docker compose logs -f worker
```

Stoppen:

```bash
docker compose down              # behält Volumes
docker compose down -v           # löscht alles inkl. DB/Storage
```

## Hybrid: Infra in Docker, Apps lokal

Für schnellen Hot-Reload:

```bash
# 1. Nur Infrastruktur in Docker
docker compose up -d postgres redis minio minio_init

# 2. API lokal
cd apps/api
npm install
npx prisma migrate deploy
npm run dev          # Port 3001, watch mode

# 3. Frontend lokal
cd apps/frontend
npm install
npm run dev          # Port 3000, fast refresh

# 4. Worker lokal (in venv)
cd apps/worker
python -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
celery -A app worker -l info -c 2
```

`.env` wird in allen drei Apps gelesen (dotenv). Für lokales Setup `DATABASE_URL` so anpassen, dass `localhost:5432` statt `postgres:5432` steht — dazu in der Compose-Datei den Postgres-Port freigeben (siehe Kommentar in `docker-compose.yml`).

## Admin-User anlegen

```bash
# Über Docker
docker compose exec api npm run create-admin -- --email=du@example.com --password=geheim --name="Dein Studio"

# Lokal
cd apps/api && npm run create-admin -- --email=du@example.com --password=geheim
```

## Datenbank-Migrationen

Wir nutzen Prisma:

```bash
# Schema ändern in apps/api/prisma/schema.prisma, dann:
cd apps/api
npx prisma migrate dev --name beschreibung_der_aenderung

# Im Container ausrollen:
docker compose exec api npx prisma migrate deploy
```

## Tests

```bash
cd apps/api && npm test         # Vitest
cd apps/frontend && npm test    # noch nicht eingerichtet
cd apps/worker && pytest        # noch nicht eingerichtet
```

## Code Style

- **TypeScript** strict mode, kein `any`
- **Python** PEP 8 + type hints, `ruff` als Linter (kommt noch)
- **Commits** nach Conventional Commits: `feat:`, `fix:`, `chore:`, `docs:`, `refactor:`, `test:`
- **PRs** beschreiben das Was und Warum, nicht das Wie (das steht im Code)

## Häufige Stolperfallen

- **`pyvips` braucht libvips42 im System.** Im Docker-Image ist es da; lokal `apt install libvips42` (Linux) oder `brew install vips` (macOS).
- **`rawpy` braucht libraw.** Im Docker-Image: `libraw-bin`. Lokal: `apt install libraw-dev` und neu installieren.
- **MinIO mit `S3_FORCE_PATH_STYLE=true`** — AWS S3 selbst will `false`.
- **CORS bei lokalem Frontend ohne Caddy:** API muss `PUBLIC_URL=http://localhost:3000` kennen und CORS entsprechend setzen.
- **Prisma generate vergessen:** nach Schema-Änderung `npx prisma generate` ausführen, sonst sind die Types veraltet.

## Architektur-Entscheidungen (ADRs)

Größere Architektur-Entscheidungen werden in `docs/adr/` als kurze Records dokumentiert. Format:

```
# ADR-NNNN: Titel

## Status
accepted / proposed / superseded

## Context
Warum stand die Entscheidung an?

## Decision
Was wurde entschieden?

## Consequences
Was bedeutet das positiv/negativ?
```
