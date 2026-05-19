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

## Production Deployment

Der Default-`docker-compose.yml` setzt einen funktionierenden Stack auf — aber für ein echtes Deployment hinter einer öffentlichen Domain gibt's ein paar Stellschrauben, die bei der ersten Inbetriebnahme garantiert wehtun, wenn man sie nicht von Anfang an richtig setzt. Diese Checkliste fasst alles zusammen, was ein Self-Hoster vor dem ersten `docker compose up` wissen sollte.

### Drei Topologien — welche passt zu dir?

**A) Lumio macht TLS selbst**
- Eigene IP/VM, Lumio-Caddy bindet 80+443
- Caddy holt automatisch Let's-Encrypt-Zertifikate
- Einfachste Variante, wenn der Host exklusiv für Lumio ist

**B) Hinter externem TLS-Proxy** (z.B. Caddy/Nginx/Traefik im selben Haushalt für mehrere Services)
- Externer Proxy macht HTTPS-Termination
- Lumio-Caddy lauscht intern auf HTTP, der externe Proxy reicht durch
- Was wir hier in diesem Projekt nutzen

**C) Lokales Setup / Tests**
- Alles auf `localhost`, keine echten Hostnames
- Default-`.env.example` ist darauf ausgerichtet

### DNS-Setup

Lumio braucht **zwei** Hostnames:

1. **App-Domain** (z.B. `galerien.example.com`) — Frontend + API
2. **S3-Subdomain** (z.B. `s3.galerien.example.com`) — MinIO/Object-Storage

Die S3-Subdomain ist nicht optional. Wir haben es probiert über einen Path-Präfix der Hauptdomain (`/s3/...`) laufen zu lassen, aber MinIO unterstützt das nicht — die V4-Signatur deckt den vollen Path ab, ein Reverse-Proxy-Rewrite produziert immer `SignatureDoesNotMatch`. Eine separate Subdomain ist der Standardweg, auch in MinIO's eigener Doku.

Beide A-Records zeigen auf dieselbe IP.

### `.env` für jede Topologie

**A) Lumio macht TLS selbst:**
```env
LUMIO_HOST=galerien.example.com
LUMIO_S3_HOST=s3.galerien.example.com
PUBLIC_URL=https://galerien.example.com
S3_PUBLIC_URL=https://s3.galerien.example.com
CADDY_HTTP_PORT=80
CADDY_HTTPS_PORT=443
```

Wichtig: KEIN `http://`-Präfix bei `LUMIO_HOST`/`LUMIO_S3_HOST` — sonst denkt Caddy, du willst nur HTTP, und holt kein Zertifikat.

**B) Hinter externem TLS-Proxy:**
```env
LUMIO_HOST=http://galerien.example.com
LUMIO_S3_HOST=http://s3.galerien.example.com
PUBLIC_URL=https://galerien.example.com
S3_PUBLIC_URL=https://s3.galerien.example.com
CADDY_HTTP_PORT=32080
CADDY_HTTPS_PORT=32443
FRONTEND_PORT=33030
API_PORT=33031
MINIO_API_PORT=32091
MINIO_CONSOLE_PORT=32092
```

Hier MIT `http://`-Präfix — sonst versucht Lumios Caddy selbst Let's-Encrypt für die Hostnames und scheitert.

Im externen Proxy muss dann:

```caddyfile
galerien.example.com {
    reverse_proxy <docker-host>:32080
}
s3.galerien.example.com {
    reverse_proxy <docker-host>:32080
}
```

Wichtig: **Host-Header nicht überschreiben** im externen Proxy. Default-Verhalten bei Caddy/Nginx ist korrekt, aber falls jemand `proxy_set_header Host $proxy_host` oder Caddy's `header_up Host {upstream_hostport}` hineingeschrieben hat — raus damit. MinIO verifiziert die V4-Signatur über den Host-Header der Anfrage, der muss zu dem passen, mit dem die API die URL signiert hat (`S3_PUBLIC_URL`).

**C) Lokales Setup:** die `.env.example`-Defaults passen, nichts ändern.

### Port-Konflikte vor dem Start prüfen

Bevor du `docker compose up` startest, sicherheitshalber checken ob die Ports frei sind:

```bash
ss -tlnp | grep -E ':(32080|32443|33030|33031|32091|32092)\s'
```

