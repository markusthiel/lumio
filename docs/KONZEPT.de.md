[English](KONZEPT.md) · **Deutsch**

# Lumio — Konzept & Architektur

**Projektname:** Lumio
**Typ:** Source-available, selbst-gehostete Plattform zum Teilen, Proofing und Ausliefern von Foto- und Video-Shootings
**Lizenz:** FSL-1.1-ALv2 (Functional Source License — source-available, nicht OSI-Open-Source)
**Inspiration:** Picdrop, Pixieset, Pic-Time, ShootProof
**Stand:** Juni 2026
**Status:** In Produktion. Dieses Dokument beschreibt das **tatsächlich gebaute und deployte** System (ursprünglich als Planungsdokument im Mai 2026 begonnen, seitdem fortlaufend an die Realität angeglichen).
**Repository (öffentlich):** https://github.com/markusthiel/lumio — App-Code für Studio + Kundengalerien. Intern primär über Forgejo gepflegt und nach GitHub gespiegelt; die beiden Astro-Marketing-Sites liegen in separaten, internen Repos.

---

## 1. Vision & Positionierung

Eine selbst-gehostete, schnelle, datenschutzfreundliche Alternative zu Picdrop — gebaut für Fotograf:innen und kleine Studios, die ihre Daten unter eigener Kontrolle behalten wollen (DSGVO, NDAs, Unternehmenskunden). Der Anspruch ist **nicht** "Feature-Parität mit Adobe Lightroom", sondern: das, was Picdrop wirklich gut macht, sauber als Docker-Stack abzubilden.

**Drei Leitprinzipien:**

1. **Schnell.** Uploads, Thumbnails, Galerie-Rendering müssen sich wie native Apps anfühlen. Kein Lazy-Loading-Geruckel, keine 5-Sekunden-Wartezeit auf ein 12-MP-Thumbnail.
2. **Einfach für Endkunden.** Kein Login. Kein "Account anlegen". Link auf — anschauen, liken, kommentieren, downloaden. Mobile-first.
3. **Pro-tauglich.** RAW, große Videos, viele tausend Files pro Galerie, Lightroom/Capture-One-Workflow, Branding, sichere Freigaben.

---

## 2. Tech-Stack

Der real eingesetzte Stack (nach Abwägung von Performance, Bildverarbeitung, Entwicklungsgeschwindigkeit und Ökosystem):

| Schicht                   | Technologie                                    | Begründung                                                                                                                  |
| ------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**              | **Next.js 16 (App Router, Turbopack) + React 19 + TypeScript** | Server Components für schnelles Initial-Rendering, gute Bilder-Pipeline, riesiges Ökosystem. Marketing-Sites separat in Astro. |
| **UI**                    | Tailwind CSS + shadcn/ui + Radix              | Hochwertige, anpassbare Komponenten ohne Bloat. Whitelabel-freundlich.                                                      |
| **Bild-Viewer**           | PhotoSwipe v5 oder OpenSeadragon              | Industrie-Standard für Lightbox/Deep-Zoom. Touch-Gesten, Keyboard, Fullscreen, Pinch-Zoom.                                  |
| **Video-Player**          | Video.js oder Vidstack                        | HLS-Streaming, adaptive Bitrate, Captions, Vorschaubilder beim Scrubbing.                                                   |
| **API-Backend**           | **Node.js + Fastify + TypeScript + Prisma (PostgreSQL)** | Sehr schnell, gleiche Sprache wie Frontend → geteilte Types (`packages/shared`), Zod-Schemas. Prisma als ORM mit versionierten Migrationen. |
| **Worker (Verarbeitung)** | **Python + Celery** (separater Container)     | Für RAW/Video-Processing schlägt das Python-Ökosystem (rawpy, Pillow, OpenCV, PyAV) Node deutlich. Klare Trennung API ↔ CPU. |
| **Queue / Cache**         | Redis (ioredis im API für Rate-Limiting/Sessions, Celery-Broker für Worker-Jobs) | Job-Queue für Thumbnail-/Transcode-/Tagging-Jobs, Rate-Limiting, Sessions. Redis ist passwortgeschützt. |
| **Datenbank**             | **PostgreSQL 16**                              | JSONB für flexible Metadaten (EXIF), Volltextsuche, ausgereift, transaktionssicher.                                         |
| **Object Storage**        | **S3-kompatibel**, frei wählbar via `STORAGE_PROVIDER` (MinIO mitgeliefert; Prod auf lumio-cloud.de: **Hetzner Object Storage**) | Skaliert horizontal, einfache Backups, Presigned URLs für direkten Browser-Upload (entlastet Backend). |
| **Reverse Proxy**         | Caddy oder Traefik                            | Automatisches Let's-Encrypt, HTTP/3, einfache Compose-Integration.                                                          |
| **Auth (Studio-Seite)**   | Eigene Session-Auth (argon2id-Hashing, Redis-gestützte Sessions) | HTTP-only-Cookies, TOTP-2FA, Passkeys/WebAuthn, API-Tokens für Plugins.                                            |
| **Auth (Galerie-Seite)**  | Signed URL-Tokens (JWT) + optional Passwort   | Picdrop-Style: kein Account für Kunden.                                                                                      |

### Storage-Provider-Wahl

Da Foto-Sharing **schreib-leicht, lese-schwer** ist (einmal hochgeladen, viele Downloads), lohnt sich der Blick auf die Egress-Preise. Lumio unterstützt alle S3-kompatiblen Anbieter über einen einzigen `STORAGE_PROVIDER`-Schalter:

| Anbieter           | Storage-Preis  | Egress         | Wann sinnvoll                                                |
| ------------------ | -------------- | -------------- | ------------------------------------------------------------ |
| **MinIO** (lokal)  | Hardware-Kosten | nur Bandbreite | Self-Hosting auf eigenem Server, maximale Datenhoheit       |
| **Cloudflare R2**  | sehr günstig    | **0 €**         | Empfehlung für Hosted Mode — Downloads kosten nichts        |
| **Backblaze B2**   | sehr günstig    | günstig         | Gute Alternative, breite Region-Auswahl                      |
| **AWS S3**         | mittel          | teuer           | Wenn AWS-Ökosystem ohnehin vorhanden ist                     |
| **Wasabi**         | günstig         | inkl.           | "All-inclusive"-Modell, keine versteckten Egress-Gebühren    |
| **Hetzner Object Storage** | günstig | inkl. (in DE)   | DSGVO-freundlich, europäischer Anbieter                      |

