**English** · [Deutsch](ROADMAP.de.md)

# Lumio — Roadmap

As of: June 2026. A living document — prioritization can shift. The app core is built and in production; the SaaS variant runs live at lumio-cloud.de.

---

## Phase 0 — Skeleton & infrastructure ✅

- [x] Monorepo structure (apps/api, apps/frontend, apps/worker, packages/shared)
- [x] Docker Compose stack with Postgres, Redis, MinIO, Caddy
- [x] Prisma schema (full data model incl. multi-tenancy + billing)
- [x] API skeleton with Fastify + health endpoint
- [x] Worker skeleton with Celery + storage helper
- [x] Frontend skeleton with Next.js + Tailwind
- [x] Concept document
- [x] CI pipeline (Forgejo Actions) — lint, build, test
- [x] Container images automatically to the container registry (Forgejo, with `docker-compose.prod.yml` override and `LUMIO_TAG` pin)
- [x] Wildcard TLS for tenant subdomains via acme-dns (Compose profile `wildcard`; see docs/WILDCARD.md)
- [x] Horizontal worker scaling across multiple nodes (Hetzner Private Network, password-protected Redis; see docs/SCALING.md)

---

## Phase 1 — MVP (sprints 1–4)

**Goal:** a working gallery application with upload, display, likes, download.

### Sprint 1 — Auth & tenancy

- [x] Tenant auto-bootstrap in single mode (first start creates a default tenant)
- [x] User registration + login (email + password, Argon2)
- [x] Session management with HTTPOnly cookies
- [x] CLI: `npm run create-admin`
- [x] Tenant resolver middleware (domain/subdomain/slug)

### Sprint 2 — Upload pipeline ✅ (mostly)

- [x] Create a gallery via the API
- [x] Browser → S3 presigned PUT with multipart support
- [x] Worker: process_file for JPEG/PNG/WebP/TIFF/HEIC (renditions thumb/preview/web with libvips)
- [x] Studio UI: gallery list, create dialog, detail page with drag & drop upload
- [x] Stream-based job queue (Redis streams) between API and worker
- [x] Polling-based status update in the frontend (every 2s during processing)
- [x] WebSocket push for file status (replaces 2s polling in the studio with /ws/galleries/:id; polling stays as a 10s fallback)
- [x] Worker test: actually pass an image through end-to-end
      (integration test with testcontainers, runs in CI with Postgres+MinIO services)

### Sprint 3 — Customer gallery ✅ (mostly)

- [x] Gallery slug route `/g/[slug]` with branding
- [x] Password gate
- [x] Grid view (standard grid, virtualized masonry comes in phase 2)
- [x] Lightbox with keyboard navigation + touch + filtering
- [x] Like / color tag (star rating UI comes in phase 2)
- [x] Mobile touch optimization (all tap targets ≥36px)
- [x] Share link management in the studio incl. tokens and permissions
- [x] Visitor session via an HMAC cookie instead of a token in every URL

### Sprint 4 — Download & proofing ✅

- [x] Single-file download via presigned URL
- [x] Per-image comments
- [x] Studio overview: which files were selected? (`/galleries/:id/proofing/summary`)
- [x] Streaming ZIP builder (worker task build_zip with S3 multipart)
- [x] Watermark rendition (when download is disabled)
- [x] CSV export of the selection
- [x] **XMP sidecar export for Lightroom Classic / Capture One**
- [x] Studio UI for the proofing summary with stats + per-access table + file list
- [x] Email notifications (new comment)
- [x] Selection-complete button for the customer with email notification
- [x] Selection ZIP notification to the customer (lazy notify on the first ready poll)
- [x] Watermark image upload UI in the studio (presigned PUT directly to S3)

---

## Phase 2 — Pro features (sprints 5–8)

### RAW & video ✅ (mostly)

- [x] Worker: process_raw with rawpy — embedded JPEG preview as a fast path,
      fallback to full demosaicing (use_camera_wb=True),
      then the same libvips pipeline as for standard images
