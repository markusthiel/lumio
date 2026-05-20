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
- [x] CI-Pipeline (Forgejo Actions) — Lint, Build, Test
- [x] Container-Images automatisch nach Container-Registry (Forgejo, mit `docker-compose.prod.yml`-Override und `LUMIO_TAG`-Pin)

---

## Phase 1 — MVP (Sprint 1–4)

**Ziel:** Eine lauffähige Galerie-Anwendung mit Upload, Anzeigen, Likes, Download.

### Sprint 1 — Auth & Tenancy

- [x] Tenant-Auto-Bootstrap im single-Mode (erster Start legt Default-Tenant an)
- [x] User-Registrierung + Login (E-Mail + Passwort, Argon2)
- [x] Session-Management mit HTTPOnly-Cookies
- [x] CLI: `npm run create-admin`
- [x] Tenant-Resolver-Middleware (Domain/Subdomain/Slug)

### Sprint 2 — Upload-Pipeline ✅ (großteils)

- [x] Galerie erstellen über die API
- [x] Browser → S3-Presigned-PUT mit Multipart-Support
- [x] Worker: process_file für JPEG/PNG/WebP/TIFF/HEIC (Renditions thumb/preview/web mit libvips)
- [x] Studio-UI: Galerie-Liste, Create-Dialog, Detail-Seite mit Drag&Drop-Upload
- [x] Stream-basierte Job-Queue (Redis Streams) zwischen API und Worker
- [x] Polling-basiertes Status-Update im Frontend (alle 2s während processing)
- [x] WebSocket-Push für File-Status (ersetzt 2s-Polling im Studio durch /ws/galleries/:id; Polling bleibt als 10s-Fallback drin)
- [x] Worker-Test: tatsächlich ein Bild end-to-end durchlassen
      (Integration-Test mit testcontainers, läuft in CI mit Postgres+MinIO-Services)

### Sprint 3 — Kunden-Galerie ✅ (großteils)

- [x] Galerie-Slug-Route `/g/[slug]` mit Branding
- [x] Passwort-Gate
- [x] Grid-Ansicht (Standard-Grid, virtualisiertes Masonry kommt Phase 2)
- [x] Lightbox mit Tastatur-Navigation + Touch + Filtern
- [x] Like / Color-Tag (Sterne-Rating-UI kommt Phase 2)
- [x] Mobile-Touch-Optimierung (alle Tap-Targets ≥36px)
- [x] Share-Link-Verwaltung im Studio inkl. Tokens und Berechtigungen
- [x] Visitor-Session via HMAC-Cookie statt Token-in-jeder-URL

### Sprint 4 — Download & Proofing ✅

- [x] Single-File-Download via Presigned URL
- [x] Kommentare pro Bild
- [x] Studio-Übersicht: welche Files wurden ausgewählt? (`/galleries/:id/proofing/summary`)
- [x] Streaming-ZIP-Builder (Worker-Task build_zip mit S3-Multipart)
- [x] Watermark-Rendition (wenn Download deaktiviert)
- [x] CSV-Export der Auswahl
- [x] **XMP-Sidecar-Export für Lightroom Classic / Capture One**
- [x] Studio-UI für Proofing-Summary mit Stats + per-Access-Tabelle + File-Liste
- [x] Email-Notifications (neuer Kommentar)
- [x] Selection-Abschluss-Button für Kunde mit Email-Notification
- [x] Auswahl-ZIP-Notification an Kunde (lazy notify beim ersten ready-Poll)
- [x] Watermark-Image-Upload-UI im Studio (Presigned PUT direkt zu S3)

---

## Phase 2 — Pro Features (Sprint 5–8)

### RAW & Video ✅ (großteils)

- [x] Worker: process_raw mit rawpy — embedded JPEG-Preview als Fast-Path,
      Fallback auf vollständiges Demosaicing (use_camera_wb=True),
      anschließend gleiche libvips-Pipeline wie für Standardbilder
- [x] Worker: process_video mit ffmpeg → Poster + HLS-Adaptive-Bitrate
      (480p/720p/1080p, kein Upscaling) + Scrubbing-Sprite-Sheet
- [x] API: HLS-Proxy-Route (`/g/:slug/files/:id/hls/...`) damit Playlists
      mit relativen Segment-Pfaden funktionieren ohne Bucket public zu machen