Konkrete Preise schwanken — bitte beim Anbieter prüfen. Für reine Self-Hosting-Setups ist **MinIO im selben Compose** der einfachste Weg (Default). Die produktive SaaS-Instanz **lumio-cloud.de** läuft bewusst auf **Hetzner Object Storage** (EU/DSGVO, Egress inklusive). Für traffic-starke Setups ohne DSGVO-Bindung bleibt **Cloudflare R2** (0 € Egress) wirtschaftlich attraktiv.

Wechsel zwischen Providern ist möglich (`rclone sync s3-old:bucket s3-new:bucket` plus `S3_ENDPOINT` umstellen) — alle Renditions sind über deterministische Keys auffindbar.

### Warum nicht alles in einer Sprache?

Ich hatte überlegt, das Backend rein in Python (FastAPI) zu bauen — RAW/Video würde nativ passen. Allerdings:

- Fastify ist im I/O-lastigen API-Layer (Upload-Coordination, WebSockets für Live-Collab, Presigned URLs) klar schneller und arbeitet besser mit S3-Streams.
- Die Worker-Trennung ist sowieso nötig (man will keine 30-Sekunden-RAW-Konvertierung im API-Prozess), also kann der Worker problemlos Python sein.
- Geteilte TypeScript-Types zwischen Frontend und API sparen massiv Bugs.

Der einzige Sprach-Übergang ist API ↔ Worker via Redis-Queue mit JSON-Payloads — sauber und stabil.

### Alternativen (wenn du es anders machen willst)

- **Pures TypeScript:** Backend + Worker beide in Node. Sharp für JPEG/PNG/TIFF/WebP ist exzellent, `libraw` ist via FFI ansprechbar, aber das RAW-Handling wird hakelig. ffmpeg-Aufrufe sind sprachunabhängig.
- **Pures Python:** FastAPI + Celery + Jinja-SSR oder HTMX. Schlanker Stack, super für Solo-Devs, aber Frontend wird mühsamer für die anspruchsvollen Galerie-Interaktionen.
- **Go:** Maximal performant, aber Bild-/Video-Ökosystem ist dünner; viel müsste über CGO/Subprozesse laufen.

---

## 3. Komponenten-Architektur

```
                                  ┌──────────────────┐
                                  │   Reverse Proxy  │
                                  │  (Caddy/Traefik) │
                                  │   TLS, HTTP/3    │
                                  └────────┬─────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
        ┌─────▼─────┐              ┌───────▼────────┐           ┌──────▼──────┐
        │ Frontend  │              │   API Server   │           │  MinIO/S3   │
        │ Next.js   │◄────────────►│ Fastify (Node) │           │  Object     │
        │           │   REST/WS    │                │           │  Storage    │
        └───────────┘              └───┬────────┬───┘           └──────▲──────┘
                                       │        │                      │
                                       │        │  Presigned PUT/GET   │
                                       │        └──────────────────────┘
                                       │
                          ┌────────────┼────────────┐
                          │            │            │
                    ┌─────▼─────┐ ┌────▼────┐ ┌────▼──────────┐
                    │ Postgres  │ │  Redis  │ │ Worker Pool   │
                    │ (Metadata)│ │ (Queue) │ │ Python+Celery │
                    └───────────┘ └─────────┘ │ - Thumbnails  │
                                              │ - RAW decode  │
                                              │ - Video trans │
                                              │ - ZIP build   │
                                              └───────────────┘
```

### Komponenten im Detail

**1. Reverse Proxy** — TLS, HTTP-Routing, Caching von statischen Assets, optional Brotli/Zstd.

**2. Frontend (Next.js)** — zwei Bereiche:

- **Studio** (`/studio/*`): Dashboard für die fotografierende Person. Galerien erstellen, Upload, Statistiken, Einstellungen, Branding.
- **Galerie** (`/g/[slug]`): Was Kunden sehen. Schnell, fokussiert, mobile-optimiert. Server-Components für SEO-/Preview-irrelevante Teile sind hier OK, aber der eigentliche Viewer ist Client-Component für Interaktivität.

**3. API-Server (Fastify)** — REST-Endpoints + WebSocket-Server für Live-Collaboration. Verwaltet Sessions, validiert Tokens, signiert S3-URLs, koordiniert Worker-Jobs. Selber **niemals** Bilder durchschleifen — immer Presigned URLs.

**4. Worker (Python/Celery)** — die CPU-intensive Schicht. Pull-Modell: Jobs aus Redis-Queue, hochskalierbar (mehrere Replikas möglich, GPU-Worker möglich für ffmpeg+NVENC).

**5. PostgreSQL** — Metadaten (User, Galerien, Files, Kommentare, Ratings, Audit-Log).

**6. Redis** — Job-Queue, Rate-Limiting, optional Session-Store, Pub/Sub für WebSocket-Fanout.

**7. Object Storage (S3-kompatibel)** — Originale + abgeleitete Renditions (Thumbnail, Preview, Web, Watermarked). Kein direktes Filesystem — verhindert Skalierungsprobleme. MinIO ist für Self-Hosting mitgeliefert; die SaaS-Instanz nutzt Hetzner Object Storage.

---

## 4. Daten-Modell (PostgreSQL)

Wesentliche Tabellen (vereinfacht, ohne `created_at`/`updated_at`/`id`-Boilerplate):

