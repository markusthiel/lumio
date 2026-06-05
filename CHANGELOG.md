# Changelog

Alle nennenswerten Änderungen an Lumio werden hier dokumentiert.

Das Format orientiert sich an [Keep a Changelog](https://keepachangelog.com/de/1.1.0/),
die Versionierung folgt [Semantic Versioning](https://semver.org/lang/de/).

> **Für Self-Hoster:** Vor einem Update immer den Abschnitt der Zielversion lesen.
> Ein Eintrag unter **⚠️ Upgrade-Hinweise** bedeutet, dass nach `git pull` ein
> manueller Schritt nötig ist (z.B. `.env` anpassen, Compose-Befehl ändern).
> Ohne solchen Hinweis genügt der reguläre Deploy laut `README` / `docs/OPERATIONS.md`.

## Versionsschema kurz

- **PATCH** (0.9.0 → 0.9.**1**): Bugfix, abwärtskompatibel, keine Aktion nötig.
- **MINOR** (0.**9** → 0.**10**.0): neues Feature, abwärtskompatibel. Pull genügt.
- **MAJOR** (0.x → **1**.0.0): Breaking Change, manueller Eingriff laut Upgrade-Hinweisen.

Solange wir bei `0.x` sind, kann sich strukturell noch etwas bewegen; Breaking
Changes werden trotzdem klar als solche markiert. Details: `docs/VERSIONING.md`.

## [Unreleased]

### Added
-

### Changed
-

### Fixed
-

## [0.42.0] - 2026-06-05

> Pull genügt für Self-Hoster (keine neue ENV, keine Migration). **Betrifft
> den Worker** — wer mit separaten Worker-Nodes deployt, muss diese ebenfalls
> aktualisieren (nach dem Hauptserver). Wiederherstellung gelöschter Originale
> setzt Bucket-Versioning voraus.

### Added
- Super-Admin → Backup: **Notfall-Wiederherstellung gelöschter Originale**.
  Hat ein Kunde Galerien/Bilder versehentlich gelöscht, rekonstruiert der
  neue Worker-Job aus den noncurrent S3-Versionen (Aufbewahrungsfenster, i.d.R.
  30 Tage) die verlorenen Quelldateien und stellt sie pro Galerie als ZIP zum
  Download bereit. Stellt die Galerien NICHT in der App wieder her — liefert
  ausschließlich die Quelldateien.

## [0.41.0] - 2026-06-05

> Pull genügt. Frontend- und API-only Änderung; keine neue ENV, keine
> Migration, keine Worker-Änderung.

### Added
- Super-Admin: neuer Bereich **Backup**. Bündelt das Backup-Monitoring
  (DB + Medien) und einen **Notfall-Export pro Tenant**: Originaldateien
  aller Galerien eines Studios als ZIP (ein Archiv pro Galerie, inkl.
  metadata.json), mit Download-Links direkt im Portal. Use-Case: ein Kunde
  hat versehentlich Inhalte gelöscht und braucht seine Quelldateien.
  Nutzt die bestehende Export-Engine; Download-Links sind 30 Tage gültig.

## [0.40.0] - 2026-06-05

> Pull genügt. Die neuen Backup-Funktionen sind optional und additiv — ohne
> gesetzte ENV bleibt das Verhalten unverändert. Self-Hoster, die das Monitoring
> nutzen wollen: siehe `docs/BACKUP.md` (ENV `BACKUP_STATUS_PATH` und optional
> `BACKUP_MEDIA_STATUS_PATH`).

### Added
- Produktionsreifes Backup-Runbook (`docs/BACKUP.md`) nach 3-2-1: Postgres via
  restic in zwei Repos (z. B. Hetzner Object Storage + Backblaze B2), Bilder/
  Videos per rclone cross-provider, Versioning/Object-Lock, Dead-Man's-Switch
  und Restore-Test. Inklusive fertiger Skripte `scripts/lumio-backup.sh` und
  `scripts/lumio-media-sync.sh` plus Konfig-Vorlage.
- Backup-Monitoring im Super-Admin (System) zeigt jetzt mehrere Backups statt
  nur die Datenbank: DB **und** Medien-Sync mit je eigener Status-Karte. Pro
  Typ passende Alters-Schwellen (DB täglich: gelb > 24 h, rot > 72 h; Medien
  wöchentlich: gelb > 8 Tage, rot > 10 Tage). Aktivierung über
  `BACKUP_MEDIA_STATUS_PATH`; der Media-Sync schreibt dafür eine eigene
  Status-Datei.

## [0.39.2] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Fixed
- **Feedback-Sprechblase überlappte das RAW/HEIC-Format-Badge** in der
  Kundengalerie (beide unten rechts). Die Sprechblase sitzt jetzt unten
  links, das Format-Badge bleibt unten rechts.

## [0.39.1] - 2026-06-04

Pull genügt, ABER: diese Version ändert auch den Worker. Nach dem Deploy
des Hauptservers müssen die Worker-Nodes ebenfalls neu deployt werden
(siehe Worker-Deploy-Befehl). Keine Env-/DB-Änderung.

### Fixed
- **Video-Vorschau im Studio funktioniert wieder** (Auswahl- und
  Medien-Ansicht zeigten „Video-Vorschau nicht verfügbar / Keine Vorschau
  verfügbar"). Ursache: Das Studio spielt Videos über eine eigene
  MP4-Rendition (nicht über den HLS-Stream der Kundengalerie), und diese
  MP4 wurde bei bereits kompakten Quellvideos übersprungen. Jetzt:
  - Bestehende Videos spielen sofort (die API liefert ersatzweise das
    Original aus — greift bereits nach dem Hauptserver-Deploy).
  - Neue Uploads erhalten wieder zuverlässig eine web-optimierte
    MP4-Version (Worker-Änderung — daher Worker-Nodes neu deployen).

## [0.39.0] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend + API), kein Worker.

### Added
- **Feedback-Indikator in der Kundengalerie**: Auf Thumbnails, zu denen
  der Besucher eine Markierung oder einen Kommentar hinterlassen hat,
  erscheint jetzt eine dezente Sprechblase (unten rechts) — als
  Erinnerung, wo bereits etwas notiert wurde. Das Icon erscheint sofort
  nach dem Schließen der Lightbox (ohne Reload) und bleibt nach erneutem
  Laden erhalten. Es zeigt ausschließlich das eigene Feedback des
  Besuchers; Studio-Kommentare bleiben außen vor.

## [0.38.1] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Fixed
- **Marker-Beschriftung im Video überlappte den „Markieren"-Button**: Lag
  eine Markierung am aktuellen Zeitpunkt, lag deren Beschriftung
  (Zeit/Notiz) hinter dem „Markieren"-Button und war unlesbar. Die
  Beschriftung sitzt jetzt darunter.

## [0.38.0] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Changed
- **Einheitliche Markieren-/Auswahl-Bedienung für Fotos und Videos**: Bei
  Fotos wird das Markieren jetzt — wie beim Video — über einen
  „Markieren"-Button **oben** am Bild gestartet (öffnet die
  Zeichen-Werkzeugleiste, „Fertig" beendet sie). Die Auswahl (Farben +
  Stern) liegt als Leiste **unten**. Der bisherige untere
  „Auswahl/Markieren"-Umschalter entfällt; Auswählen und Markieren sind
  jetzt gleichzeitig möglich.

## [0.37.5] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Fixed
- **Play/Pause bei Videos mit Markierungen funktioniert wieder**: Lag eine
  Markierung am aktuellen Zeitpunkt (z.B. direkt nach dem Setzen), fing
  deren Anzeige-Overlay die Klicks ab und der Play-Button reagierte nicht.
  Das Anzeige-Overlay ist jetzt vollständig „durchklickbar"; die
  Video-Bedienelemente darunter sind wieder erreichbar. (Zeichnen ist
  unverändert.)

## [0.37.4] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Fixed
- **Hochformat-Videos werden jetzt korrekt dargestellt**: Bisher wurde das
  Video auf volle Breite gezogen, wodurch ein Hochformat-Video zu groß
  wurde und unten abgeschnitten war — und die Play/Pause-Bedienelemente
  landeten außerhalb des sichtbaren Bereichs (Video ließ sich nicht
  abspielen). Das Video passt sich jetzt an Höhe und Breite an und behält
  sein Seitenverhältnis; Hoch- und Querformat passen vollständig ins Bild
  und die Bedienelemente sind wieder sichtbar. Die Vorschau-Leiste liegt
  passend unter dem Video.

## [0.37.3] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Fixed
- **Video-Upload vom iPhone/iPad aus der Fotomediathek**: Beim Auswählen
  eines Videos im Foto-Picker und Tippen auf das Häkchen passierte nichts —
  das Picker-Fenster blieb offen und es wurde keine Datei übergeben (Fotos
  funktionierten). Ursache war ein iOS/WebKit-Verhalten beim Datei-Dialog
  ohne Typ-Vorgabe; der Studio-Upload gibt jetzt eine Typ-Vorgabe mit, womit
  iOS das Video korrekt übergibt. Drag&Drop und Desktop-Uploads bleiben
  unverändert (auch RAW/HEIC/PDF weiterhin wählbar).

## [0.37.2] - 2026-06-04

Pull genügt — kein manueller Eingriff. **Worker-Änderung:** nach dem
Deploy auf dem Hauptserver auch alle Worker-Nodes neu deployen, sonst
greift die Änderung dort nicht.

### Fixed
- **Video-Scrubbing zeigt jetzt deutlich mehr Einzelbilder**: Bisher gab es
  nur 1 Vorschaubild alle 10 Sekunden (ein 40-Sekunden-Video hatte also nur
  rund 4 Bilder). Jetzt werden so viele Bilder erzeugt wie sinnvoll möglich
  (bis zu 100), höchstens eins alle 0,5 Sekunden — ein 40-Sekunden-Video hat
  damit etwa 80 Vorschaubilder. Gilt für neu hochgeladene/verarbeitete
  Videos; bereits verarbeitete behalten ihr bisheriges Vorschaubild-Set, bis
  sie neu verarbeitet werden.

## [0.37.1] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend).

### Fixed
- **Video im Studio-Medien-Tab abspielbar**: In der großen Ansicht des
  Medien-Tabs ließ sich ein Video bisher nicht abspielen (nur Standbild) —
  jetzt mit Player und Vorschau-Leiste.
- **Vorschau-Leiste beim Video-Scrubbing**: Die Einzelbilder in der Leiste
  wurden teils gar nicht angezeigt (nur ein Fallback). Sie laden jetzt
  zuverlässig.
- **Video-Markierungen nur noch zeitpunktgenau sichtbar**: Eine Markierung
  erscheint jetzt nur an ihrer Sekunde und nicht mehr über das ganze Video.
  Außerdem funktionieren Play/Pause wieder zuverlässig (das Markierungs-
  Overlay blockierte vorher die Bedienelemente).
- **Doppelte Werkzeugleiste in der Kundengalerie entfernt**: Bei Videos
  wurde zusätzlich die Foto-Zeichenleiste eingeblendet und überlappte die
  Scrub-Leiste. Für Videos ist jetzt nur noch die Video-Markierung aktiv.

## [0.37.0] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend), kein API-/Worker-Deploy nötig.

### Added
- **Markierungen auf Videos**: An einer bestimmten Sekunde im Video lässt
  sich jetzt ein Pfeil oder eine Freihand-Markierung aufs Standbild setzen —
  genau wie bei Fotos, plus optionaler Notiz. Auf der Vorschau-Leiste
  erscheinen kleine Marker an den markierten Stellen; ein Klick springt
  dorthin und zeigt die Markierung. Funktioniert für Brautpaare/Kunden in
  der Galerie und fürs Studio im Proofing. (Bestehende Foto-Markierungen
  bleiben unverändert.)

## [0.36.0] - 2026-06-04

Pull genügt — kein manueller Eingriff. Betrifft nur den Hauptserver
(Frontend + API), kein Worker-Deploy nötig.

### Added
- **Video-Wiedergabe im Studio-Proofing**: Videos lassen sich in der
  Datei-Detailansicht jetzt direkt abspielen (vorher war nur das Standbild
  zu sehen). Mit der gleichen Vorschau-Leiste zum Vorspulen wie in der
  Kundengalerie.

### Fixed
- **Video-Scrubbing in der Kundengalerie**: Unter dem Video liegt jetzt eine
  immer sichtbare Vorschau-Leiste mit Einzelbildern statt einer unsichtbaren
  Hover-Zone — es ist sofort erkennbar, wo man zum Spulen hinfahren muss. Die
  Vorschaubilder werden vorgeladen und erscheinen ohne Verzögerung, und die
  Leiste lässt sich per Touch (Tablet) bedienen.

## [0.35.1] - 2026-06-04

Kleine Verbesserung. `git pull` + regulärer Deploy genügt, nur Frontend.

### Changed
- Studio-Banner werden jetzt **sofort beim Zurückkehren auf den Tab** neu
  geladen (zusätzlich zum 5-Minuten-Polling). Ein frisch angelegter Banner
  erscheint damit praktisch sofort, sobald jemand wieder ins Studio schaut —
  ohne Reload.

## [0.35.0] - 2026-06-04

Neues Feature (Super-Admin). `git pull` + regulärer Deploy genügt; additive
Migration läuft automatisch.

### Added
- **Studio-Banner an einzelne User oder Tenants** (Super-Admin → Users, Button
  „Banner" pro User). Erzeugt einen In-Studio-Banner, der wahlweise nur diesem
  User oder seinem ganzen Studio angezeigt wird — mit Titel, Text, Stufe
  (Info/Warnung/Kritisch), Wegklickbarkeit und optionalem Ablauf (7/30 Tage
  oder manuell). Globale Banner gibt es weiterhin über die bestehende
  Announcement-Verwaltung.

### Changed
- Ziel-Banner werden über einen neuen **authentifizierten** Endpoint
  (`/announcements/mine`) ausgeliefert; der öffentliche `/announcements/active`
  liefert nur noch globale Banner (damit zielgerichtete Banner nicht an
  Unbeteiligte ausgespielt werden). Das Studio nutzt automatisch den neuen
  Endpoint.

## [0.34.0] - 2026-06-04

Neues Feature (Super-Admin). `git pull` + regulärer Deploy genügt, keine
Migration.

### Added
- **Direkt-E-Mail an einzelne User** (Super-Admin → Users, Button „E-Mail" pro
  User). Betreff + Markdown-Nachricht, wird als 1:1-Mail gesendet (ohne
  Abmelde-Footer, anders als Broadcasts) und im E-Mail-Log protokolliert.

## [0.33.1] - 2026-06-04

Bugfix. `git pull` + regulärer Deploy genügt, nur Frontend.

### Fixed
- „Sofort löschen (Test)" reagierte auf manchen Geräten nicht (die
  Bestätigung lief über ein Browser-`prompt`, das mobil/in manchen Browsern
  blockiert wird). Läuft jetzt über denselben In-Page-Dialog wie der reguläre
  Hard-Delete (Slug-Eingabefeld) und funktioniert zuverlässig.

## [0.33.0] - 2026-06-04

Neues Feature (Super-Admin). `git pull` + regulärer Deploy genügt, keine
Migration.

### Added
- **Sofort-Löschen für Test-/Trial-Tenants** (Super-Admin → Tenant-Detail,
  „Sofort löschen (Test)"). Überspringt Archivierung + 30-Tage-Karenz, kündigt
  die Stripe-Subscription, **löscht den Stripe-Customer** und macht
  DB-Cascade + S3-Cleanup in einem Schritt. Schutzschranke: nur möglich, wenn
  der Tenant **nicht aktiv zahlend** ist (Subscription-Status nicht
  `active`/`past_due`) — laufende Kunden lassen sich so nicht versehentlich
  löschen, dafür bleibt der reguläre Weg (Archivieren → Karenz → Hard-Delete,
  der die Stripe-Daten behält). Slug-Eingabe zur Bestätigung Pflicht.

## [0.32.1] - 2026-06-04

Bugfix. `git pull` + regulärer Deploy genügt, nur API.

### Fixed
- Nach der Stripe-Zahlung im Self-Service-Signup wird der frisch registrierte
  Owner jetzt auf seine **eigene Tenant-Subdomain** (`{slug}.<domain>`) geleitet
  statt auf einen festen Host. Dort macht `/welcome` das Auto-Login, sodass man
  direkt im richtigen Studio landet. Greift, wenn `LUMIO_DOMAIN_BASE` gesetzt ist
  (Wildcard-SaaS); ohne Wildcard-Domain bleibt es beim bisherigen Verhalten.

## [0.32.0] - 2026-06-04

Neues Feature (Super-Admin), read-only. `git pull` + regulärer Deploy genügt,
keine Migration.

### Added
- **Super-Admin → Compliance.** AVV-/DSGVO-Status pro Tenant: zeigt, ob der
  Auftragsverarbeitungsvertrag (DPA) unterschrieben ist, ob die zugestimmte
  Version veraltet ist (gegen die aktuelle DPA-Version), und den
  Lösch-/Archivierungs-Lifecycle (geplante Löschung, geplante Archivierung,
  bereits archiviert). Mit Übersichtszahlen und Filter „nur auffällige".

## [0.31.0] - 2026-06-04

Neues Feature (Super-Admin), read-only. `git pull` + regulärer Deploy genügt;
additive Migration (ein Index) läuft automatisch.

### Added
- **Super-Admin → Security.** Abuse-Signale aus dem Audit-Log:
  fehlgeschlagene Anmeldungen (inkl. 2FA, WebAuthn, Super-Admin) und
  fehlgeschlagene Galerie-Entsperrungen (Brute-Force-Indikator). Mit 24-h-/
  7-Tage-Zahlen, Top-IPs nach Fehl-Logins und einer Liste der letzten Vorfälle.
  Nutzt vorhandene Audit-Daten, keine zusätzliche Erfassung nötig. Neuer Index
  `events(action, createdAt)` für die Cross-Tenant-Auswertung.

## [0.30.0] - 2026-06-04

Neues Feature (Super-Admin), read-only + Retry. `git pull` + regulärer Deploy
genügt, keine Migration.

### Added
- **Super-Admin → Job-Fehler.** Sammelt fehlgeschlagene und hängende
  Async-Jobs über alle Tenants: Datei-Verarbeitung (Thumbnails, Transcode,
  Auto-Tagging), ZIP-Builds und ausgehende Webhooks. Zählt sie, listet sie mit
  Fehlermeldung und erlaubt gezieltes Neu-Anstoßen von Datei-Jobs und Webhooks
  per Knopfdruck. „Hängend" = seit über 2 Stunden in Verarbeitung. ZIP-Builds
  read-only (Kunde fordert bei Bedarf einfach neu an).

## [0.29.0] - 2026-06-04

Neues Feature (Super-Admin). `git pull` + regulärer Deploy genügt; additive
Migration läuft automatisch.

### Added
- **Super-Admin → E-Mail-Log.** Jeder Mailversand wird protokolliert
  (gesendet / fehlgeschlagen / übersprungen). Die Ansicht zeigt 24-h- und
  7-Tage-Zahlen, die letzten 100 Mails mit Status und Fehlermeldung sowie einen
  Hinweis, falls offenbar kein SMTP konfiguriert ist. Besonders relevant nach
  dem Notification-Ausbau — man sieht jetzt, ob die Mails ankommen. Log wird
  nach 30 Tagen automatisch aufgeräumt.

## [0.28.0] - 2026-06-04

Neues Feature (Super-Admin), read-only. `git pull` + regulärer Deploy genügt,
keine Migration.

### Added
- **Super-Admin → Plan-Katalog.** Stellt die zentrale Plan-Definition im Code
  (Limits & Preise) der DB-Tabelle `billing_plans` gegenüber und markiert
  Abweichungen pro Feld (Name, Speicher, Preise, Watermark). Zeigt außerdem
  Stripe-Preis-IDs (vorhanden/fehlt), `isActive` und Pläne, die nur in der DB
  bzw. nur im Code existieren. Diagnose-Werkzeug — hätte den Storage-Drift
  (1000 statt 3000 GB) sofort sichtbar gemacht.

## [0.27.1] - 2026-06-04

Kleiner UI-Fix. `git pull` + regulärer Deploy genügt, nur Frontend.

### Fixed
- Die Schalter unter Einstellungen → „E-Mail-Benachrichtigungen" waren leicht
  verrutscht; der Knopf sitzt jetzt sauber zentriert.

## [0.27.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt; additive Migration läuft
automatisch.

### Added
- Drei weitere **Studio-Benachrichtigungen** (alle unter Einstellungen →
  „E-Mail-Benachrichtigungen" abschaltbar, standardmäßig an):
  - **Uploads eingegangen**: Ein Kunde hat über einen Upload-Link Dateien
    hochgeladen. Gebündelt — ein Batch vieler Dateien löst nur eine Mail aus
    (Fenster ~15 min pro Link).
  - **Team-Mitglied beigetreten**: Ein eingeladenes Mitglied hat sein Konto
    eingerichtet → Mail an die übrigen Owner/Admins.
  - **Galerie läuft bald ab**: ab 7 Tagen vor dem Ablaufdatum (einmalig; wird
    zurückgesetzt, falls das Ablaufdatum verlängert/entfernt wird).

## [0.26.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt; additive Migration läuft
automatisch.

### Added
- **Super-Admin-Benachrichtigungen.** Bei jedem neuen Self-Service-Signup geht
  eine Mail an alle Super-Admins (Name, Slug, Plan, Owner). Zusätzlich ein
  **täglicher Report** an alle Super-Admins: neue Tenants der letzten 24 h,
  Plattform-Kennzahlen (aktive Tenants, User, Gesamtspeicher), Top-Speicher und
  Tenants nahe am Limit (≥90 %). Läuft über den Sweeper, idempotent (genau
  einmal pro Tag). Beides nur im SaaS-Mode (`BILLING_ENABLED`); ohne Billing
  bleibt alles still.

## [0.25.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt; additive Migration läuft
automatisch.

### Added
- **Studio-E-Mail-Benachrichtigungen steuerbar.** Unter Einstellungen →
  „E-Mail-Benachrichtigungen" kann das Studio pro Event an-/abschalten, was per
  Mail kommt: neuer Kommentar, abgeschlossene Auswahl, neue Print-Bestellung.
- Neue Benachrichtigung **„Speicher fast voll"**: ab 90 % Tarif-Auslastung
  bekommt der Owner eine Mail (mit Throttle, höchstens einmal pro Woche, Reset
  sobald wieder unter Schwelle). Läuft über den periodischen Sweeper.

### Changed
- Die bestehenden Studio-Mails (Kommentar, Auswahl, Print-Bestellung) sind jetzt
  über diese Einstellungen abschaltbar. Kunden-Mails (Galerie-Einladung,
  ZIP-Download-fertig) bleiben unberührt.

## [0.24.0] - 2026-06-04

Neues optionales Feature. `git pull` + regulärer Deploy genügt; ohne Konfiguration
ändert sich nichts.

### Added
- **CAPTCHA (Cloudflare Turnstile) auf dem Self-Service-Signup.** Schützt den
  öffentlichen Signup-Endpoint zusätzlich zum bestehenden Rate-Limit gegen
  Bots. Nur aktiv, wenn `TURNSTILE_SECRET_KEY` (API) gesetzt ist — sonst
  bleibt der Signup wie bisher, Self-Hoster/Single-Mode brauchen nichts. Auf
  der Marketing-Site (`lumio-cloud.de`) muss zusätzlich der passende
  `PUBLIC_TURNSTILE_SITE_KEY` als Build-Arg gesetzt sein, damit das Widget
  erscheint. Verifikation ist fail-closed (kann der Token nicht geprüft
  werden, wird der Signup abgelehnt). Keys gibt es im Cloudflare-Dashboard
  (kostenlos, keine Domain bei Cloudflare nötig).

## [0.23.0] - 2026-06-04

Neues Feature. **Wichtig:** nach dem Deploy Caddy einmal reloaden (siehe unten),
damit der neue CSP-Header aktiv wird.

### Added
- **CSP-Report-Sink + Auswertung.** Die Content-Security-Policy (weiterhin
  Report-Only) meldet Verstöße jetzt an `/api/v1/csp-report`. Aggregiert nach
  Directive + blockierter Quelle in der neuen Tabelle `csp_violations`
  (Upsert + Zähler, beschränkte Menge). Neue Super-Admin-Seite `/super/csp`
  zeigt die Verstöße nach Häufigkeit, mit „Leeren". Datenbasis, um die Policy
  vor dem Scharfschalten (enforced) gegen echten Traffic zu tunen — das
  Enforcen selbst folgt später separat.

## [0.22.3] - 2026-06-04

Kleine Verbesserung. `git pull` + regulärer Deploy genügt.

### Changed
- Super-Admin User-Liste: Das Suchfeld findet User jetzt auch über ihren
  Tenant (Name, Anzeigename, Slug) — praktisch, wenn es viele Tenants gibt und
  das Dropdown lang wird. Der Tenant-Filter bleibt zusätzlich erhalten.

## [0.22.2] - 2026-06-04

Kleine UI-Ergänzung. `git pull` + regulärer Deploy genügt, nur Frontend.

### Added
- Super-Admin User-Liste: zusätzlicher Filter nach Tenant (neben Rolle und
  Status).

## [0.22.1] - 2026-06-04

Kleine UI-Ergänzung. `git pull` + regulärer Deploy genügt, nur Frontend.

### Changed
- Übersicht: Im Signups-Balkendiagramm steht über jedem Balken mit Signups
  jetzt die Anzahl.

## [0.22.0] - 2026-06-04

Neues Feature + Fixes. `git pull` + regulärer Deploy genügt.

### Added
- Super-Admin: neue globale **User-Liste** (`/super/users`) über alle Tenants
  mit Suche (E-Mail/Name) und Filtern (Rolle, Status, Tenant). Jeder User zeigt
  seinen Tenant — gleiche E-Mail in mehreren Tenants ist damit eindeutig.
  Bearbeiten von Name/Rolle/Status (mit Last-Owner-Schutz), Passwort-Reset-Link
  und Anlegen neuer User pro Tenant (Einladung mit Setup-Mail). Kein Hard-Delete
  — zum Sperren „disabled" setzen.

### Fixed
- Update-Check (System): das hinterlegte Forgejo-Lesetoken
  (`LUMIO_UPDATE_REPO_TOKEN`) wurde nicht an den API-Container durchgereicht,
  daher weiterhin „nicht erreichbar (HTTP 404)". Die Update-Check-Variablen
  werden jetzt korrekt durchgereicht. Leeres `LUMIO_UPDATE_REPO_URL`
  überschreibt nicht mehr versehentlich die Standardquelle.
- Übersicht: Der Signups-Trend wurde als einzelnes verzerrtes Quadrat statt als
  Balkendiagramm dargestellt. Jetzt ein sauberes Balkendiagramm über 12 Wochen
  (leere Wochen als Grundlinie sichtbar).

## [0.21.0] - 2026-06-04

Neues Feature + Fixes. `git pull` + regulärer Deploy genügt. Optionaler
Schritt für den Update-Check siehe Hinweis unten.

### Added
- Super-Admin-Übersicht zeigt jetzt kostenlose (comped) Studios: eine eigene
  Kennzahl „Kostenlos (comped)" und pro Plan in der Plan-Verteilung ein
  „davon N kostenlos". So sind Partner-/Goodwill-Konten von zahlenden trennbar.

### Fixed
- Update-Check (Super-Admin → System): zeigte die aktuelle Version als
  „unknown" und fragte eine nicht existierende Quelle ab (HTTP-Fehler). Die
  Version kommt jetzt zuverlässig aus der gestempelten Versionsdatei, und der
  Check fragt standardmäßig das Lumio-Repo auf Forgejo ab.

> **Hinweis (optional):** Da das Forgejo-Repo privat ist, braucht der
> Update-Check ein Lesetoken. In der `.env` setzen:
> `LUMIO_UPDATE_REPO_TOKEN=<read-only-token>` (siehe `.env.example.full`).
> Ohne Token zeigt der Check „nicht erreichbar" — die aktuelle Version wird
> trotzdem korrekt angezeigt. Alternativ eigene Quelle via
> `LUMIO_UPDATE_REPO_URL` oder Abschalten mit `DISABLE_UPDATE_CHECK=1`.

## [0.20.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt, nur Frontend.

### Added
- Studios mit kostenlosem (oder Trial-)Abo können denselben Plan jetzt direkt
  im Studio kostenpflichtig buchen — der aktuelle Plan zeigt dafür einen
  „Jetzt kostenpflichtig buchen"-Button statt nur „Aktueller Plan". Das macht
  das vorherige Entfernen des Gratis-Abos durch den Super-Admin überflüssig,
  wenn der Kunde beim selben Plan bleiben will. Echte (bereits zahlende)
  Stripe-Abos zeigen weiterhin „Aktueller Plan" ohne Button.

## [0.19.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt.

### Added
- Super-Admin: Im Studio-Detail kann ein kostenloses Abo jetzt per Button
  „Abo entfernen" zurückgesetzt werden. Danach hat das Studio kein Abo mehr und
  der Owner kann im Studio ganz normal über Stripe einen Plan buchen — kein
  Eingriff in die Datenbank mehr nötig. Stripe-Abos sind davon ausgenommen
  (die werden weiter über Archivieren bzw. das Stripe-Dashboard gekündigt).

### Fixed
- Bucht ein Studio mit kostenlosem Abo später selbst einen Stripe-Plan, wird
  es jetzt korrekt als zahlend geführt (vorher blieb die interne „Gratis"-
  Markierung bestehen und das Studio fehlte in der Umsatz-Auswertung).

## [0.18.1] - 2026-06-04

Bugfix. `git pull` + regulärer Deploy genügt.

### Fixed
- Manuelle Plan-Zuweisung im Super-Admin ist jetzt immer ein kostenloses Abo.
  Der frühere „Gratis"-Schalter konnte abgewählt werden, ohne dass dadurch ein
  Bezahl-Vorgang ausgelöst wurde — das Studio bekam den Plan trotzdem gratis,
  wurde aber fälschlich als zahlend in der Umsatz-Auswertung (MRR) gezählt. Der
  Schalter ist entfernt; zahlende Kunden buchen weiterhin über den regulären
  Stripe-Ablauf im Studio.

## [0.18.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt, nur Frontend.

### Added
- Super-Admin: Im Studio-Detail gibt es jetzt einen Button „Plan zuweisen /
  ändern". Damit lässt sich einem Studio direkt ein Plan geben — wahlweise als
  kostenloses Abo (für Partner), inkl. optionalem Zusatz-Speicher. Studios ohne
  Abo zeigen den Button ebenfalls, sodass sie freigeschaltet werden können.
  Bei Stripe-Studios ist der manuelle Wechsel ausgeblendet (gehört ins
  Stripe-Dashboard). Kostenlose Abos sind im Detail klar als „Gratis (comped)"
  markiert.

## [0.17.0] - 2026-06-04

Neues Feature. `git pull` + regulärer Deploy genügt; die DB-Migration läuft
beim Start automatisch (`prisma migrate deploy`), kein manueller Eingriff.

### Added
- Super-Admin kann einem Studio jetzt manuell einen Plan zuweisen — auch als
  kostenloses Abo (z.B. für Partner oder Goodwill), ohne Stripe und ohne
  hinterlegte Karte. Solche Abos laufen dauerhaft (kein Trial-Ablauf) und
  werden nicht automatisch wegen fehlender Zahlung archiviert. Beim Anlegen
  eines neuen Studios kann der Plan direkt mitgegeben werden, sodass ein
  Partner ohne den normalen Bezahl-Ablauf sofort startklar ist.
- Optionaler Zusatz-Speicher (GiB) lässt sich beim Zuweisen direkt mitgeben.

### Changed
- Manuell zugewiesene Gratis-Abos werden aus der Umsatz-Auswertung (MRR)
  ausgeschlossen, damit Partner-/Goodwill-Konten den Umsatz nicht verfälschen.
- Schutz: Hat ein Studio bereits ein über Stripe laufendes Abo, lehnt der
  manuelle Plan-Wechsel ab — solche Änderungen gehören weiterhin ins
  Stripe-Dashboard, damit Datenbank und Stripe nicht auseinanderlaufen.

## [0.16.2] - 2026-06-04

Bugfix. `git pull` + regulärer Deploy genügt; die Korrektur greift beim
nächsten API-Start automatisch, keine manuelle Aktion nötig.

### Fixed
- Plan-Limits (z.B. Speicher) wurden in der Super-Admin-Ansicht teils mit
  veralteten Werten angezeigt, weil die Plan-Tabelle in der Datenbank nur
  beim allerersten Start befüllt und danach nie wieder aktualisiert wurde.
  Spätere Änderungen an Limits oder Preisen kamen so nie in der DB an. Die
  Pläne werden jetzt bei jedem Start mit der zentralen Plan-Definition
  abgeglichen. Stripe-Preis-IDs und Sonderkonditionen bleiben dabei
  unangetastet.

## [0.16.1] - 2026-06-04

Bugfix. `git pull` + regulärer Deploy genügt. Nur Frontend.

### Fixed
- Kunden-Galerie: Das „Herunterladen"-Dropdown war halbtransparent und ließ
  die darunterliegenden Tag-Filter-Chips durchscheinen — es wirkte, als läge
  das Menü hinter den Tags. Schwebende Menüs nutzen jetzt einen deckenden
  Hintergrund.

## [0.16.0] - 2026-06-04

Nur SaaS. `git pull` + regulärer Deploy genügt, keine `.env`- oder
Compose-Änderung. **Hinweis:** Der Deploy hebt die AVV-Version an — alle
Studios müssen die Auftragsverarbeitung beim nächsten Login erneut bestätigen.
Vor dem Deploy den §9-Wortlaut mit dem/der Datenschutzbeauftragten abstimmen.

### Changed
- Auftragsverarbeitungsvertrag (AVV) §9 „Löschung und Rückgabe nach
  Beendigung" an den Archiv-Lifecycle (v0.15.0) angepasst: Nach Vertragsende
  Nur-Lese-Modus zum Export, danach inaktives Archiv, endgültige Löschung
  spätestens zwölf Monate nach Vertragsende; Reaktivierung bei erneutem Abo.
  Technisch-organisatorische Maßnahmen (Löschkonzept) entsprechend aktualisiert.
  AVV-Version `1.0` → `1.1` (erneute Zustimmung erforderlich).

## [0.15.0] - 2026-06-04

Neues Feature (nur SaaS / `BILLING_ENABLED`). `git pull` + regulärer Deploy
genügt — die Migration ist additiv, die neuen Umgebungsvariablen sind optional
mit Defaults. Nur API. Self-Hoster ohne Billing sind nicht betroffen.

### Added
- **Archiv-Lifecycle für gekündigte SaaS-Studios.** Statt unbegrenztem
  Read-only nach Abo-Ende durchläuft ein Studio jetzt einen begrenzten
  Lebenszyklus: Read-only (Kunden-Galerien zunächst weiter erreichbar) → nach
  30 Tagen Archiv (Galerien offline, Vorschauen aus dem Speicher entfernt,
  Original-Dateien bleiben) → endgültige Löschung 12 Monate nach Abo-Ende. Die
  Owner werden bei der Archivierung und erneut ~30 Tage vor der Löschung per
  Mail informiert. Schließt der Owner vorher wieder ein Abo ab, wird das Studio
  reaktiviert und die Vorschauen werden automatisch neu erzeugt.
- Zwei neue optionale Umgebungsvariablen: `BILLING_ARCHIVE_AFTER_DAYS`
  (Default `30`) und `BILLING_PURGE_AFTER_MONTHS` (Default `12`).

### Changed
- Öffentliche Kunden-Galerien eines archivierten Studios antworten jetzt mit
  „vorübergehend nicht verfügbar", bis wieder ein aktives Abo besteht.

## [0.14.7] - 2026-06-02

Bugfix-Release. `git pull` + regulärer Deploy genügt. Nur API.

### Fixed
- Stripe-Rücksprung loggte aus: Wer das Kunden-Portal oder den Checkout über
  seine eigene Studio-Adresse (z.B. `name.deine-domain.de`) öffnete und bei
  Stripe auf „Zurück" klickte, landete ausgeloggt mit „authentication
  required". Grund: Stripe leitete fest auf den zentralen Studio-Host zurück,
  nicht auf die Adresse, über die der Nutzer eingeloggt war — dort fehlte das
  Sitzungs-Cookie. Stripe kehrt jetzt immer auf genau den Host zurück, von dem
  der Nutzer kam (Subdomain wie Custom-Domain). Betrifft nur SaaS-/Multi-Mode
  mit aktiviertem Billing; Single-Mode ohne Stripe ist unberührt.

## [0.14.6] - 2026-06-02

Bugfix-Release. `git pull` + regulärer Deploy genügt. Reines Frontend.

### Fixed
- Modals und einige Eingabefelder waren teilweise durchsichtig — der Inhalt
  dahinter schimmerte durch und war schwer lesbar (z.B. das „Mitglied
  bearbeiten"-Dialog im Team-Bereich). Ursache war ein nicht definiertes
  Design-Token (`surface-base`), das an vielen Stellen für den Hintergrund
  genutzt wurde, aber gar keine Farbe erzeugte. Das Token ist jetzt zentral
  definiert; alle betroffenen Flächen sind in hellem wie dunklem Modus wieder
  blickdicht.

## [0.14.5] - 2026-06-02

Bugfix-Release. `git pull` + regulärer Deploy genügt. Reines Frontend.

### Fixed
- Slideshow: Der „Fade"-Effekt animierte gar nicht — das neue Bild erschien
  hart, statt einzublenden. Ursache: Fade nutzte eine CSS-Transition, die
  auf dem bei jedem Bildwechsel neu eingehängten Layer nicht auslöst.
  Umgestellt auf eine echte Keyframe-Animation (wie Slide/Ken Burns), jetzt
  blendet das Bild sauber über. (Erst sichtbar geworden, seit das Aufblitzen
  in 0.14.4 behoben war.)

## [0.14.4] - 2026-06-02

Bugfix-Release. `git pull` + regulärer Deploy genügt. Reines Frontend.

### Fixed
- Slideshow: Beim Bildwechsel blitzte es kurz auf, weil das nächste
  (hochauflösende) Bild erst im Moment des Übergangs zu laden begann — der
  eingestellte Effekt (Fade/Slide/Ken Burns) lief dadurch gegen ein leeres
  Bild. Die kommenden Bilder werden jetzt vorausgeladen und dekodiert, der
  Übergang ist sauber.

## [0.14.3] - 2026-06-02

Bugfix-Release. `git pull` + regulärer Deploy genügt. Reines Frontend.

### Fixed
- Kundengalerie: Die Ansicht sprang beim Scrollen während des Nachladens
  von selbst nach oben. Ursache war eine fehlende „auto"-Größenmerkung der
  Bildkacheln (content-visibility) — die Kacheln kollabierten beim
  Auslagern auf einen festen Schätzwert und verschoben das Layout. Behoben.
- Kundengalerie: In Brave (und teils anderen Chromium-Browsern) blieben
  beim schnellen Scrollen einzelne Thumbnails als „?" hängen, weil der
  Bild-Load abgebrochen wurde. Thumbnails versuchen sich jetzt bis zu 2×
  selbst neu zu laden und zeigen im Fehlerfall einen neutralen Platzhalter
  statt des Broken-Image-Symbols.

## [0.14.2] - 2026-06-02

Tuning-Release. `git pull` + regulärer Deploy genügt. Reines Frontend.

### Changed
- Logo-Größe „groß" weiter angehoben: jetzt 160/256 px (mobil/Desktop).

## [0.14.1] - 2026-06-02

Bugfix-/Tuning-Release. Für Self-Hoster genügt `git pull` + regulärer
Deploy — keine `.env`-, Compose- oder DB-Änderungen nötig. Reines Frontend.

### Changed
- Logo-Anzeigegrößen im Kunden-Hero nach oben korrigiert — „groß" war in
  großen Heros noch zu klein. Neue Höhen: klein 56/80 px, mittel 80/128 px,
  groß 128/224 px (mobil/Desktop).

## [0.14.0] - 2026-06-02

Feature-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy.
Die DB-Migration (neue Spalte mit Default) läuft beim API-Start
automatisch durch — kein manueller Schritt, kein Breaking Change.

### Added
- Galerie-Logo: Im Galerie-Header lässt sich jetzt die Anzeigegröße des
  Logos wählen — klein / mittel / groß (Auswahl direkt neben dem
  Logo-Upload, die Vorschau spiegelt die Größe). Hintergrund: Logos
  werden per Höhe skaliert, daher wirkten Quer- und Hochformate
  unterschiedlich groß; die Einstellung gibt dem Studio jetzt Kontrolle.
  Bestehende Galerien stehen auf „mittel".

## [0.13.0] - 2026-06-02

Feature-/UI-Release. Für Self-Hoster genügt `git pull` + regulärer
Deploy — keine `.env`-, Compose- oder DB-Änderungen nötig. Reines Frontend.

### Changed
- Kundengalerie-Leiste entrümpelt: Die bis zu vier Download-Buttons
  (Alle / Auswahl × Original / Web-Version) sind jetzt in einem
  aufklappbaren „Herunterladen"-Menü gebündelt — die Aktionen selbst sind
  unverändert. Das Sortier-Auswahlfeld sitzt jetzt links bei den Filtern
  (statt zwischen den Aktions-Buttons), weil beides die Ansicht steuert.

## [0.12.2] - 2026-06-02

Bugfix-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig. Reines Frontend.

### Fixed
- Die in 0.12.0 eingeführte Kundengalerie-Sortierung (Name/Aufnahmedatum)
  hat zwar die Slideshow- und Lightbox-Reihenfolge beeinflusst, aber NICHT
  das sichtbare Bilderraster — das Auswahlfeld wirkte dadurch wirkungslos.
  Das Raster (inkl. Section-Ansicht) berücksichtigt die gewählte
  Sortierung jetzt korrekt.

## [0.12.1] - 2026-06-02

Bugfix-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig.

### Fixed
- Der Aufnahmedatum-Backfill (`tasks.backfill_taken_at`) war in 0.12.0
  nicht beim Worker registriert — der Aufruf lief ins Leere (Task-ID
  kam zurück, aber kein Worker führte ihn aus, keine Log-Ausgabe, kein
  `takenAt` geschrieben). Task ist jetzt registriert und läuft. Wer auf
  0.12.0 schon vergeblich gestartet hat: nach dem Update einfach erneut
  aufrufen. (Automatische Extraktion bei NEUEN Uploads war nie betroffen.)

## [0.12.0] - 2026-06-02

Feature-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig. Für korrektes Sortieren
nach Aufnahmedatum bei BESTEHENDEN Dateien ist einmalig ein optionaler
Backfill nötig (siehe unten) — neue Uploads bekommen das Datum automatisch.

### Added
- Kundengalerie: Besucher können die Anzeige jetzt nach Name oder
  Aufnahmedatum sortieren (kleines Auswahlfeld in der Galerie-Leiste).
  Die Sortierung ist rein optisch und temporär — die manuell im Studio
  festgelegte Reihenfolge bleibt der Standard und wird nicht verändert;
  beim Neuladen ist wieder die Galerie-Reihenfolge aktiv. Dateien ohne
  Aufnahmedatum landen beim Datums-Sortieren am Ende.
- Worker liest beim Verarbeiten von Bildern und RAWs nun den
  Aufnahmezeitpunkt aus den EXIF-Daten aus und speichert ihn (`takenAt`).
  Grundlage für die Datums-Sortierung oben.

### ⚠️ Hinweis (kein Breaking Change)
- Bestehende Bilder/RAWs haben noch kein Aufnahmedatum und würden beim
  Sortieren nach Aufnahmedatum ans Ende rutschen. Einmaliger Backfill,
  galerieübergreifend in Batches (Default 500):

  ```
  docker compose exec worker celery -A app call \
      tasks.backfill_taken_at.run_global
  ```

  Mehrfach startbar; verarbeitet bei jedem Aufruf den nächsten Batch.
  Optional — die Galerie funktioniert auch ohne.

## [0.11.1] - 2026-06-02

Bugfix-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig.

### Fixed
- Upload: Eine einzelne zu große Datei (z.B. ein ProRes-Master aus Final
  Cut) hat bisher den kompletten Upload-Batch blockiert — auch die
  gültigen Dateien daneben blieben in „werden vorbereitet…" hängen, ohne
  Rückmeldung. Zu große Dateien werden jetzt schon im Browser erkannt
  und übersprungen, die übrigen laden normal weiter. Statt stillem
  Hänger erscheint ein Hinweis, welche Datei das Pro-File-Limit
  überschreitet (mit Größe und Limit) und der Tipp, Videos als
  H.264/HEVC statt ProRes zu exportieren.

## [0.11.0] - 2026-06-02

Kleines Feature-Release. Für Self-Hoster genügt `git pull` + regulärer
Deploy — keine `.env`-, Compose- oder DB-Änderungen nötig.

### Added
- Galerie-Studio: Video-Dateien tragen im Vorschau-Grid jetzt einen
  dezenten Play-Indikator (kleiner Punkt unten links), damit Videos auf
  einen Blick von Fotos zu unterscheiden sind. Rein optisch, keine
  Funktionsänderung.

## [0.10.3] - 2026-06-02

Bugfix-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig. Wer Videos auf einem
Server ohne GPU verarbeitet, sollte nach dem Update den Worker neu
deployen, damit das Encoding wieder durchläuft.

### Fixed
- Video-Verarbeitung schlug auf Servern ohne GPU dauerhaft fehl
  („Video processing failed"). Die automatische Encoder-Wahl (`auto`,
  Standard) hat NVENC bzw. QSV schon dann gewählt, wenn ffmpeg den
  Encoder im Build hat — das ist bei den Standard-ffmpeg-Paketen IMMER
  der Fall, auch ganz ohne Grafikkarte. ffmpeg ist dann zur Laufzeit am
  fehlenden GPU-Gerät gescheitert. `auto` prüft jetzt zusätzlich, ob ein
  passendes Gerät wirklich vorhanden ist, und fällt sonst sauber auf
  Software-Encoding (libx264) zurück. Gleiches gilt, wenn `nvenc`/`qsv`
  explizit über `LUMIO_HW_ENCODER` gesetzt, das Gerät aber nicht
  durchgereicht ist: statt hartem Fehler nun Fallback auf Software.

## [0.10.2] - 2026-06-02

Bugfix-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig.

### Fixed
- Stripe-Customer-Portal: Nach „Zurück" landete man immer auf
  `/studio/settings` statt dort, wo man das Portal geöffnet hat. Der
  Rückkehr-Pfad richtet sich jetzt nach der Ausgangsseite (z.B. zurück
  auf `/studio/billing`); validiert gegen Open-Redirect, Fallback bleibt
  `/studio/billing`.

## [0.10.1] - 2026-06-02

Bugfix-Release. Für Self-Hoster genügt `git pull` + regulärer Deploy —
keine `.env`-, Compose- oder DB-Änderungen nötig.

### Fixed
- Stripe-Checkout aus dem Studio (`/studio/billing`): Nach erfolgreicher
  Zahlung bzw. bei Abbruch landete man auf einer 404-Seite, weil die
  Weiterleitung auf `/billing/success` bzw. `/billing` zeigte — diese
  Routen existieren nicht. Geht jetzt korrekt zurück auf `/studio/billing`.
  Die Subscription selbst war nie betroffen (wird über den Webhook
  angelegt), nur die Landeseite nach dem Checkout.

## [0.10.0] - 2026-06-01

Abwärtskompatibles Feature-Release. Für Self-Hoster genügt `git pull` +
regulärer Deploy — keine `.env`-, Compose- oder DB-Änderungen nötig.

### Added
- Kunden-Galerie: Einzelbild-Download auf iOS sichert über das native
  Teilen-Sheet direkt in die Foto-App ("In Fotos sichern") statt in die
  "Dateien"-App. Gleiche Download-Buttons, Desktop/Android unverändert.
  Dafür neuer Stream-Endpoint `GET /g/:slug/files/:fileId/blob`.

### Changed
- Doku: `docs/OPERATIONS.md` um den Abschnitt „Secrets & Passwörter
  rotieren" ergänzt.

## [0.9.0] - 2026-06-01

Erste offiziell versionierte Veröffentlichung. Lumio läuft zu diesem Zeitpunkt
bereits produktiv (SaaS auf lumio-cloud.de sowie Self-Hosting in Single- und
Multi-Mode); diese Version macht den Stand offiziell nachvollziehbar.

### Added
- Einheitliche Produkt-Versionierung über alle Komponenten (API, Frontend, Worker).
- Single Source of Truth in `/VERSION`, gehalten durch `scripts/bump-version.sh`.
- Version wird im öffentlichen `/meta`-Endpoint ausgeliefert und im Studio-Footer
  angezeigt (`Lumio vX.Y.Z`).
- `/health` liefert die echte Version statt eines hartkodierten Werts.
- Worker loggt die Version beim Start (`lumio.worker.boot`).

### Notes
- Frühere Stände waren nicht getaggt. `0.9.0` ist der erste Git-Tag (`v0.9.0`).

[Unreleased]: https://forgejo.thiel.tools/thiel/lumio/compare/v0.9.0...HEAD
[0.9.0]: https://forgejo.thiel.tools/thiel/lumio/releases/tag/v0.9.0