Keine Ausgabe = alle frei. Wichtig: `127.0.0.1:3000`-Mappings (Loopback-Bindung) **schützen nicht** vor Konflikten mit `0.0.0.0:3000`-Listenern — der Kernel reserviert den Port adressunabhängig.

### Secrets generieren

```bash
openssl rand -base64 32   # JWT_SECRET
openssl rand -base64 32   # SESSION_SECRET
openssl rand -base64 24   # POSTGRES_PASSWORD
openssl rand -base64 24   # S3_ACCESS_KEY (kürzer wirkt eher wie ein echter Access-Key)
openssl rand -base64 32   # S3_SECRET_KEY
```

Die in die `.env` einsetzen.

### Bring-up

```bash
docker compose up -d --build
docker compose ps                    # alle "Up" / "healthy"?
docker compose logs --tail=30 api    # "Lumio API ready" sichtbar?
```

Falls Container hochkommen aber dann wieder restarten: jeweils `docker compose logs --tail=50 <service>` zeigt warum.

### Admin-User anlegen

```bash
docker compose exec api npm run create-admin -- \
    --email=du@example.com --password=langes_passwort --name="Dein Studio"
```

Im Multi-Tenant-Mode zusätzlich `--tenant=<slug> --tenant-name="..."`.

### Smoke-Test

Nach dem Start systematisch durchklicken, in dieser Reihenfolge:

1. **Login** auf `https://galerien.example.com/login` → Studio
2. **Branding anlegen** → ein Logo (PNG ~200 KB) hochladen → Logo wird im Editor angezeigt
3. **Galerie anlegen** → Branding verknüpfen → Status auf `live`
4. **Test-Bild hochladen** im Studio-Galerie-Detail → Status durchläuft `uploading → processing → ready`, Thumbnail erscheint
5. **Optional: Test-Video** (~30 s, MP4 H.264) → derselbe Flow, Worker macht zusätzlich HLS-Transcoding
6. **Share-Link kopieren** → in Inkognito-Tab öffnen → Bilder sind sichtbar

Wenn einer dieser Schritte schiefgeht, `docker compose logs --tail=80 api worker` zeigt die Ursache. Die häufigsten First-Deploy-Fehler stehen unten unter "Häufige Stolperfallen".

### Backups

Mindestens diese beiden Volumes sichern:

- `postgres_data` — Metadaten (User, Galerien, File-Records, Sessions)
- `minio_data` — alle Bild-/Video-Dateien

Beispiel mit `restic` für ein Daily-Backup von beiden:

```bash
docker run --rm \
    --volumes-from lumio_postgres \
    --volumes-from lumio_minio \
    -e RESTIC_REPOSITORY=... -e RESTIC_PASSWORD=... \
    restic/restic backup /var/lib/postgresql/data /data
```

(Anpassen an deinen Backup-Stack.)

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

## Admin-User anlegen (Dev)

Im Development-Setup (Apps lokal, keine Production-Domain):

```bash
# Über Docker
docker compose exec api npm run create-admin -- --email=du@example.com --password=geheim --name="Dein Studio"

# Lokal (vom Source, ohne Build)
cd apps/api && npm run create-admin:dev -- --email=du@example.com --password=geheim
```

Im Production-Container nutze stattdessen `create-admin` (ohne `:dev`-Suffix), siehe die "Production Deployment"-Section weiter oben.

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

### Allgemein

- **`pyvips` braucht libvips42 im System.** Im Docker-Image ist es da; lokal `apt install libvips42` (Linux) oder `brew install vips` (macOS).
- **`rawpy` braucht libraw.** Im Docker-Image: `libraw-bin`. Lokal: `apt install libraw-dev` und neu installieren.
- **MinIO mit `S3_FORCE_PATH_STYLE=true`** — AWS S3 selbst will `false`.
- **CORS bei lokalem Frontend ohne Caddy:** API muss `PUBLIC_URL=http://localhost:3000` kennen und CORS entsprechend setzen. MinIO erlaubt Browser-Uploads via `MINIO_API_CORS_ALLOW_ORIGIN=*` (in `docker-compose.yml` schon gesetzt).
- **Prisma generate vergessen:** nach Schema-Änderung `npx prisma generate` ausführen, sonst sind die Types veraltet.
- **Multipart-Upload braucht ETag-Header.** S3/MinIO müssen den `ETag`-Response-Header bei `UploadPart`-Requests **exposen** (CORS `ExposeHeaders`). MinIO macht das mit `MINIO_API_CORS_ALLOW_ORIGIN=*` automatisch; bei AWS S3 muss die Bucket-CORS explizit `<ExposeHeader>ETag</ExposeHeader>` setzen.

