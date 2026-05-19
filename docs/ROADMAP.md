# Lumio — Roadmap

Stand: Mai 2026. Lebendiges Dokument — Priorisierung kann sich verschieben.

---

## Phase 0 — Skeleton & Infrastruktur ✅ in Arbeit

- [x] Monorepo-Struktur (apps/api, apps/frontend, apps/worker, packages/shared)
- [x] Docker-Compose-Stack mit Postgres, Redis, MinIO, Caddy
- [x] Prisma-Schema (vollständiges Datenmodell inkl. Multi-Tenancy + Billing)
- [x] API-Skeleton mit Fastify + Health-Endpoint
- [x] Worker-Skeleton mit Celery + Storage-Helper
- [x] Frontend-Skeleton mit Next.js + Tailwind
- [x] Konzept-Dokument
- [ ] CI-Pipeline (Forgejo Actions) — Lint, Build, Test
- [ ] Container-Images automatisch nach Container-Registry

---

## Phase 1 — MVP (Sprint 1–4)

**Ziel:** Eine lauffähige Galerie-Anwendung mit Upload, Anzeigen, Likes, Download.

### Sprint 1 — Auth & Tenancy

- [ ] Tenant-Auto-Bootstrap im single-Mode (erster Start legt Default-Tenant an)
- [ ] User-Registrierung + Login (E-Mail + Passwort, Argon2)
- [ ] Session-Management mit HTTPOnly-Cookies
- [ ] CLI: `npm run create-admin`
- [ ] Tenant-Resolver-Middleware (Domain/Subdomain/Slug)

### Sprint 2 — Upload-Pipeline ✅ (großteils)

- [x] Galerie erstellen über die API
- [x] Browser → S3-Presigned-PUT mit Multipart-Support
- [x] Worker: process_file für JPEG/PNG/WebP/TIFF/HEIC (Renditions thumb/preview/web mit libvips)
- [x] Studio-UI: Galerie-Liste, Create-Dialog, Detail-Seite mit Drag&Drop-Upload
- [x] Stream-basierte Job-Queue (Redis Streams) zwischen API und Worker
- [x] Polling-basiertes Status-Update im Frontend (alle 2s während processing)
- [ ] WebSocket-Push für Upload-Progress (Polling reicht für Phase 1)
- [ ] Worker-Test: tatsächlich ein Bild end-to-end durchlassen (manuell durchspielen)

### Sprint 3 — Kunden-Galerie

- [ ] Galerie-Slug-Route `/g/[slug]` mit Branding
- [ ] Passwort-Gate (optional)
- [ ] Grid-Ansicht mit virtualisiertem Masonry-Layout
- [ ] PhotoSwipe-Lightbox
- [ ] Like / Color-Tag / Stern-Rating
- [ ] Mobile-Touch-Optimierung

### Sprint 4 — Download & Proofing

- [ ] Single-File-Download via Presigned URL
- [ ] Streaming-ZIP-Builder (Worker-Task build_zip)
- [ ] Watermark-Rendition (wenn Download deaktiviert)
- [ ] Kommentare pro Bild
- [ ] Studio-Übersicht: welche Files wurden ausgewählt?
- [ ] CSV-Export der Auswahl

---

## Phase 2 — Pro Features (Sprint 5–8)

### RAW & Video

- [ ] Worker: process_raw mit rawpy für alle gängigen RAW-Formate
- [ ] Worker: process_video mit ffmpeg → Poster + HLS + Sprite-Sheet
- [ ] HLS-Player im Frontend (Video.js oder Vidstack)
- [ ] HEIC/HEIF-Support
- [ ] PSD-Preview-Extraktion

### Branding & Whitelabel

- [ ] Branding-Editor im Studio (Logo, Farben, Custom-CSS)
- [ ] Pro-Galerie-Branding-Overrides
- [ ] Custom-Domain-Support mit automatischem TLS

### Multi-Tenancy & Billing (Hosted Mode)

- [ ] Billing-Plan-Editor (CLI + UI)
- [ ] Stripe-Integration: Checkout, Webhooks, Customer Portal
- [ ] Usage-Tracking-Cronjob (storage + bandwidth)
- [ ] Limit-Enforcement bei Upload + Download
- [ ] Self-Service-Tenant-Registrierung

### Collaboration

- [ ] Team-Voting (mehrere Personen pro Access-Token)
- [ ] Live-Cursor in der Lightbox (WebSocket-Fanout)
- [ ] Scribbles/Annotationen auf Bild
- [ ] Selection-Limit ("Kunde darf max. N wählen")
- [ ] Real-time Sync der Auswahl zwischen Studio und Kunde

### Workflow

- [ ] XMP-Sidecar-Export (Lightroom/Capture One kompatibel)
- [ ] Bulk-Aktionen im Studio (sort, tag, delete, move)
- [ ] Galerie-Templates / Presets
- [ ] Email-Notifications (Auswahl fertig, neuer Kommentar)
- [ ] Presentation Mode (Vollbild, autoplay)

---

## Phase 3 — Polish & Wachstum

- [ ] Lightroom Classic Plugin (Lua) — pullt Auswahl direkt in den Katalog
- [ ] Capture One Plugin
- [ ] Mehrsprachigkeit (DE, EN, FR, ES, IT)
- [ ] Mobile App (React Native) für iOS/Android — Upload aus der Kamera-Rolle
- [ ] Public API mit OAuth2
- [ ] Webhooks für Studio-Events
- [ ] Detaillierte Galerie-Statistiken (Aufrufe, Downloads pro Bild, Heatmaps)
- [ ] Optionales KI-Tagging (lokal über Ollama, opt-in)
- [ ] E-Signatures für Modelverträge / Rechte-Freigaben
- [ ] Online-Shop (Bilder verkaufen, Stripe)
- [ ] 2FA für Studio-Logins (TOTP, WebAuthn)
- [ ] Audit-Log-Viewer im Studio

---

## Phase 4 — Enterprise / DAM-Light

- [ ] Globale Suche über alle Galerien eines Tenants
- [ ] Tagging-System mit Hierarchie
- [ ] Smart Collections / gespeicherte Filter
- [ ] Approval-Workflows (mehrere Reviewer in Sequenz)
- [ ] SSO (SAML, OIDC)
- [ ] Activity Log mit Compliance-Export
- [ ] Per-Folder-Permissions

---

## Nicht geplant

Bewusst weggelassen — soweit nicht zwingend nachgefragt:

- ❌ Eigener Editor für Bilder (Cropping, Filter) — bleibt im Workflow von Lightroom/Capture One.
- ❌ Komplexes Rechtemanagement mit dutzenden Rollen — Lumio bleibt schlank.
- ❌ Print-Druckdienste — kann später optional, kein Kern.
