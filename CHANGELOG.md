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
