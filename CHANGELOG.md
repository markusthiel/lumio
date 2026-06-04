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