```sql
tenants                -- Multi-Tenancy: ein oder viele Studios pro Instanz
  slug, name, status, custom_domain, branding_id

users                  -- Studio-Owner und Team-Members
  tenant_id, email, password_hash, role, totp_secret, totp_enabled, status

teams                  -- Optional: Multi-User-Studios (innerhalb eines Tenants)
  name, owner_id

galleries              -- Eine Galerie pro Shooting/Lieferung
  tenant_id, slug, title, owner_id, branding_id, cover_file_id
  mode               -- 'collaboration' | 'presentation'
  status             -- 'draft' | 'live' | 'archived'
  password_hash      -- optional
  expires_at         -- optional
  download_enabled, watermark_enabled, comments_enabled
  selection_limit    -- max Anzahl Auswahl für Kunde
  settings_jsonb     -- flexibel: Sortierung, Layout, Hintergrundfarbe

gallery_access        -- Wer per Link Zugriff hat
  gallery_id, token, label (z.B. "Brautpaar", "Agentur")
  permissions_jsonb  -- {can_download, can_comment, can_select, can_invite}

files                  -- Jeder Upload
  gallery_id, original_filename, storage_key
  mime_type, size_bytes, sha256
  width, height, duration_ms
  exif_jsonb, taken_at
  status             -- 'uploading' | 'processing' | 'ready' | 'failed'
  sort_index

renditions             -- Abgeleitete Varianten pro File
  file_id, kind        -- 'thumb' | 'preview' | 'web' | 'watermarked' | 'hls'
  storage_key, width, height, size_bytes

selections             -- Kunden-Auswahl
  file_id, access_token_id, color, rating, status
  -- color: 'red' | 'yellow' | 'green' (Picdrop-Style)
  -- rating: 1-5 Sterne
  -- status: 'like' | 'pick' | 'reject'

comments               -- Kommentare/Annotationen
  file_id, access_token_id, author_label
  body_text, annotation_jsonb  -- für Scribbles: Pfade als SVG-Coords
  parent_id           -- für Threads

team_votes             -- Mehrere Mitglieder eines Kunden-Teams stimmen ab
  file_id, voter_label, value

download_log           -- Audit
  gallery_id, file_id, ip, user_agent, kind

events                 -- Generischer Audit-Log (Login, Share-Link, Delete)
  tenant_id, actor_type, actor_id, action, target_type, target_id, payload_jsonb

brandings              -- Whitelabel pro Studio (oder pro Galerie)
  tenant_id, logo_url, primary_color, font, favicon_url
  custom_domain, intro_text, footer_text, css_overrides

billing_plans          -- Plan-Definitionen (nur Hosted Mode aktiv)
  slug, name, storage_gib, galleries_max, files_per_gallery, users_max
  bandwidth_gib_per_month, custom_domain, white_label, watermarking, analytics
  stripe_price_id_monthly, stripe_price_id_yearly, price_monthly_cents, currency

billing_subscriptions  -- Eine Subscription pro Tenant
  tenant_id (unique), plan_id, status, billing_interval
  stripe_customer_id, stripe_subscription_id
  current_period_start, current_period_end, trial_ends_at
  storage_bytes_used, bandwidth_bytes_used, galleries_count

billing_usage_records  -- Nutzungsbasierte Zusatzpositionen (Phase 2)
  tenant_id, kind, quantity, unit_price_cents, period_start, period_end
```

**Multi-Tenancy-Hinweis:** Alle Tabellen außer `tenants` und `billing_plans` haben `tenant_id` als FK. Die API erzwingt diesen Filter zentral.

**Indizes auf:** `galleries(slug)`, `files(gallery_id, sort_index)`, `selections(file_id, access_token_id)`, `gallery_access(token)`.

---

## 5. Kern-Workflows

### 5.1 Upload (Studio → Server)

Picdrop's "crazy fast uploads" sind kein Magie-Trick, sondern direkter Browser→S3-Upload mit parallelen Chunks. Genau das machen wir:

1. Browser fragt API: "Ich will N Files hochladen" + Metadaten (Name, Größe, MIME).
2. API legt `files`-Einträge mit Status `uploading` an, erzeugt **Presigned PUT-URLs** (mit Multipart für >100 MB).
3. Browser läuft `Promise.allSettled` mit z.B. 6 parallelen Uploads direkt zu S3/MinIO (Backend wird **nicht** zum Bottleneck).
4. Pro abgeschlossenem Upload: Browser meldet API → API setzt Status auf `processing` und feuert Job in Redis.
5. Worker zieht Job, generiert Renditions, schreibt Status `ready` in DB.
6. Frontend bekommt Status-Update per WebSocket → Thumbnail erscheint live in der Studio-Ansicht.

**Vorteil:** Backend kann auf 0.5 vCPU laufen, der Throughput skaliert mit dem Object Storage.

### 5.2 RAW-Verarbeitung

Für jedes RAW-File (CR2, CR3, NEF, ARW, RAF, DNG, ORF, PEF, RW2…) im Worker:

```python
import rawpy
from PIL import Image

with rawpy.imread(path) as raw:
    # 1. Schnelles eingebettetes Preview-JPEG nutzen (im RAW enthalten,
    #    in Kamera erzeugt — sieht aus wie auf dem Kamera-Display)
    try:
        thumb = raw.extract_thumb()
        if thumb.format == rawpy.ThumbFormat.JPEG:
            preview_bytes = thumb.data
        else:
            preview_bytes = encode_jpeg(thumb.data)
    except rawpy.LibRawNoThumbnailError:
        # 2. Fallback: aus RAW demosaicen (langsam, aber zuverlässig)
        rgb = raw.postprocess(use_camera_wb=True, no_auto_bright=False)
        preview_bytes = encode_jpeg(rgb, quality=92)

# Aus dem Preview dann mit Pillow/libvips die Web-Renditions ableiten
```

Die LibRaw-Doku bestätigt: das eingebettete Preview ist der schnelle Weg zum Thumbnail, der nahezu jedes RAW-Format abdeckt. Für Galerien reicht das in 99 % der Fälle aus — die Kunden wollen sehen, was sie auswählen, nicht die maximal mögliche RAW-Qualität.

**Wichtig:** Das **Original-RAW bleibt unangetastet** im Storage. Renditions sind nur abgeleitete JPEGs/WebPs.

### 5.3 Renditions-Pipeline

Pro Foto generieren wir mehrere Varianten — **mit libvips** (über `pyvips`), das ist 4–8× schneller als ImageMagick und braucht weniger RAM:

| Rendition          | Zweck                              | Maße          | Format              |
| ------------------ | ---------------------------------- | ------------- | ------------------- |
| `thumb`            | Grid-Ansicht in der Galerie       | 400 px lange Kante | WebP, Qualität 75 |
| `preview`          | Lightbox / Mobile                  | 1600 px       | WebP/AVIF, Qual. 82 |
| `web`              | Lightbox auf großen Displays      | 2560 px       | WebP/AVIF, Qual. 85 |
| `watermarked`      | Wenn Download deaktiviert         | wie `web`     | JPEG + Watermark    |
| `download` (opt.)  | "Web-resolution" Download-Variante | 2048 px       | JPEG, Qual. 92      |
| Original           | Voll-Download (RAW oder full JPEG) | unverändert   | Originalformat      |

### 5.4 Video-Verarbeitung

Für Video (MP4, MOV, AVI, MKV, HEVC, ProRes) im Worker via **ffmpeg**:

1. **Poster** — Frame bei 10 % der Laufzeit als JPEG.
2. **Web-Stream (HLS)** — adaptive Bitrates: 480p, 720p, 1080p (4K optional). Code: `ffmpeg -i input.mov -filter:v ... -hls_time 6 -hls_playlist_type vod ...`. Liefert butterweiches Streaming statt 2-GB-Browser-Download.
3. **Scrubbing-Thumbnails** — Sprite-Sheet (alle 10 Sek ein Bild, als ein großes JPEG) für die Player-Vorschau beim Scrubbing.
4. **Original** — bleibt im Storage für Download.

Optional **GPU-Beschleunigung** (NVENC/QSV) wenn der Host eine GPU hat — drastisch schneller bei 4K-Material.

### 5.5 Galerie-Ansicht (Kunden-Erlebnis)

Was der Kunde via Link `https://photos.studio.de/g/abc123` sieht:

1. **Cover** — großes Hero-Bild + Galerie-Titel + Studio-Branding.
2. **Optional:** Passworteingabe / Email-Capture (für Lead-Gen, abschaltbar).
3. **Grid** — virtualisiertes Masonry-Layout (z.B. `react-photo-album` mit `react-window`). Bei 5.000 Bildern lädt **nur** das sichtbare. Thumbnails werden via `<img loading="lazy">` + `srcset` ausgeliefert.
4. **Lightbox** — PhotoSwipe v5, Tastatur, Touch, Pinch-Zoom, Fullscreen, Slideshow.
5. **Pro Bild:** Like, Color-Tag (rot/gelb/grün), Kommentar, Scribble-Tool (auf Touch-Geräten mit Stift), Stern-Rating.
6. **Filter** — "Nur ausgewählte zeigen", "Nur kommentierte", "Nach Farbe".
7. **Download** — Einzeldownload oder ZIP (siehe unten).

### 5.6 ZIP-Downloads (großer Schmerzpunkt richtig gemacht)

Naiv wäre: "alles in ein ZIP packen und ausliefern" — bei 10 GB stirbt der Server. Richtig:

- **Streaming-ZIP**: Worker baut den ZIP-Stream on-the-fly und gibt ihn direkt zur HTTP-Response durch (`archiver` in Node oder `zipstream-ng` in Python). Kein Tempfile, kein RAM-Blow-up.
- Für **wiederholbare** Downloads (z.B. nach Auswahl): ZIP einmal in S3 cachen und Link 7 Tage zurückgeben.
- **Resume-fähig** via HTTP-Range, soweit der Stream das zulässt — alternativ in Chunks (mehrere ZIPs à 5 GB).

### 5.7 Lightroom / Capture One Workflow

Picdrops Killer-Feature: Kundenauswahl zurück in Lightroom. Wir bieten:

1. **Export-Datei** — Download einer `.txt`/`.csv` mit den ausgewählten Dateinamen.
2. **XMP-Sidecars** — pro ausgewähltem Foto eine `.xmp`-Datei mit `xmp:Rating` oder `xmp:Label`, die Lightroom/Capture One direkt erkennen, wenn man sie neben die Original-RAWs legt.
3. **Lightroom-Plugin** (Phase 2) — Lua-Plugin, das via API-Token die Auswahl pullt und die entsprechenden Bilder in Lightroom markiert.

---

## 6. Feature-Matrix

Lumio ist über das ursprüngliche MVP hinaus. Der folgende Stand spiegelt das **real ausgelieferte** System wider.

### Gebaut & in Produktion

| Bereich | Features |
| ------- | -------- |
| **Galerien** | Erstellen, Upload (Browser→S3, parallele Chunks), Draft/Live/Archiviert, Passwortschutz, Ablaufdatum, Cover, Galerie-Tags, Kapitel (Chapters), Galerie-Templates/Presets |
| **Medien** | RAW (CR2/CR3/NEF/ARW/RAF/DNG/ORF/PEF/RW2/X3F), JPEG/PNG/WebP/AVIF/TIFF/HEIC, Video (MP4/MOV/AVI/MKV/HEVC/ProRes), HLS-Transcoding, Slideshow |
| **Kunden-Erlebnis** | Login-freie Galerie, Lightbox (Tastatur/Touch/Pinch), Like / Color-Tag / Stern-Rating, Kommentare, Scribble-Annotationen direkt aufs Bild, Auswahl-Limit, ZIP-Streaming-Download, mobile-first |
| **Branding** | Pro-Studio- und Pro-Galerie-Branding (Logo, Farben, Schrift, Footer), Custom Domains, Hero/Welcome-Texte, Animations-Stufen |
| **Studio** | Team-Mitglieder + Rollen (Owner/Member), granularer Galerie-Team-Zugriff, Bulk-Aktionen, manuelles + KI-gestütztes Tagging, Duplikat-Erkennung, Audit-Log, Statistiken/Analytics, API-Tokens |
| **Sicherheit** | TOTP-2FA, Passkeys/WebAuthn, argon2id, Signed URLs, Rate-Limiting, DSGVO-Datenexport (pro Galerie als ZIP), automatische Lösch-/Archiv-Fristen |
| **Print-Shop** | Print-Verkauf aus der Galerie (Produkte/Varianten/Versand/Anbieter), Crop, Warenkorb, Checkout mit Stripe, Bestellbestätigung & Sendungsverfolgung |
| **Plugins** | Lightroom-Classic-Plugin (Publish-Service), Capture-One-Plugin, Webhooks |
| **Mehrsprachigkeit** | Studio-Oberfläche Deutsch + Englisch (vollständig i18n, umschaltbar) |
| **Multi-Tenancy & Billing** | Single-/Multi-Mode, Self-Service-Signup, Stripe-Abos + Trial + Read-only-Stufen, Plan-Limits, Banner |
| **Betrieb** | Docker-Compose-Stack, horizontale Worker-Skalierung über mehrere Nodes (Hetzner Private Network), Wildcard-TLS via acme-dns, Umami-Analytics (cookielos, optional) |