- [x] Frontend: hls.js Video-Player mit Safari-nativem HLS-Fallback
- [x] Frontend: Video- und RAW-Indikatoren im Grid (Play-Icon, RAW-Badge)
- [x] Worker-Tests (pytest, 6 grün) für HLS-Variant-Auswahl und kbps-Parsing
- [x] Video-Scrubbing-Vorschau im Player nutzen (Sprite-Sheet ist da; Hover über Progress-Bar zeigt Frame-Thumbnail mit Zeit-Tooltip)
- [x] HW-Beschleunigung optional (NVENC/QSV/VAAPI via LUMIO_HW_ENCODER, fällt auf libx264 zurück; siehe DEVELOPMENT.md)
- [x] HEIC/HEIF in der API als eigene Kind detection (eigene `"heic"`-Variante, Format-Badge im Studio + Customer-Tile, Windows-Hinweis am Lightbox-Download)
- [ ] PSD-Preview-Extraktion

### Branding & Whitelabel ✅ (Phase 1)

- [x] Branding-Editor im Studio (Logo, Favicon, Farben, Schrift, Texte, Custom-CSS)
- [x] Pro-Galerie-Branding-Overrides (mit Tenant-Default-Fallback)
- [x] Custom-Domain-Eintrag in den Tenant-Settings
- [x] Branding-Resolver mit Presigned-GET-URLs für Assets (24h Cache)
- [ ] Automatisches TLS für Custom Domains (aktuell: Caddy muss manuell konfiguriert sein)
- [ ] DNS-Verifizierung (TXT-Record-Challenge)

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
- [x] Selection-Limit ("Kunde darf max. N wählen") — Galerie-Setting im Studio, Counter "X von Y" in der Customer-Hero, Optimistic-Update-Rollback bei Limit-Verletzung mit Toast
- [x] Real-time Sync der Auswahl zwischen Studio und Kunde (Studio bekommt live Toasts bei Selection-Changes, Comments und Finalize via WebSocket; Customer-Side bleibt single-user wie Picdrop)

### Workflow

- [x] XMP-Sidecar-Export (Lightroom/Capture One kompatibel)
- [x] Bulk-Aktionen im Studio: Multi-Select + delete + hide/show + Drag&Drop-Sortierung (Touch + Keyboard via @dnd-kit)
- [x] Galerie-Templates / Presets (Mode/Toggles/Branding/Expiry/Default-Description)
- [x] Email-Notifications (Auswahl fertig, neuer Kommentar)
- [x] Presentation Mode (Vollbild-Slideshow mit Auto-Advance, Cross-Fade, einstellbarem Intervall)

---

## Phase 3 — Polish & Wachstum

- [x] Lightroom Classic Plugin (Lua) — pullt Auswahl direkt in den Katalog (`apps/lightroom-plugin/`)
- [x] Capture One Plugin (AppleScript + Python-CLI für macOS, spiegelt Auswahl in den aktiven Katalog/Session; pflegt dieselbe `/api/v1/plugin/*` API wie das Lightroom-Plugin)
- [x] Mehrsprachigkeit Studio + Customer-Seite (DE, EN — weitere folgen via i18n-Dictionary-System; in-Gallery-Locale-Picker für Visitor steht noch aus)
- [ ] Mobile App (React Native) für iOS/Android — Upload aus der Kamera-Rolle
- [ ] Public API mit OAuth2
- [x] Webhooks für Studio-Events (HMAC-SHA256-signiert, async-Delivery mit Exponential-Backoff-Retry, /studio/webhooks-UI mit Test-Button und Delivery-Log)
- [x] Detaillierte Galerie-Statistiken (Aufrufe über 30 Tage, Pro-Access-Aufschlüsselung mit Visits/Likes/Kommentare/Finalized-Status, Top-Files nach Likes, Downloads nach Typ; `/studio/[id]/stats` mit SVG-Sparklines)
- [ ] Optionales KI-Tagging (lokal über Ollama, opt-in)
- [ ] E-Signatures für Modelverträge / Rechte-Freigaben
- [ ] Online-Shop (Bilder verkaufen, Stripe)
- [x] 2FA für Studio-Logins: TOTP (otplib + 8 Backup-Codes) + WebAuthn/Passkeys (@simplewebauthn, Touch-ID/Windows-Hello/Security-Keys, mehrere Credentials pro User)
- [x] Audit-Log-Viewer im Studio (instrumented: login/logout, gallery CRUD, file delete/bulk, share create/delete/unlock, selection.finalize, branding CRUD; /studio/audit mit Galerie/Action/Zeit-Filter + Client-CSV-Export; Server-CSV-Export für große Logs steht noch aus)

---

## Phase 4 — Enterprise / DAM-Light

- [x] Globale Suche über alle Galerien eines Tenants (Cmd/Ctrl+K Command-Palette mit Live-Suche über Galerien, Files, Brandings, Templates; ILIKE-Backend, 4 parallele Queries in einem Roundtrip)
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