### Deployment

Stolperfallen, die typischerweise beim ERSTEN echten Deploy zuschlagen:

- **`ambiguous site definition: :80`** in Caddy-Log → beide `LUMIO_HOST` und `LUMIO_S3_HOST` evaluieren zur gleichen Adresse. Lösung: echte Hostnames verwenden, dann macht Caddy Host-basiertes Routing am selben Port.
- **`Bind for 0.0.0.0:3000 failed: port is already allocated`** trotz `127.0.0.1:`-Bindung → ein anderer Service auf dem Host hört schon auf `0.0.0.0:3000`. Loopback und 0.0.0.0 teilen sich dieselbe Port-Reservierung im Kernel. Lösung: einen freien Port in der `.env` wählen (`FRONTEND_PORT=33030` o.ä.).
- **Browser-Upload schlägt fehl mit "DNS error: minio"** → `S3_PUBLIC_URL` ist nicht gesetzt oder zeigt auf den internen Container-Hostname. Setze es auf die öffentliche S3-Subdomain (`https://s3.galerien.example.com`).
- **Browser-Upload bekommt 403 `SignatureDoesNotMatch`** → ein Proxy zwischen Browser und MinIO ändert den Host-Header. MinIO verifiziert V4 über den Host. Lösung: `header_up Host {host}` in Lumio's Caddy, und im externen Proxy den Host-Header **unverändert** durchreichen (Default bei Caddy, bei Nginx `proxy_set_header Host $host;`).
- **Studio Branding-Logo zeigt 404 in Console** → API wurde nicht neu gebaut nach dem `serializeBranding`-Fix. `docker compose up -d --build api`.
- **API restartet endlos mit `Could not parse schema engine response`** → Prisma findet libssl im Alpine-Image nicht. Sollte mit dem Default-`Dockerfile` nicht passieren (wir installieren `openssl3` und setzen `binaryTargets`), aber falls doch: prüfe ob das aktuelle Image gebaut wurde.
- **Worker restartet endlos mit `wait: Illegal option -n`** → `entrypoint.sh` läuft im falschen Shell. Shebang ist `#!/bin/bash`, das sollte mit dem Default-Image passen.
- **`create-admin` meldet `tsx: not found`** → das Production-Image bringt nur `node` + kompiliertes JS mit. `npm run create-admin` ruft jetzt `node dist/scripts/create-admin.js` auf; im Dev-Mode `npm run create-admin:dev`.
- **Galerie zeigt im Studio Files mit Thumbnails, aber Customer-Seite ist leer** → die Files stehen wahrscheinlich auf `status='failed'`. Customer-Seite blendet `failed` aus, Studio zeigt alles. Im API/Worker-Log nachschauen, was schiefging. Files löschen und neu hochladen — `failed` retryt nicht automatisch.

## Upload-Pipeline (Datenfluss)

So fließt eine Datei beim Upload durch das System:

```
Browser (uploadFiles)
   │
   │ 1) POST /api/v1/uploads/init  (Filenames + Größen)
   ▼
API
   │ 1a) Gallery-Ownership prüfen, Größenlimit checken
   │ 1b) Pro File: file-Record (status=uploading) + Storage-Key generieren
   │ 1c) Presigned PUT-URLs (single oder multipart parts) zurückgeben
   ▼
Browser
   │ 2) PUT direkt zu S3/MinIO mit Progress
   │ 3) POST /api/v1/uploads/complete  (mit ETag-Liste bei multipart)
   ▼
API
   │ 3a) Multipart-Complete bei S3 (falls multipart)
   │ 3b) files.status = "processing"
   │ 3c) Job in Redis-Stream "lumio:jobs:file_processing" pushen
   ▼
Worker (Stream-Consumer)
   │ 4) xreadgroup → empfängt Job
   │ 5) Celery send_task → process_file.generate_renditions
   ▼
Celery Worker
   │ 6) S3 → /tmp/source laden
   │ 7) pyvips: autorotate → resize → WebP (thumb/preview/web)
   │ 8) Renditions nach S3 hochladen, DB-Records anlegen
   │ 9) files.status = "ready"
   ▼
Frontend pollt /api/v1/galleries/:id alle 2s
   → sobald ready, Thumb-URL im Grid sichtbar
```

In Phase 2 ersetzen wir das Polling durch WebSocket-Push.

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
