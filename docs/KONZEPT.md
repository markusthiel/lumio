**English** · [Deutsch](KONZEPT.de.md)

# Lumio — Concept & Architecture

**Project name:** Lumio
**Type:** Source-available, self-hosted platform for sharing, proofing and delivering photo and video shoots
**License:** FSL-1.1-ALv2 (Functional Source License — source-available, not OSI open source)
**Inspiration:** Picdrop, Pixieset, Pic-Time, ShootProof
**As of:** June 2026
**Status:** In production. This document describes the **actually built and deployed** system (originally started as a planning document in May 2026, since then continuously aligned with reality).
**Repository (public):** https://github.com/markusthiel/lumio — app code for studio + customer galleries. Internally maintained primarily via Forgejo and mirrored to GitHub; the two Astro marketing sites live in separate, internal repos.

---

## 1. Vision & positioning

A self-hosted, fast, privacy-friendly alternative to Picdrop — built for photographers and small studios that want to keep their data under their own control (GDPR, NDAs, corporate clients). The goal is **not** "feature parity with Adobe Lightroom", but: to map what Picdrop does really well cleanly as a Docker stack.

**Three guiding principles:**

1. **Fast.** Uploads, thumbnails, gallery rendering have to feel like native apps. No lazy-loading stutter, no 5-second wait for a 12-MP thumbnail.
2. **Simple for end customers.** No login. No "create an account". Open the link — view, like, comment, download. Mobile-first.
3. **Pro-capable.** RAW, large videos, many thousands of files per gallery, a Lightroom/Capture One workflow, branding, secure shares.

---

## 2. Tech stack

The stack actually in use (after weighing performance, image processing, development speed and ecosystem):

| Layer                   | Technology                                    | Rationale                                                                                                                  |
| ------------------------- | ---------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| **Frontend**              | **Next.js 16 (App Router, Turbopack) + React 19 + TypeScript** | Server Components for fast initial rendering, a good image pipeline, a huge ecosystem. Marketing sites separately in Astro. |
| **UI**                    | Tailwind CSS + shadcn/ui + Radix              | High-quality, customizable components without bloat. Whitelabel-friendly.                                                  |
| **Image viewer**           | PhotoSwipe v5 or OpenSeadragon              | The industry standard for lightbox/deep zoom. Touch gestures, keyboard, fullscreen, pinch zoom.                                  |
| **Video player**          | Video.js or Vidstack                        | HLS streaming, adaptive bitrate, captions, preview images on scrubbing.                                                   |
| **API backend**           | **Node.js + Fastify + TypeScript + Prisma (PostgreSQL)** | Very fast, the same language as the frontend → shared types (`packages/shared`), Zod schemas. Prisma as the ORM with versioned migrations. |
| **Worker (processing)** | **Python + Celery** (separate container)     | For RAW/video processing the Python ecosystem (rawpy, Pillow, OpenCV, PyAV) clearly beats Node. A clean separation API ↔ CPU. |
| **Queue / cache**         | Redis (ioredis in the API for rate limiting/sessions, the Celery broker for worker jobs) | Job queue for thumbnail/transcode/tagging jobs, rate limiting, sessions. Redis is password-protected. |
| **Database**             | **PostgreSQL 16**                              | JSONB for flexible metadata (EXIF), full-text search, mature, transaction-safe.                                         |
| **Object storage**        | **S3-compatible**, freely selectable via `STORAGE_PROVIDER` (MinIO shipped along; prod on lumio-cloud.de: **Hetzner Object Storage**) | Scales horizontally, easy backups, presigned URLs for direct browser upload (offloads the backend). |
| **Reverse proxy**         | Caddy or Traefik                            | Automatic Let's Encrypt, HTTP/3, easy Compose integration.                                                          |
| **Auth (studio side)**   | Own session auth (argon2id hashing, Redis-backed sessions) | HTTP-only cookies, TOTP 2FA, passkeys/WebAuthn, API tokens for plugins.                                            |
| **Auth (gallery side)**  | Signed URL tokens (JWT) + optional password   | Picdrop-style: no account for customers.                                                                                      |

### Storage provider choice

Since photo sharing is **write-light, read-heavy** (uploaded once, downloaded many times), it's worth looking at egress prices. Lumio supports all S3-compatible providers via a single `STORAGE_PROVIDER` switch:

| Provider           | Storage price  | Egress         | When it makes sense                                                |
| ------------------ | -------------- | -------------- | ------------------------------------------------------------ |
| **MinIO** (local)  | hardware cost | bandwidth only | Self-hosting on your own server, maximum data sovereignty       |
| **Cloudflare R2**  | very cheap    | **€0**         | Recommendation for hosted mode — downloads cost nothing        |
| **Backblaze B2**   | very cheap    | cheap         | A good alternative, broad region choice                      |
| **AWS S3**         | medium          | expensive           | If the AWS ecosystem is present anyway                     |
| **Wasabi**         | cheap         | incl.           | "All-inclusive" model, no hidden egress fees    |
| **Hetzner Object Storage** | cheap | incl. (in DE)   | GDPR-friendly, European provider                      |