- [x] Worker: process_video with ffmpeg → poster + HLS adaptive bitrate
      (480p/720p/1080p, no upscaling) + scrubbing sprite sheet
- [x] API: HLS proxy route (`/g/:slug/files/:id/hls/...`) so playlists
      with relative segment paths work without making the bucket public
- [x] Frontend: hls.js video player with Safari-native HLS fallback
- [x] Frontend: video and RAW indicators in the grid (play icon, RAW badge)
- [x] Worker tests (pytest, 6 green) for HLS variant selection and kbps parsing
- [x] Use the video scrubbing preview in the player (the sprite sheet is there; hovering over the progress bar shows a frame thumbnail with a time tooltip)
- [x] HW acceleration optional (NVENC/QSV/VAAPI via LUMIO_HW_ENCODER, falls back to libx264; see DEVELOPMENT.md)
- [x] HEIC/HEIF in the API as its own kind detection (its own `"heic"` variant, format badge in the studio + customer tile, Windows hint at the lightbox download)
- [x] Video web download as a standalone MP4 (new `video_mp4` rendition: 1080p or source resolution, +faststart, encoder via select_encoder()/profile_for(); customer single download and ZIP builder both adapted; backfill task `backfill_video_mp4` for the existing stock per gallery or globally)
- [x] PSD preview extraction (composite via Pillow, `apps/worker/psd.py`; libvips can't read PSD directly)

### Branding & whitelabel ✅ (phase 1)

- [x] Branding editor in the studio (logo, favicon, colors, font, texts, custom CSS)
- [x] Per-gallery branding overrides (with a tenant-default fallback)
- [x] Custom domain entry in the tenant settings
- [x] Branding resolver with presigned GET URLs for assets (24h cache)
- [ ] Automatic TLS for custom domains (currently: Caddy has to be configured manually)
- [ ] DNS verification (TXT record challenge)

### Multi-tenancy & billing (hosted mode) ✅

Fully built — detailed in phase 5.

- [x] Plan definitions (`services/plans.ts`) + seed migration
- [x] Stripe integration: checkout, webhooks, customer portal (`routes/billing.ts`)
- [x] Usage tracking cronjob (`worker/tasks/billing.py`, storage + bandwidth)
- [x] Limit enforcement on upload + gallery/custom-domain/branding
- [x] Self-service tenant registration (`routes/signup.ts`)

### Collaboration

- [ ] Team voting (multiple people per access token)
- [ ] Live cursor in the lightbox (WebSocket fanout)
- [x] Scribbles/annotations on the image (`AnnotationOverlay.tsx` + schema field `annotation`, in the customer gallery and studio proofing)
- [x] Selection limit ("the customer may choose at most N") — gallery setting in the studio, counter "X of Y" in the customer hero, optimistic-update rollback on limit violation with a toast
- [x] Real-time sync of the selection between studio and customer (the studio gets live toasts on selection changes, comments and finalize via WebSocket; the customer side stays single-user like Picdrop)

### Workflow

- [x] XMP sidecar export (Lightroom/Capture One compatible)
- [x] Bulk actions in the studio: multi-select + delete + hide/show + drag & drop sorting (touch + keyboard via @dnd-kit)
- [x] Gallery templates / presets (mode/toggles/branding/expiry/default description)
- [x] Email notifications (selection done, new comment)
- [x] Presentation mode (fullscreen slideshow with auto-advance, cross-fade, adjustable interval)

---

## Phase 3 — Polish & growth

- [x] Lightroom Classic plugin (Lua) — pulls the selection directly into the catalog (`apps/lightroom-plugin/`)
- [x] Capture One plugin (AppleScript + Python CLI for macOS, mirrors the selection into the active catalog/session; maintains the same `/api/v1/plugin/*` API as the Lightroom plugin)
- [x] Multilingual studio + customer page (DE, EN — more to follow via the i18n dictionary system; an in-gallery locale picker for visitors is still pending)
- [ ] Mobile app (React Native) for iOS/Android — upload from the camera roll
- [ ] Public API with OAuth2
- [x] Webhooks for studio events (HMAC-SHA256 signed, async delivery with exponential-backoff retry, /studio/webhooks UI with a test button and delivery log)
- [x] Detailed gallery statistics (views over 30 days, per-access breakdown with visits/likes/comments/finalized status, top files by likes, downloads by type; `/studio/[id]/stats` with SVG sparklines)
- [x] Optional AI tagging — **CLIP** locally on the server (no external API call), opt-in via the ML worker image (`docker-compose.ml.yml`, CPU/GPU), threshold via `LUMIO_CLIP_THRESHOLD`; see docs/ML.md
- [ ] E-signatures for model contracts / rights releases
- [x] Print shop / image sales — products/variants/shipping/providers, crop, cart, Stripe checkout (Stripe Connect), order confirmation + email (`services/print/*`, `routes/print-shop-public.ts`)
- [x] 2FA for studio logins: TOTP (otplib + 8 backup codes) + WebAuthn/passkeys (@simplewebauthn, Touch ID/Windows Hello/security keys, multiple credentials per user)
- [x] Audit log viewer in the studio (instrumented: login/logout, gallery CRUD, file delete/bulk, share create/delete/unlock, selection.finalize, branding CRUD; /studio/audit with gallery/action/time filters + client CSV export; server CSV export for large logs still pending)

---

## Phase 4 — Enterprise / DAM-light

- [x] Global search across all of a tenant's galleries (Cmd/Ctrl+K command palette with live search over galleries, files, brandings, templates; ILIKE backend, 4 parallel queries in one roundtrip)
- [x] Tagging system with hierarchy (tenant-wide tags with a parent relationship, color, gallery assignment with AND filter in the list, TagPicker component with inline chips; file-tag API ready, the UI for it follows with file bulk actions)
- [x] Super admin & multi-tenant management (`/super` login area, its own super_admins table + sessions, tenant CRUD with an initial owner + setup mail, suspend/reactivate/archive lifecycle, tenant-status guards in login + customer paths, setup-password flow for invited owners)
- [x] Gallery header design (hero image from the gallery or upload, overlay color, background color as a fallback, per-gallery event logo, welcome markdown with react-markdown, OG meta tags for share previews in WhatsApp/iMessage/Slack, Web Share API button with clipboard fallback)
- [x] Gallery footer + gallery colors (footerMarkdown per gallery, colorBackground and colorAccent as overrides of the tenant branding, automatic text-color calculation via WCAG luminance)
- [x] Hero layout variants (four variants: Minimal, Splash with fullscreen + scroll hint, Side-by-side editorial, Centered magazine-style — shared fields, only the render arrangement differs)
- [x] Gallery fonts (heading + body selectable separately from a curated list of 8 fonts — 4 sans + 4 serif, GDPR-compliant via Bunny Fonts CDN, live preview in the studio)
- [x] Grid layout variants (masonry/justified/equal — CSS-only, no JS layout)
- [x] Slideshow expansion (three transition effects: fade/slide/Ken Burns with 4 pan directions, respects prefers-reduced-motion)
- [x] Slideshow background music (audio upload per gallery MP3/AAC/OGG max 30 MB, auto-play in the slideshow because of the user gesture, loop, volume slider with localStorage persistence)
- [x] Gallery chapters/sections (optional grouping layer, files keep the default bucket behavior when there's no section, the customer view gets sticky anchor navigation + divider bands with an optional cover image, studio editor with reorder + bulk file picker)
- [x] Smart collections / saved filters (studio-internal filter macros analogous to Lightroom: mode + status + tags AND-linked, saved per user per tenant, sidebar quick access + its own edit page, ad-hoc filters via query params to /galleries, persisted filters via /collections CRUD; date range prepared in the backend, the frontend datepicker follows)
- [ ] Approval workflows (multiple reviewers in sequence)
- [ ] SSO (SAML, OIDC)
- [ ] Activity log with compliance export
- [ ] Per-folder permissions

---

## Phase 5 — Cloud variant (SaaS extension)

**Goal:** Lumio as a managed service at `lumio-cloud.de` with self-service sign-up and automatic billing. The app core stays source-available (FSL) and self-hostable — this phase only concerns the hosted service layer on top. **Status: live at lumio-cloud.de.**

### Plan model & limits ✅ (commit `e15c5bc`)

- [x] Plan definitions (Start €9, Solo €19, Studio €39, Pro €89; + 14-day trial)
      as a central module in `services/plans.ts`
- [x] Live aggregation of storage usage without counter drift
- [x] Limit enforcement in the existing routes:
      upload init, gallery create, custom domain, branding
- [x] BillingSubscription table with storageAddonGib + readOnlySince
- [x] Migration seeding the 3 plans + an auto-Pro subscription for
      existing tenants
- [x] Studio page `/studio/billing` with plan + storage bar +
      galleries bar + feature overview + plan comparison
- [x] Storage banner at the top of every studio page at >80% storage,
      trial end <3 days or read-only mode
- [x] 402 dialog on upload with a link to the plan page
- [x] Feature gates: custom domain + branding settings disabled
      and with a plan hint when not covered
- [x] Gated via `BILLING_ENABLED` env — self-hosted without billing
      runs completely unchanged

### Domain separation app ↔ marketing

- [x] App code spots with hardcoded `lumio-cloud.de` switched to
      `studio.lumio-cloud.de` (plugin defaults Lightroom and
      Capture One, README examples, code comments)
- [x] Caddy docs on the new domain. Plus a note that the marketing
      sites live in their own repos.
- [x] MULTI_TENANT.md: app references to studio.lumio-cloud.de,
      tenant subdomains deliberately stay on `*.lumio-cloud.de`
      (the DNS wildcard is separate from the marketing site root)
- [x] DNS: `studio.lumio-cloud.de` points to the app server
- [x] Caddy serves the app domain + wildcard `*.lumio-cloud.de`
- [x] Tenant subdomain question decided: `<slug>.lumio-cloud.de`
      via the acme-dns wildcard

### Stripe integration ✅

Built in `routes/billing.ts` + `services/stripe-service.ts`/`stripe-client.ts`:

- [x] `POST /billing/subscription` — checkout session with a 14-day trial
- [x] `POST /billing/portal` — customer portal (card/plan/cancellation)
- [x] `POST /billing/webhook` — signature-verified; processes
      `checkout.session.completed`, `customer.subscription.updated/deleted`,
      `invoice.payment_succeeded/failed`
- [x] `/billing/plans`, `/billing/usage`, reactivate route
- [x] Storage add-on + payment methods (via Stripe)
- [ ] Operationally per deployment: bootstrap Stripe products/prices
      (`docker compose exec api npm run stripe-bootstrap`)

### Grace logic ✅

A state machine for `past_due` tenants built (`worker/tasks/billing.py`, `plugins/read-only.ts`, field `readOnlySince`): Stripe retry + dunning → login block → read-only → deletion announcement → hard delete with a GDPR-compliant data-export offer before deletion.

### Sign-up flow ✅

- [x] Self-registration (`routes/signup.ts`: `/signup`,
      `/signup/check-email`, `/signup/check-slug`)
- [x] Tenant + owner user + trial subscription + Stripe customer in one transaction
- [x] Onboarding/setup mail
- [x] Trial end → auto-charge or read-only

### Future extensions (open, no sprint planned)

- [x] Annual discount (~17%: yearly price = 10 monthly prices, `priceYearlyCents` in `plans.ts`; yearly toggle in the billing UI)
- [ ] One-time purchase variant for wedding couples ("€49 one-off,
      gallery active for 12 months") as a separate use case
- [ ] Affiliate/partner program
- [ ] Open core: split Pro features out of the FSL repo
      (e.g. SSO, team accounts) if there's market pressure
- [ ] Dual-licensing option (commercial license on request)
      if a concrete use case comes up

---

## Not planned

Deliberately left out — unless strongly requested:

- ❌ A built-in image editor (cropping, filters) — stays in the Lightroom/Capture One workflow.
- ❌ Complex permission management with dozens of roles — Lumio stays lean.