### KI-Tagging (bewusst Opt-in)

Picdrop ist absichtlich KI-frei. Lumio bietet automatisches Tagging als **abschaltbares Opt-in** über ein separates ML-Worker-Image (`docker-compose.ml.yml`, CPU; GPU optional). Vorschläge werden dem Studio zur Bestätigung angezeigt, nichts wird ungefragt übernommen.

### Geplant / offen

| Feature |
| ------- |
| Weitere Sprachen (FR, ES, IT) |
| Nutzungsbasierte Zusatzabrechnung (Storage-Add-ons via Stripe Metered) |
| Globale Suche über alle Galerien („DAM-Light") |
| Öffentliche API + OAuth |
| Mobile App (Upload vom iPhone) |
| Live-Collaboration mit Echtzeit-Cursorn anderer Viewer |

## 7. Multi-Tenancy — eine Instanz für ein oder viele Studios

Lumio kann beides: **eine einzelne Studio-Installation** (klassisches Self-Hosting) **oder eine Multi-Tenant-Instanz** für SaaS-Anbieter, Agenturen mit mehreren Marken oder Hosted-Provider. Der Modus wird über eine einzige Umgebungsvariable gewählt:

```
DEPLOYMENT_MODE=single   # genau ein Tenant, automatisch beim Start angelegt
DEPLOYMENT_MODE=multi    # beliebig viele Tenants, jeder mit eigener Domain
```

### 7.1 Wie Trennung technisch funktioniert

Wir nutzen **logische Multi-Tenancy mit `tenant_id` auf jeder geschützten Tabelle** (Shared Database, Shared Schema). Das ist der pragmatischste Weg:

- **Eine** PostgreSQL-Datenbank, **ein** Schema, **ein** S3-Bucket.
- Jede Tabelle (außer `tenants` selbst und `billing_plans`) hat eine `tenant_id`-Spalte.
- Die API erzwingt **bei jedem** Query einen Filter auf `tenant_id` (Middleware-Layer, kein "vergessbarer" WHERE).
- Storage-Keys in S3 sind nach Tenant gepräfixt: `t/<tenant_uuid>/files/<file_id>/...`. Damit lässt sich notfalls ein Tenant per `aws s3 rm --recursive` komplett entsorgen.

**Vorteil gegenüber "Schema per Tenant" oder "DB per Tenant":** einfache Migrationen, ein Connection-Pool, einfaches Operating. **Nachteil:** keine harte Isolation auf DB-Ebene — deswegen die strenge API-Middleware. Für Kunden mit extremen Compliance-Anforderungen ist eine dedizierte Instanz pro Tenant immer noch die richtige Antwort.

### 7.2 Tenant-Auflösung pro Request

Welcher Tenant gerade aktiv ist, ergibt sich aus dem Request (in dieser Reihenfolge):

1. **Custom Domain** — `studio-mueller.de` → Lookup in `tenants.custom_domain`.
2. **Subdomain** — `studio-mueller.lumio.example.com` → Lookup in `tenants.slug`.
3. **Galerie-Link** — `/g/<slug>` → die Galerie kennt ihren Tenant.
4. **Studio-Login** — die Session-ID ist an `tenant_id` gekoppelt.
5. **Single-Mode-Fallback** — der einzige existierende Tenant wird automatisch verwendet.

Caddy macht das transparent: ein Wildcard-Zertifikat (`LUMIO_WILDCARD_HOST=*.lumio-cloud.de`) über das **acme-dns**-Verfahren (eigener acme-dns-Container als DNS-Vermittler, kein DNS-Provider-API-Key nötig) plus per-Domain-ACME für Custom Domains. Die Wildcard ist opt-in über das Compose-Profil `wildcard`.

### 7.3 Branding-Isolation

Jeder Tenant hat sein eigenes `branding`-Profil (Logo, Farben, Schriftart, Footer-Text, optional Custom-CSS), das per Galerie zusätzlich überschreibbar ist. Im Hosted-Mode kann das Lumio-Branding pro Plan ein- oder ausgeblendet werden (Free-Plan: "Powered by Lumio" sichtbar, Pro-Plan: voll whitelabel).

### 7.4 Umschalten zwischen Modi

`single` → `multi` ist jederzeit möglich, indem du `DEPLOYMENT_MODE=multi` setzt und neu deployst. Der bestehende Single-Tenant bleibt erhalten und kann weitergenutzt werden; zusätzliche Tenants werden über die Admin-Oberfläche oder CLI angelegt.

`multi` → `single` ist nur sinnvoll, wenn genau ein Tenant existiert.

---

## 8. Hosted Mode — Lumio als Dienst anbieten

Der Hosted Mode kombiniert `DEPLOYMENT_MODE=multi` mit `BILLING_ENABLED=true`. Damit kannst du Lumio als eigenständigen SaaS-Dienst betreiben und deinen Kunden eine bezahlte Cloud-Variante anbieten — sie buchen einen Plan, du verwaltest die Infrastruktur, sie zahlen monatlich oder jährlich.

### 8.1 Plan-System

Pläne werden in der Tabelle `billing_plans` definiert. Jeder Plan setzt Limits und gibt Features frei:

| Feld                | Bedeutung                                                     |
| ------------------- | ------------------------------------------------------------- |
| `storage_gib`       | Maximaler Speicher in GiB (NULL = unbegrenzt)                |
| `galleries_max`     | Maximale Anzahl aktiver Galerien                              |
| `files_per_gallery` | Maximale Anzahl Files pro Galerie                             |
| `users_max`         | Maximale Anzahl Studio-Mitglieder                             |
| `bandwidth_gib_per_month` | Traffic-Limit, wird monatlich zurückgesetzt              |
| `custom_domain`     | Boolean — Custom Domains erlaubt?                             |
| `white_label`       | Boolean — Lumio-Branding ausblendbar?                        |
| `watermarking`      | Boolean — Wasserzeichen-Feature                              |
| `analytics`         | Boolean — detaillierte Statistiken                            |
| `price_monthly_cents`, `price_yearly_cents`, `currency` | Preis                |
| `stripe_price_id_monthly`, `stripe_price_id_yearly`     | Stripe-Anbindung      |

Die real implementierten Pläne (Quelle: `apps/api/src/services/plans.ts`):

| Plan   | Speicher | Aktive Galerien | Branding-Profile | Custom Domain | Team  | Watermark | Preis/Monat |
| ------ | -------- | --------------- | ---------------- | ------------- | ----- | --------- | ----------- |
| Start  | 150 GB   | 5               | –                | nein          | 1     | nein      | 9 €         |
| Solo   | 500 GB   | 10              | –                | nein          | 1     | nein      | 19 €        |
| Studio | 1.000 GB | 50              | 1                | 1             | 1     | ja        | 39 €        |
| Pro    | 3.000 GB | unbegrenzt      | 5                | unbegrenzt    | bis 3 | ja        | 89 €        |

Dazu ein **14-Tage-Trial** (100 GB, 10 Galerien, Vollzugriff) und ein **Storage-Add-on** (+50 GB für +9 €/Monat). Jahreszahlung ist ~17 % günstiger (2 Monate gratis).

### 8.2 Stripe-Integration

Die `apps/api`-Routen unter `/api/v1/billing/*` sprechen Stripe:

- **Checkout-Session** für Neu-Abos (Karte, SEPA, Apple Pay automatisch konfiguriert).
- **Customer Portal** für Plan-Wechsel, Kündigung, Rechnungs-Download — Stripe hostet die UI, wir verlinken nur.
- **Webhook-Empfänger** unter `/api/v1/billing/webhook` verarbeitet `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`. Damit synchronisiert sich der lokale `billing_subscriptions`-State mit Stripe.

Steuern (DE: 19 % MwSt, EU: Reverse-Charge, Drittland: keine MwSt) werden komplett über Stripe Tax abgewickelt — keine eigene Steuerlogik nötig.

### 8.3 Limit-Enforcement

Ein periodischer Worker-Job (`tasks.billing.update_tenant_usage`, läuft stündlich) aggregiert die tatsächliche Nutzung pro Tenant und schreibt sie in `billing_subscriptions.storage_bytes_used` und `bandwidth_bytes_used`.

Vor jedem **Upload-Init** prüft die API, ob `storage_bytes_used + sum(neue Files) > plan.storage_gib`. Wenn ja: HTTP 402 (Payment Required) mit Upgrade-Hinweis.

Bei **Bandwidth-Überschreitung** wird der Tenant nicht hart blockiert (das wäre kundenfeindlich, wenn gerade ein Shooting läuft), sondern die Owner werden per Mail informiert. Optional kann der Anbieter konfigurieren, dass bei dauerhafter Überschreitung ab Tag X gedrosselt wird.

Bei **fehlgeschlagener Zahlung** (`status=past_due`) bleibt der Tenant für 7 Tage voll funktionsfähig, dann werden Galerien für Endkunden auf "expired" gesetzt (Studio-Login bleibt erhalten, damit niemand Daten verliert). Nach 30 Tagen `unpaid`: harte Suspendierung, nach 90 Tagen Hinweis auf bevorstehende Löschung.

### 8.4 Usage-based Add-ons (Phase 2)

Über die Tabelle `billing_usage_records` lässt sich später **nutzungsbasierte Zusatzabrechnung** ergänzen — etwa "5 € pro zusätzlichen 100 GiB Storage". Stripe Metered Billing nimmt die Records monatlich entgegen.

### 8.5 Onboarding-Flow im Multi-Mode

Es gibt drei Onboarding-Pfade, je nach Modus:

1. **Self-Host, Single-Mode** (`DEPLOYMENT_MODE=single`, kein Stripe): Default-Tenant wird beim ersten Start automatisch angelegt; nur ein `create-admin`-Aufruf für den ersten User nötig.
2. **Self-Host, Multi-Mode** (Agentur ohne Billing): Super-Admin legt Tenants manuell an.
3. **SaaS-Mode** (`multi` + `BILLING_ENABLED=true` + Stripe): Self-Service-Signup über die Marketing-Site (lumio-cloud.de) — E-Mail + Passwort + Studio-Name + Wunsch-Subdomain, 14-Tage-Trial, danach Plan-Auswahl oder Read-only.

### 8.6 Operative Themen

- **Backups** im Hosted-Mode sind Pflicht: `pg_dump` täglich, S3-Bucket mit Object-Versioning und Cross-Region-Replikation.
- **Monitoring**: cookielose **Umami**-Analytics (mitgelieferter Stack unter `infra/umami`, opt-in via `LUMIO_UMAMI_HOST`); Errors/Infra-Metriken nach Bedarf (z.B. Sentry/Prometheus).
- **Support-Kanal**: Helpscout, Crisp oder einfach E-Mail. Tenant-ID in jeder Anfrage mitschicken.
- **SLA**: für zahlende Kunden mindestens 99,5 % Uptime versprechen; Ausfälle werden in `events` getrackt und auf Statuspage gespiegelt.

### 8.7 Wann Hosted Mode deaktiviert lassen?

Wenn du die Software **rein selbst hostest** (Single- oder Multi-Mode ohne Verkauf): `BILLING_ENABLED=false`. Dann existieren die Billing-Tabellen zwar, aber keine Limits werden durchgesetzt und keine Stripe-Webhooks sind aktiv. Alle Features sind für alle Tenants freigeschaltet.

---

## 9. Sicherheit & Datenschutz

Da Zielgruppe Profis mit NDAs sind, ist das kein "Add-on", sondern Kern.

- **Galerie-Tokens** sind kryptografisch zufällig (32 Byte) und nicht erratbar.
- **Passwortschutz** mit Argon2id.
- **Signed URLs** für jeden S3-Zugriff, mit kurzer Gültigkeit (z.B. 60 Minuten).
- **Rate-Limiting** auf Login, Galerie-Zugriff, Kommentare (z.B. via `@fastify/rate-limit`).
- **HTTPS überall** — Caddy macht das automatisch.
- **HTTPOnly + SameSite=Strict** Session-Cookies.
- **CSP** Header für Frontend.
- **EXIF-Stripping** für Web-Renditions optional (GPS-Daten raus).
- **Watermark-Mode** wenn Downloads gesperrt sind — auch das Browser-Element wird mit `pointer-events` und einem CSS-Overlay vor "Bild speichern" geschützt (kein echter DRM-Schutz, aber Hürde).
- **Audit-Log** für: Login, Galerie-Erstellung, Share-Link generiert, Datei gelöscht, Download.
- **DSGVO-Tools**: "Galerie nach X Tagen automatisch löschen", "Alle Kunden-Kommentare exportieren", "Recht auf Löschung" implementierbar.
- **Datenresidenz**: Self-Hosted — du entscheidest, wo die Daten liegen (eigener Server, Hetzner, AWS Frankfurt, Wasabi…).

---

## 10. Deployment — Docker Compose

Der Stack wird über **mehrere zusammensetzbare Compose-Dateien** betrieben. Die Basis (`docker-compose.yml`) baut die Images lokal; Overrides aktivieren produktive bzw. optionale Bausteine:

| Datei | Zweck |
| ----- | ----- |
| `docker-compose.yml` | Basis: caddy, frontend, api, worker, postgres, redis, minio (lokaler Build) |
| `docker-compose.prod.yml` | Ersetzt die `build:`-Blöcke durch fertige Images aus der **Forgejo Container Registry** (`forgejo.thiel.tools/thiel/lumio-{api,frontend,worker}:${LUMIO_TAG}`) |
| `docker-compose.ml.yml` | Zusätzlicher ML-Worker für KI-Tagging (CPU) |
| `docker-compose.gpu.yml` | GPU-Beschleunigung (NVIDIA) für Transcoding/ML |
| `docker-compose.worker.yml` | Reine Worker-Node für horizontale Skalierung (eigener Server) |

**Self-Hosting (Single-Mode), einfachster Fall:**

```bash
cp .env.example .env      # Secrets setzen (S3-Keys, DB-Passwort, JWT_SECRET …)
docker compose up -d      # acme-dns ist profilegated und bleibt aus
```

Damit läuft alles auf einem Host inklusive MinIO; `DEPLOYMENT_MODE=single` legt den Default-Tenant beim ersten Start an.

**Produktiver SaaS-Betrieb (Referenz: lumio-cloud.de):** Wildcard-TLS für Tenant-Subdomains erfordert das Profil `wildcard` (sonst startet acme-dns nicht und das Wildcard-Zertifikat bricht):

```bash
cd /opt/docker/lumio/lumio && git pull && \
  docker compose --profile wildcard \
    -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml \
    up -d --build
```

**Horizontale Skalierung:** Worker lassen sich auf zusätzliche Nodes auslagern. Haupt-Server und Worker-Nodes hängen in einem privaten Netz (Hetzner Private Network); Redis ist passwortgeschützt und bindet nur auf die interne IP. Eine Worker-Node deployt mit `docker-compose.worker.yml` + eigener `.env.worker`; Celery clustert automatisch. Wichtig: `apps/frontend` und `apps/api` betreffen nur den Haupt-Server, `apps/worker`-Änderungen alle Nodes (Nodes immer **nach** dem Haupt-Server wegen DB-Migrationen). Details: `docs/SCALING.md`.

**Reverse Proxy:** Caddy serviert App-Domains (Studio + Wildcard) und die Marketing-Sites über separate Blöcke (Konfiguration unter `infra/caddy/Caddyfile`, gesteuert über `LUMIO_WILDCARD_HOST`).

**Referenz-Hardware (Prod):** Hetzner CCX in Falkenstein (fsn1), 12 vCPU / 24 GB RAM / 480 GB, Hetzner Object Storage statt MinIO.

**Empfohlene Mindest-Hardware (Self-Host):**
- 4 vCPU, 8 GB RAM (kleines Studio, ~50 GB/Monat Traffic)
- 8 vCPU, 16 GB RAM (mehrere parallele Uploads, KI-Tagging aktiv)
- GPU optional, deutliche Beschleunigung bei 4K-Video und ML-Tagging

## 11. Performance-Optimierungen

Wo Picdrop sich "schnell" anfühlt — und wie wir das nachbauen:

| Hebel                              | Implementierung                                                             |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Direkt-zu-S3-Upload                | Presigned URLs, Backend nicht im Datenstrom                                 |
| Virtualisiertes Grid               | Nur sichtbare Thumbnails werden gerendert (`react-window`)                  |
| `srcset` / responsives Bild        | Browser holt Größe passend zum Viewport                                     |
| AVIF/WebP statt JPEG               | 30–50 % kleinere Dateien bei gleicher Qualität                              |
| HTTP/3 (QUIC)                      | Mehrere parallele Streams ohne Head-of-Line-Blocking                        |
| Aggressive HTTP-Caching            | `Cache-Control: public, immutable, max-age=31536000` für Renditions (Hash im Pfad) |
| CDN-ready                          | Static Assets + Renditions sind cacheable; Cloudflare/Bunny CDN davorhängen möglich |
| Prefetching                        | Next/Prev-Bilder in der Lightbox werden vorausgeladen                       |
| libvips statt ImageMagick          | 4–8× schneller bei Thumbnails                                               |
| Multi-Worker                       | Celery Worker horizontal skalierbar                                         |
| Connection Pooling                 | pgBouncer optional bei vielen gleichzeitigen Galerie-Aufrufen               |

---

## 12. Repo, Release & Lizenz

- **Repo-Struktur**: Monorepo (pnpm workspaces) — `apps/frontend`, `apps/api`, `apps/worker` (Python/Celery), `apps/lightroom-plugin`, `apps/capture-one-plugin`, `packages/shared` (geteilte Types).
- **Drei Repositories**: App-Code (`lumio.git`) plus zwei Astro-Marketing-Sites — `lumio-cloud-de.git` (SaaS + Sign-up + Stripe) und `lumio-app-de.git` (Self-Host-Pitch).
- **Hosting**: **Forgejo** (`forgejo.thiel.tools/thiel/*`) ist primär; **GitHub** dient als öffentlicher Push-Mirror.
- **Lizenz**: **FSL-1.1-ALv2** (Functional Source License) — source-available. Verbietet konkurrierendes SaaS-Hosting (*Competing Use*), konvertiert aber 2 Jahre nach jedem Release automatisch zu Apache 2.0. Kommerzielle Lizenz für gehostete/konkurrierende Angebote auf Anfrage.
- **Images/CI**: Container-Images liegen in der **Forgejo Container Registry**; Deployment per `git pull` + `docker compose … up -d --build`.
- **Docs**: im Repo unter `docs/` (u.a. `STORAGE.md`, `SCALING.md`, `SAAS_MODE.md`).
- **Demo/Launch**: Self-Host zuerst (r/selfhosted, awesome-selfhosted, Hacker News, Mastodon) — kommuniziert als *source-available*, nicht „Open Source". DSGVO / „Daten bleiben in Deutschland" als zentraler Differenzierer.

## 13. Was Picdrop kann, was wir bewusst weglassen (zumindest am Anfang)

- Globale Suche über alle Galerien einer Agentur ("DAM-Light") — Phase 2/3.
- Cloud-Speicher-Anbindung (Dropbox, Drive) — Self-Hosted braucht das nicht so dringend.
- Bezahl-Abo-Logik ist im Self-Host-Modus deaktiviert (`BILLING_ENABLED=false`); für die eigene Cloud-Variante über Stripe aktiv. (Der **Print-Shop** zum Bilderverkauf ist inzwischen gebaut und nicht mehr ausgeklammert.)
- Komplexes Rechtemanagement mit hundert Rollen — wir bleiben bei: Owner, Team-Member, Galerie-Gast.

---

## 14. Risiken & offene Fragen

1. **RAW-Kompatibilität neuer Kameras.** LibRaw wird aktiv gepflegt, aber brandneue Kameras (z.B. Sony α1 II direkt zum Release) brauchen manchmal Updates. Strategie: Worker-Image regelmäßig rebuilden, automatisch CR3/etc. mit `exiftool` als Fallback-Vorschau extrahieren.
2. **HEIC/HEIF-Patentlage** — libheif ist OSS, aber HEVC-Encoder/Decoder können in manchen Distributionen ausgeblendet sein. Test im Docker-Image vor Release.
3. **Adobe DNG-Special-Cases** — LibRaw behandelt DNG-Whitebalance anders als dcraw, das kann zu sichtbar anderen Previews führen — meist akzeptabel für Galerien, aber dokumentieren.
4. **Mobile Upload großer RAWs aus iPhone** — Safari hat Upload-Limits, evtl. Tus-Protokoll (resumable uploads) statt Plain-Multipart erwägen.
5. **Skalierung bei riesigen Galerien (10.000+ Bilder)** — Pagination + virtuelles Scrolling sind eingeplant, aber Last-Tests müssen folgen.
6. **Domain "Konkurrenz mit Picdrop"** — Picdrop ist ein etabliertes Tool. Differenzierung: Self-Hosted, source-available, Daten bleiben in Deutschland/EU, kein Lock-in, NDA-tauglich. Nicht "Picdrop killen", sondern eine Lücke füllen.

---

## 15. Status & nächste Schritte

Das ursprüngliche MVP (Abschnitte unten) ist vollständig ausgeliefert und produktiv, ebenso ein Großteil der einstigen Phase-2/3-Features (Multi-Tenancy, Billing, 2FA/Passkeys, Print-Shop, KI-Tagging, Plugins, DE/EN-i18n, Multi-Node-Skalierung).

**Offene Punkte:**

1. **GitHub-Mirror** sauber halten (synct von Forgejo).
2. **Stripe-Bootstrap** für neue SaaS-Tarife (`docker compose exec api npm run stripe-bootstrap`) — nur SaaS-Mode.
3. **Rechtstexte** (AVV/Art. 28 DSGVO, AGB, Datenschutz) anwaltlich prüfen lassen; Impressums-/Datenschutz-URLs in der lumio-cloud.de-ENV setzen.
4. **Umami-Analytics** scharfschalten (A-Record `stats.lumio-cloud.de`, `LUMIO_UMAMI_HOST`).
5. **Capture-One-Plugin** finalisieren.
6. **Weitere Sprachen** (FR/ES/IT) nach Bedarf.
7. **Launch** der Self-Host-Variante (Communities) + öffentliche Demo-Instanz.

## Anhang: Wichtige Bibliotheken & Tools

- **Bildverarbeitung**: libvips (über pyvips), Pillow, libheif; imageio als Bridge
- **RAW**: rawpy (LibRaw-Wrapper), exiftool (Metadaten)
- **Video**: ffmpeg (HLS/Transcoding)
- **Backend**: Fastify, Zod, **Prisma** (PostgreSQL), ioredis, Stripe, argon2 (eigene Session-/2FA-/Passkey-Auth)
- **Worker**: Python, **Celery** (Redis-Broker), boto3, separates ML-Image für KI-Tagging
- **Frontend**: **Next.js 16**, **React 19**, Tailwind CSS, TanStack Query; Marketing-Sites in **Astro**
- **DevOps**: Docker Compose, Caddy (+ acme-dns für Wildcard-TLS), Forgejo (Code + Container Registry, GitHub-Mirror), **Umami** (cookielose Analytics)
- **i18n**: eigenes leichtgewichtiges Dictionary-System (`apps/frontend/src/lib/i18n`, DE/EN)
- **Testing**: Vitest, Playwright (E2E), pytest (Worker)

---

*Ende des Konzepts.*