Concrete prices fluctuate — please check with the provider. For pure self-hosting setups, **MinIO in the same Compose** is the easiest way (default). The production SaaS instance **lumio-cloud.de** deliberately runs on **Hetzner Object Storage** (EU/GDPR, egress included). For traffic-heavy setups without a GDPR binding, **Cloudflare R2** (€0 egress) remains economically attractive.

Switching between providers is possible (`rclone sync s3-old:bucket s3-new:bucket` plus changing `S3_ENDPOINT`) — all renditions are findable via deterministic keys.

### Why not everything in one language?

I had considered building the backend purely in Python (FastAPI) — RAW/video would fit natively. However:

- Fastify is clearly faster in the I/O-heavy API layer (upload coordination, WebSockets for live collab, presigned URLs) and works better with S3 streams.
- The worker separation is needed anyway (you don't want a 30-second RAW conversion in the API process), so the worker can comfortably be Python.
- Shared TypeScript types between the frontend and the API save a massive number of bugs.

The only language boundary is API ↔ worker via the Redis queue with JSON payloads — clean and stable.

### Alternatives (if you want to do it differently)

- **Pure TypeScript:** backend + worker both in Node. Sharp for JPEG/PNG/TIFF/WebP is excellent, `libraw` is addressable via FFI, but the RAW handling gets finicky. ffmpeg calls are language-independent.
- **Pure Python:** FastAPI + Celery + Jinja SSR or HTMX. A lean stack, great for solo devs, but the frontend gets harder for the demanding gallery interactions.
- **Go:** maximally performant, but the image/video ecosystem is thinner; a lot would have to run via CGO/subprocesses.

---

## 3. Component architecture

```
                                  ┌──────────────────┐
                                  │   Reverse proxy  │
                                  │  (Caddy/Traefik) │
                                  │   TLS, HTTP/3    │
                                  └────────┬─────────┘
                                           │
              ┌────────────────────────────┼────────────────────────────┐
              │                            │                            │
        ┌─────▼─────┐              ┌───────▼────────┐           ┌──────▼──────┐
        │ Frontend  │              │   API server   │           │  MinIO/S3   │
        │ Next.js   │◄────────────►│ Fastify (Node) │           │  Object     │
        │           │   REST/WS    │                │           │  storage    │
        └───────────┘              └───┬────────┬───┘           └──────▲──────┘
                                       │        │                      │
                                       │        │  Presigned PUT/GET   │
                                       │        └──────────────────────┘
                                       │
                          ┌────────────┼────────────┐
                          │            │            │
                    ┌─────▼─────┐ ┌────▼────┐ ┌────▼──────────┐
                    │ Postgres  │ │  Redis  │ │ Worker pool   │
                    │ (metadata)│ │ (queue) │ │ Python+Celery │
                    └───────────┘ └─────────┘ │ - thumbnails  │
                                              │ - RAW decode  │
                                              │ - video trans │
                                              │ - ZIP build   │
                                              └───────────────┘
```

### Components in detail

**1. Reverse proxy** — TLS, HTTP routing, caching of static assets, optionally Brotli/Zstd.

**2. Frontend (Next.js)** — two areas:

- **Studio** (`/studio/*`): the dashboard for the photographer. Create galleries, upload, statistics, settings, branding.
- **Gallery** (`/g/[slug]`): what customers see. Fast, focused, mobile-optimized. Server components for SEO-/preview-irrelevant parts are OK here, but the actual viewer is a client component for interactivity.

**3. API server (Fastify)** — REST endpoints + a WebSocket server for live collaboration. Manages sessions, validates tokens, signs S3 URLs, coordinates worker jobs. **Never** pipes images through itself — always presigned URLs.

**4. Worker (Python/Celery)** — the CPU-intensive layer. Pull model: jobs from the Redis queue, highly scalable (multiple replicas possible, GPU workers possible for ffmpeg+NVENC).

**5. PostgreSQL** — metadata (users, galleries, files, comments, ratings, audit log).

**6. Redis** — job queue, rate limiting, optional session store, pub/sub for WebSocket fanout.

**7. Object storage (S3-compatible)** — originals + derived renditions (thumbnail, preview, web, watermarked). No direct filesystem — prevents scaling problems. MinIO is shipped along for self-hosting; the SaaS instance uses Hetzner Object Storage.

---

## 4. Data model (PostgreSQL)

The essential tables (simplified, without `created_at`/`updated_at`/`id` boilerplate):

```sql
tenants                -- Multi-tenancy: one or many studios per instance
  slug, name, status, custom_domain, branding_id

users                  -- Studio owners and team members
  tenant_id, email, password_hash, role, totp_secret, totp_enabled, status

teams                  -- Optional: multi-user studios (within a tenant)
  name, owner_id

galleries              -- One gallery per shoot/delivery
  tenant_id, slug, title, owner_id, branding_id, cover_file_id
  mode               -- 'collaboration' | 'presentation'
  status             -- 'draft' | 'live' | 'archived'
  password_hash      -- optional
  expires_at         -- optional
  download_enabled, watermark_enabled, comments_enabled
  selection_limit    -- max number the customer may select
  settings_jsonb     -- flexible: sorting, layout, background color

gallery_access        -- Who has access via a link
  gallery_id, token, label (e.g. "couple", "agency")
  permissions_jsonb  -- {can_download, can_comment, can_select, can_invite}

files                  -- Every upload
  gallery_id, original_filename, storage_key
  mime_type, size_bytes, sha256
  width, height, duration_ms
  exif_jsonb, taken_at
  status             -- 'uploading' | 'processing' | 'ready' | 'failed'
  sort_index

renditions             -- Derived variants per file
  file_id, kind        -- 'thumb' | 'preview' | 'web' | 'watermarked' | 'hls'
  storage_key, width, height, size_bytes

selections             -- Customer selection
  file_id, access_token_id, color, rating, status
  -- color: 'red' | 'yellow' | 'green' (Picdrop-style)
  -- rating: 1-5 stars
  -- status: 'like' | 'pick' | 'reject'

comments               -- Comments/annotations
  file_id, access_token_id, author_label
  body_text, annotation_jsonb  -- for scribbles: paths as SVG coords
  parent_id           -- for threads

team_votes             -- Several members of a customer team vote
  file_id, voter_label, value

download_log           -- Audit
  gallery_id, file_id, ip, user_agent, kind

events                 -- Generic audit log (login, share link, delete)
  tenant_id, actor_type, actor_id, action, target_type, target_id, payload_jsonb

brandings              -- Whitelabel per studio (or per gallery)
  tenant_id, logo_url, primary_color, font, favicon_url
  custom_domain, intro_text, footer_text, css_overrides

billing_plans          -- Plan definitions (only active in hosted mode)
  slug, name, storage_gib, galleries_max, files_per_gallery, users_max
  bandwidth_gib_per_month, custom_domain, white_label, watermarking, analytics
  stripe_price_id_monthly, stripe_price_id_yearly, price_monthly_cents, currency

billing_subscriptions  -- One subscription per tenant
  tenant_id (unique), plan_id, status, billing_interval
  stripe_customer_id, stripe_subscription_id
  current_period_start, current_period_end, trial_ends_at
  storage_bytes_used, bandwidth_bytes_used, galleries_count

billing_usage_records  -- Usage-based additional line items (phase 2)
  tenant_id, kind, quantity, unit_price_cents, period_start, period_end
```

**Multi-tenancy note:** all tables except `tenants` and `billing_plans` have `tenant_id` as an FK. The API enforces this filter centrally.

**Indexes on:** `galleries(slug)`, `files(gallery_id, sort_index)`, `selections(file_id, access_token_id)`, `gallery_access(token)`.

---

## 5. Core workflows

### 5.1 Upload (studio → server)

Picdrop's "crazy fast uploads" are no magic trick, but a direct browser→S3 upload with parallel chunks. That's exactly what we do:

1. The browser asks the API: "I want to upload N files" + metadata (name, size, MIME).
2. The API creates `files` entries with status `uploading`, generates **presigned PUT URLs** (with multipart for >100 MB).
3. The browser runs `Promise.allSettled` with e.g. 6 parallel uploads directly to S3/MinIO (the backend does **not** become the bottleneck).
4. Per completed upload: the browser reports to the API → the API sets the status to `processing` and fires a job into Redis.
5. The worker pulls the job, generates renditions, writes status `ready` to the DB.
6. The frontend gets a status update via WebSocket → the thumbnail appears live in the studio view.

**Advantage:** the backend can run on 0.5 vCPU, the throughput scales with the object storage.

### 5.2 RAW processing

For each RAW file (CR2, CR3, NEF, ARW, RAF, DNG, ORF, PEF, RW2…) in the worker:

```python
import rawpy
from PIL import Image

with rawpy.imread(path) as raw:
    # 1. Use the fast embedded preview JPEG (contained in the RAW,
    #    created in-camera — looks like on the camera display)
    try:
        thumb = raw.extract_thumb()
        if thumb.format == rawpy.ThumbFormat.JPEG:
            preview_bytes = thumb.data
        else:
            preview_bytes = encode_jpeg(thumb.data)
    except rawpy.LibRawNoThumbnailError:
        # 2. Fallback: demosaic from RAW (slow, but reliable)
        rgb = raw.postprocess(use_camera_wb=True, no_auto_bright=False)
        preview_bytes = encode_jpeg(rgb, quality=92)

# From the preview then derive the web renditions with Pillow/libvips
```

The LibRaw docs confirm it: the embedded preview is the fast path to the thumbnail that covers nearly every RAW format. For galleries that's enough in 99% of cases — the customers want to see what they're selecting, not the maximum possible RAW quality.

**Important:** the **original RAW stays untouched** in storage. Renditions are only derived JPEGs/WebPs.

### 5.3 Renditions pipeline

Per photo we generate several variants — **with libvips** (via `pyvips`), which is 4–8× faster than ImageMagick and needs less RAM:

| Rendition          | Purpose                              | Dimensions          | Format              |
| ------------------ | ---------------------------------- | ------------- | ------------------- |
| `thumb`            | Grid view in the gallery       | 400 px long edge | WebP, quality 75 |
| `preview`          | Lightbox / mobile                  | 1600 px       | WebP/AVIF, qual. 82 |
| `web`              | Lightbox on large displays      | 2560 px       | WebP/AVIF, qual. 85 |
| `watermarked`      | When download is disabled         | like `web`     | JPEG + watermark    |
| `download` (opt.)  | "Web-resolution" download variant | 2048 px       | JPEG, qual. 92      |
| Original           | Full download (RAW or full JPEG) | unchanged   | original format      |

### 5.4 Video processing

For video (MP4, MOV, AVI, MKV, HEVC, ProRes) in the worker via **ffmpeg**:

1. **Poster** — a frame at 10% of the runtime as a JPEG.
2. **Web stream (HLS)** — adaptive bitrates: 480p, 720p, 1080p (4K optional). Code: `ffmpeg -i input.mov -filter:v ... -hls_time 6 -hls_playlist_type vod ...`. Delivers butter-smooth streaming instead of a 2-GB browser download.
3. **Scrubbing thumbnails** — a sprite sheet (one image every 10 sec, as one large JPEG) for the player preview on scrubbing.
4. **Original** — stays in storage for download.

Optional **GPU acceleration** (NVENC/QSV) if the host has a GPU — drastically faster with 4K material.

### 5.5 Gallery view (customer experience)

What the customer sees via the link `https://photos.studio.de/g/abc123`:

1. **Cover** — a large hero image + gallery title + studio branding.
2. **Optional:** password entry / email capture (for lead gen, can be turned off).
3. **Grid** — a virtualized masonry layout (e.g. `react-photo-album` with `react-window`). With 5,000 images **only** the visible ones load. Thumbnails are delivered via `<img loading="lazy">` + `srcset`.
4. **Lightbox** — PhotoSwipe v5, keyboard, touch, pinch zoom, fullscreen, slideshow.
5. **Per image:** like, color tag (red/yellow/green), comment, scribble tool (on touch devices with a stylus), star rating.
6. **Filter** — "show selected only", "commented only", "by color".
7. **Download** — single download or ZIP (see below).

### 5.6 ZIP downloads (a big pain point done right)

The naive approach would be: "pack everything into one ZIP and deliver it" — at 10 GB the server dies. Done right:

- **Streaming ZIP**: the worker builds the ZIP stream on the fly and passes it directly to the HTTP response (`archiver` in Node or `zipstream-ng` in Python). No temp file, no RAM blow-up.
- For **repeatable** downloads (e.g. after a selection): cache the ZIP in S3 once and return the link for 7 days.
- **Resumable** via HTTP Range, as far as the stream allows — alternatively in chunks (multiple ZIPs of 5 GB each).

### 5.7 Lightroom / Capture One workflow

Picdrop's killer feature: the customer selection back into Lightroom. We offer:

1. **Export file** — download of a `.txt`/`.csv` with the selected file names.
2. **XMP sidecars** — per selected photo an `.xmp` file with `xmp:Rating` or `xmp:Label` that Lightroom/Capture One recognize directly when you place them next to the original RAWs.
3. **Lightroom plugin** (phase 2) — a Lua plugin that pulls the selection via an API token and marks the corresponding images in Lightroom.

---

## 6. Feature matrix

Lumio is beyond the original MVP. The following state reflects the **actually shipped** system.

### Built & in production

| Area | Features |
| ------- | -------- |
| **Galleries** | Create, upload (browser→S3, parallel chunks), draft/live/archived, password protection, expiry date, cover, gallery tags, chapters, gallery templates/presets |
| **Media** | RAW (CR2/CR3/NEF/ARW/RAF/DNG/ORF/PEF/RW2/X3F), JPEG/PNG/WebP/AVIF/TIFF/HEIC, video (MP4/MOV/AVI/MKV/HEVC/ProRes), HLS transcoding, slideshow |
| **Customer experience** | Login-free gallery, lightbox (keyboard/touch/pinch), like / color tag / star rating, comments, scribble annotations directly on the image, selection limit, ZIP streaming download, mobile-first |
| **Branding** | Per-studio and per-gallery branding (logo, colors, font, footer), custom domains, hero/welcome texts, animation levels |
| **Studio** | Team members + roles (Owner/Member), granular gallery team access, bulk actions, manual + AI-assisted tagging, duplicate detection, audit log, statistics/analytics, API tokens |
| **Security** | TOTP 2FA, passkeys/WebAuthn, argon2id, signed URLs, rate limiting, GDPR data export (per gallery as a ZIP), automatic deletion/archive deadlines |
| **Print shop** | Print sales from the gallery (products/variants/shipping/providers), crop, cart, checkout with Stripe, order confirmation & tracking |
| **Plugins** | Lightroom Classic plugin (publish service), Capture One plugin, webhooks |
| **Multilingual** | Studio interface German + English (fully i18n, switchable) |
| **Multi-tenancy & billing** | Single/multi mode, self-service signup, Stripe subscriptions + trial + read-only tiers, plan limits, banners |
| **Operations** | Docker Compose stack, horizontal worker scaling across multiple nodes (Hetzner Private Network), wildcard TLS via acme-dns, Umami analytics (cookieless, optional) |

### AI tagging (deliberately opt-in)

Picdrop is intentionally AI-free. Lumio offers automatic tagging as a **switchable opt-in** via a separate ML worker image (`docker-compose.ml.yml`, CPU; GPU optional). Suggestions are shown to the studio for confirmation, nothing is applied without being asked.

### Planned / open

| Feature |
| ------- |
| More languages (FR, ES, IT) |
| Usage-based additional billing (storage add-ons via Stripe Metered) |
| Global search across all galleries ("DAM-light") |
| Public API + OAuth |
| Mobile app (upload from the iPhone) |
| Live collaboration with real-time cursors of other viewers |

## 7. Multi-tenancy — one instance for one or many studios

Lumio can do both: **a single studio installation** (classic self-hosting) **or a multi-tenant instance** for SaaS providers, agencies with multiple brands, or hosted providers. The mode is chosen via a single environment variable:

```
DEPLOYMENT_MODE=single   # exactly one tenant, created automatically at start
DEPLOYMENT_MODE=multi    # any number of tenants, each with its own domain
```

### 7.1 How separation works technically

We use **logical multi-tenancy with `tenant_id` on every protected table** (shared database, shared schema). That's the most pragmatic way:

- **One** PostgreSQL database, **one** schema, **one** S3 bucket.
- Each table (except `tenants` itself and `billing_plans`) has a `tenant_id` column.
- The API enforces a filter on `tenant_id` on **every** query (a middleware layer, not a "forgettable" WHERE).
- Storage keys in S3 are prefixed by tenant: `t/<tenant_uuid>/files/<file_id>/...`. That way a tenant can be fully disposed of via `aws s3 rm --recursive` if needed.

**Advantage over "schema per tenant" or "DB per tenant":** simple migrations, one connection pool, simple operating. **Disadvantage:** no hard isolation at the DB level — hence the strict API middleware. For customers with extreme compliance requirements, a dedicated instance per tenant is still the right answer.

### 7.2 Tenant resolution per request

Which tenant is currently active results from the request (in this order):

1. **Custom domain** — `studio-mueller.de` → lookup in `tenants.custom_domain`.
2. **Subdomain** — `studio-mueller.lumio.example.com` → lookup in `tenants.slug`.
3. **Gallery link** — `/g/<slug>` → the gallery knows its tenant.
4. **Studio login** — the session ID is coupled to `tenant_id`.
5. **Single-mode fallback** — the only existing tenant is used automatically.

Caddy does this transparently: one wildcard certificate (`LUMIO_WILDCARD_HOST=*.lumio-cloud.de`) via the **acme-dns** method (an own acme-dns container as a DNS mediator, no DNS provider API key needed) plus per-domain ACME for custom domains. The wildcard is opt-in via the Compose profile `wildcard`.

### 7.3 Branding isolation

Each tenant has its own `branding` profile (logo, colors, font, footer text, optional custom CSS), which is additionally overridable per gallery. In hosted mode the Lumio branding can be shown or hidden per plan (Free plan: "Powered by Lumio" visible, Pro plan: fully whitelabel).

### 7.4 Switching between modes

`single` → `multi` is possible at any time by setting `DEPLOYMENT_MODE=multi` and redeploying. The existing single tenant is preserved and can keep being used; additional tenants are created via the admin interface or CLI.

`multi` → `single` only makes sense if exactly one tenant exists.

---

## 8. Hosted mode — offering Lumio as a service

Hosted mode combines `DEPLOYMENT_MODE=multi` with `BILLING_ENABLED=true`. With it you can run Lumio as a standalone SaaS service and offer your customers a paid cloud variant — they book a plan, you manage the infrastructure, they pay monthly or yearly.

### 8.1 Plan system

Plans are defined in the `billing_plans` table. Each plan sets limits and unlocks features:

| Field                | Meaning                                                     |
| ------------------- | ------------------------------------------------------------- |
| `storage_gib`       | Maximum storage in GiB (NULL = unlimited)                |
| `galleries_max`     | Maximum number of active galleries                              |
| `files_per_gallery` | Maximum number of files per gallery                             |
| `users_max`         | Maximum number of studio members                             |
| `bandwidth_gib_per_month` | Traffic limit, reset monthly              |
| `custom_domain`     | Boolean — custom domains allowed?                             |
| `white_label`       | Boolean — can the Lumio branding be hidden?                        |
| `watermarking`      | Boolean — watermark feature                              |
| `analytics`         | Boolean — detailed statistics                            |
| `price_monthly_cents`, `price_yearly_cents`, `currency` | Price                |
| `stripe_price_id_monthly`, `stripe_price_id_yearly`     | Stripe integration      |

The actually implemented plans (source: `apps/api/src/services/plans.ts`):

| Plan   | Storage | Active galleries | Branding profiles | Custom domain | Team  | Watermark | Price/month |
| ------ | -------- | --------------- | ---------------- | ------------- | ----- | --------- | ----------- |
| Start  | 150 GB   | 5               | –                | no          | 1     | no      | €9         |
| Solo   | 500 GB   | 10              | –                | no          | 1     | no      | €19        |
| Studio | 1,000 GB | 50              | 1                | 1             | 1     | yes      | €39         |
| Pro    | 3,000 GB | unlimited      | 5                | unlimited    | up to 3 | yes      | €89         |

Plus a **14-day trial** (100 GB, 10 galleries, full access) and a **storage add-on** (+50 GB for +€9/month). Annual payment is ~17% cheaper (2 months free).

### 8.2 Stripe integration

The `apps/api` routes under `/api/v1/billing/*` talk to Stripe:

- **Checkout session** for new subscriptions (card, SEPA, Apple Pay configured automatically).
- **Customer portal** for plan changes, cancellation, invoice download — Stripe hosts the UI, we only link to it.
- **Webhook receiver** under `/api/v1/billing/webhook` processes `checkout.session.completed`, `invoice.paid`, `customer.subscription.updated`, `customer.subscription.deleted`. This syncs the local `billing_subscriptions` state with Stripe.

Taxes (DE: 19% VAT, EU: reverse charge, third country: no VAT) are handled entirely via Stripe Tax — no own tax logic needed.

### 8.3 Limit enforcement

A periodic worker job (`tasks.billing.update_tenant_usage`, runs hourly) aggregates the actual usage per tenant and writes it to `billing_subscriptions.storage_bytes_used` and `bandwidth_bytes_used`.

Before every **upload init** the API checks whether `storage_bytes_used + sum(new files) > plan.storage_gib`. If yes: HTTP 402 (Payment Required) with an upgrade hint.

On **bandwidth overage** the tenant is not hard-blocked (that would be customer-hostile if a shoot is running right then), but the owners are informed by email. Optionally the provider can configure throttling from day X on permanent overage.

On a **failed payment** (`status=past_due`) the tenant stays fully functional for 7 days, then galleries are set to "expired" for end customers (the studio login is preserved so nobody loses data). After 30 days `unpaid`: hard suspension, after 90 days a notice of imminent deletion.

### 8.4 Usage-based add-ons (phase 2)

Via the `billing_usage_records` table, **usage-based additional billing** can be added later — e.g. "€5 per additional 100 GiB storage". Stripe Metered Billing accepts the records monthly.

### 8.5 Onboarding flow in multi mode

There are three onboarding paths, depending on the mode:

1. **Self-host, single mode** (`DEPLOYMENT_MODE=single`, no Stripe): the default tenant is created automatically at the first start; only a `create-admin` call for the first user is needed.
2. **Self-host, multi mode** (an agency without billing): the super admin creates tenants manually.
3. **SaaS mode** (`multi` + `BILLING_ENABLED=true` + Stripe): self-service signup via the marketing site (lumio-cloud.de) — email + password + studio name + desired subdomain, a 14-day trial, then plan selection or read-only.

### 8.6 Operational topics

- **Backups** in hosted mode are mandatory: `pg_dump` daily, the S3 bucket with object versioning and cross-region replication.
- **Monitoring**: cookieless **Umami** analytics (the shipped stack under `infra/umami`, opt-in via `LUMIO_UMAMI_HOST`); errors/infra metrics as needed (e.g. Sentry/Prometheus).
- **Support channel**: Helpscout, Crisp or simply email. Send the tenant ID along with every request.
- **SLA**: for paying customers promise at least 99.5% uptime; outages are tracked in `events` and mirrored to a status page.

### 8.7 When to leave hosted mode disabled?

If you **purely self-host** the software (single or multi mode without selling): `BILLING_ENABLED=false`. Then the billing tables exist, but no limits are enforced and no Stripe webhooks are active. All features are unlocked for all tenants.

---

## 9. Security & privacy

Since the target group is professionals with NDAs, this is not an "add-on" but core.

- **Gallery tokens** are cryptographically random (32 bytes) and unguessable.
- **Password protection** with Argon2id.
- **Signed URLs** for every S3 access, with short validity (e.g. 60 minutes).
- **Rate limiting** on login, gallery access, comments (e.g. via `@fastify/rate-limit`).
- **HTTPS everywhere** — Caddy does that automatically.
- **HTTPOnly + SameSite=Strict** session cookies.
- **CSP** headers for the frontend.
- **EXIF stripping** for web renditions optional (GPS data out).
- **Watermark mode** when downloads are blocked — the browser element too is protected against "save image" with `pointer-events` and a CSS overlay (no real DRM, but a hurdle).
- **Audit log** for: login, gallery creation, share link generated, file deleted, download.
- **GDPR tools**: "delete a gallery automatically after X days", "export all customer comments", "right to erasure" implementable.
- **Data residency**: self-hosted — you decide where the data lives (your own server, Hetzner, AWS Frankfurt, Wasabi…).

---

## 10. Deployment — Docker Compose

The stack is run via **several composable Compose files**. The base (`docker-compose.yml`) builds the images locally; overrides activate production or optional building blocks:

| File | Purpose |
| ----- | ----- |
| `docker-compose.yml` | Base: caddy, frontend, api, worker, postgres, redis, minio (local build) |
| `docker-compose.prod.yml` | Replaces the `build:` blocks with prebuilt images from the **Forgejo container registry** (`forgejo.thiel.tools/thiel/lumio-{api,frontend,worker}:${LUMIO_TAG}`) |
| `docker-compose.ml.yml` | An additional ML worker for AI tagging (CPU) |
| `docker-compose.gpu.yml` | GPU acceleration (NVIDIA) for transcoding/ML |
| `docker-compose.worker.yml` | A pure worker node for horizontal scaling (own server) |

**Self-hosting (single mode), the simplest case:**

```bash
cp .env.example .env      # set secrets (S3 keys, DB password, JWT_SECRET …)
docker compose up -d      # acme-dns is profile-gated and stays off
```

This runs everything on one host including MinIO; `DEPLOYMENT_MODE=single` creates the default tenant at the first start.

**Production SaaS operation (reference: lumio-cloud.de):** wildcard TLS for tenant subdomains requires the `wildcard` profile (otherwise acme-dns doesn't start and the wildcard certificate breaks):

```bash
cd /opt/docker/lumio/lumio && git pull && \
  docker compose --profile wildcard \
    -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml \
    up -d --build
```

**Horizontal scaling:** workers can be offloaded to additional nodes. The main server and worker nodes sit in a private network (Hetzner Private Network); Redis is password-protected and binds only to the internal IP. A worker node deploys with `docker-compose.worker.yml` + its own `.env.worker`; Celery clusters automatically. Important: `apps/frontend` and `apps/api` concern only the main server, `apps/worker` changes all nodes (nodes always **after** the main server because of DB migrations). Details: `docs/SCALING.md`.

**Reverse proxy:** Caddy serves the app domains (studio + wildcard) and the marketing sites via separate blocks (configuration under `infra/caddy/Caddyfile`, controlled via `LUMIO_WILDCARD_HOST`).

**Reference hardware (prod):** Hetzner CCX in Falkenstein (fsn1), 12 vCPU / 24 GB RAM / 480 GB, Hetzner Object Storage instead of MinIO.

**Recommended minimum hardware (self-host):**
- 4 vCPU, 8 GB RAM (a small studio, ~50 GB/month traffic)
- 8 vCPU, 16 GB RAM (several parallel uploads, AI tagging active)
- GPU optional, a significant speedup for 4K video and ML tagging

## 11. Performance optimizations

Where Picdrop feels "fast" — and how we replicate it:

| Lever                              | Implementation                                                             |
| ---------------------------------- | --------------------------------------------------------------------------- |
| Direct-to-S3 upload                | Presigned URLs, the backend not in the data stream                                 |
| Virtualized grid               | Only visible thumbnails are rendered (`react-window`)                  |
| `srcset` / responsive images        | The browser fetches the size matching the viewport                                     |
| AVIF/WebP instead of JPEG               | 30–50% smaller files at the same quality                              |
| HTTP/3 (QUIC)                      | Several parallel streams without head-of-line blocking                        |
| Aggressive HTTP caching            | `Cache-Control: public, immutable, max-age=31536000` for renditions (hash in the path) |
| CDN-ready                          | Static assets + renditions are cacheable; a Cloudflare/Bunny CDN can be put in front |
| Prefetching                        | Next/prev images in the lightbox are preloaded                       |
| libvips instead of ImageMagick          | 4–8× faster on thumbnails                                               |
| Multi-worker                       | Celery workers horizontally scalable                                         |
| Connection pooling                 | pgBouncer optional with many simultaneous gallery views               |

---

## 12. Repo, release & license

- **Repo structure**: monorepo (pnpm workspaces) — `apps/frontend`, `apps/api`, `apps/worker` (Python/Celery), `apps/lightroom-plugin`, `apps/capture-one-plugin`, `packages/shared` (shared types).
- **Three repositories**: app code (`lumio.git`) plus two Astro marketing sites — `lumio-cloud-de.git` (SaaS + sign-up + Stripe) and `lumio-app-de.git` (the self-host pitch).
- **Hosting**: **Forgejo** (`forgejo.thiel.tools/thiel/*`) is primary; **GitHub** serves as the public push mirror.
- **License**: **FSL-1.1-ALv2** (Functional Source License) — source-available. Forbids competing SaaS hosting (*Competing Use*), but automatically converts to Apache 2.0 two years after each release. A commercial license for hosted/competing offerings on request.
- **Images/CI**: container images live in the **Forgejo container registry**; deployment via `git pull` + `docker compose … up -d --build`.
- **Docs**: in the repo under `docs/` (among others `STORAGE.md`, `SCALING.md`, `SAAS_MODE.md`).
- **Demo/launch**: self-host first (r/selfhosted, awesome-selfhosted, Hacker News, Mastodon) — communicated as *source-available*, not "open source". GDPR / "data stays in Germany" as the central differentiator.

## 13. What Picdrop can do that we deliberately leave out (at least at the start)

- Global search across all galleries of an agency ("DAM-light") — phase 2/3.
- Cloud-storage integration (Dropbox, Drive) — self-hosted doesn't need that as urgently.
- Paid subscription logic is disabled in self-host mode (`BILLING_ENABLED=false`); active via Stripe for your own cloud variant. (The **print shop** for selling images has since been built and is no longer excluded.)
- Complex permission management with a hundred roles — we stick with: owner, team member, gallery guest.

---

## 14. Risks & open questions

1. **RAW compatibility of new cameras.** LibRaw is actively maintained, but brand-new cameras (e.g. the Sony α1 II right at release) sometimes need updates. Strategy: rebuild the worker image regularly, automatically extract CR3/etc. with `exiftool` as a fallback preview.
2. **HEIC/HEIF patent situation** — libheif is OSS, but the HEVC encoder/decoder can be hidden in some distributions. Test in the Docker image before release.
3. **Adobe DNG special cases** — LibRaw treats DNG white balance differently from dcraw, which can lead to visibly different previews — usually acceptable for galleries, but document it.
4. **Mobile upload of large RAWs from an iPhone** — Safari has upload limits, possibly consider the Tus protocol (resumable uploads) instead of plain multipart.
5. **Scaling with huge galleries (10,000+ images)** — pagination + virtual scrolling are planned, but load tests have to follow.
6. **The "competing with Picdrop" angle** — Picdrop is an established tool. Differentiation: self-hosted, source-available, data stays in Germany/EU, no lock-in, NDA-capable. Not "kill Picdrop", but fill a gap.

---

## 15. Status & next steps

The original MVP (the sections below) is fully shipped and in production, as is a large part of the former phase-2/3 features (multi-tenancy, billing, 2FA/passkeys, print shop, AI tagging, plugins, DE/EN i18n, multi-node scaling).

**Open points:**

1. Keep the **GitHub mirror** clean (syncs from Forgejo).
2. **Stripe bootstrap** for new SaaS plans (`docker compose exec api npm run stripe-bootstrap`) — SaaS mode only.
3. Have the **legal texts** (DPA/Art. 28 GDPR, terms, privacy) reviewed by a lawyer; set the imprint/privacy URLs in the lumio-cloud.de env.
4. Switch on **Umami analytics** (A record `stats.lumio-cloud.de`, `LUMIO_UMAMI_HOST`).
5. Finalize the **Capture One plugin**.
6. **More languages** (FR/ES/IT) as needed.
7. **Launch** of the self-host variant (communities) + a public demo instance.

## Appendix: important libraries & tools

- **Image processing**: libvips (via pyvips), Pillow, libheif; imageio as a bridge
- **RAW**: rawpy (LibRaw wrapper), exiftool (metadata)
- **Video**: ffmpeg (HLS/transcoding)
- **Backend**: Fastify, Zod, **Prisma** (PostgreSQL), ioredis, Stripe, argon2 (own session/2FA/passkey auth)
- **Worker**: Python, **Celery** (Redis broker), boto3, a separate ML image for AI tagging
- **Frontend**: **Next.js 16**, **React 19**, Tailwind CSS, TanStack Query; marketing sites in **Astro**
- **DevOps**: Docker Compose, Caddy (+ acme-dns for wildcard TLS), Forgejo (code + container registry, GitHub mirror), **Umami** (cookieless analytics)
- **i18n**: an own lightweight dictionary system (`apps/frontend/src/lib/i18n`, DE/EN)
- **Testing**: Vitest, Playwright (E2E), pytest (worker)

---

*End of concept.*
