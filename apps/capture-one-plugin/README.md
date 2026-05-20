# Lumio Capture One Plugin

Spiegelt die Kunden-Auswahl einer Lumio-Galerie in den aktuell
geöffneten Capture-One-Katalog oder die aktuelle Session. Color-Tags,
Sterne-Bewertungen und Picks landen direkt auf den Variants.

## Voraussetzungen

- **macOS** — Capture One unterstützt Skripte nur unter macOS. Für
  Windows gibt es keinen offiziellen Skripting-Pfad.
- **Capture One Pro 14** oder neuer. Frühere Versionen haben kleinere
  AppleScript-Bibliotheken und sind nicht getestet.
- **Python 3** (in macOS 12.3 und neuer standardmäßig unter
  `/usr/bin/python3` installiert). Falls nicht vorhanden: über
  Homebrew `brew install python3` oder das offizielle Python-Installer-
  Paket.
- Eine erreichbare Lumio-Instanz und ein API-Token (siehe „Setup").

## Installation

1. Den `apps/capture-one-plugin/`-Ordner aus dem Lumio-Repo
   herunterladen (oder Repo klonen). Inhalt:
   - `lumio-c1-sync.py` — der Python-Helfer, der mit Lumio spricht
   - `Lumio - Pull Selection.applescript` — das AppleScript, das im
     C1 erscheint
   - dieses README

2. Die `.applescript`-Datei einmal mit dem **Skripteditor**
   (`/System/Applications/Utilities/Script Editor.app`) öffnen,
   prüfen dass sie kompiliert (Menü „Skript → Kompilieren") und als
   **kompiliertes Script** speichern (`.scpt`).

3. Den Inhalt — `.scpt`-Datei + `lumio-c1-sync.py` — in den
   Capture-One-Scripts-Ordner kopieren:

   ```
   ~/Library/Scripts/Capture One Scripts/
   ```

   Wenn der Ordner nicht existiert, anlegen. Beide Dateien müssen
   nebeneinander liegen — das AppleScript erwartet den Python-Helfer
   im selben Verzeichnis wie sich selbst.

4. Sicherstellen, dass der Python-Helfer ausführbar ist:

   ```bash
   chmod +x ~/Library/Scripts/Capture\ One\ Scripts/lumio-c1-sync.py
   ```

5. Capture One starten (oder neu starten). Das Script erscheint unter
   **Scripts → Lumio - Pull Selection** in der Menüleiste.

## Setup

1. Im Lumio-Studio einen API-Token erzeugen: **Einstellungen →
   API-Tokens → Token erstellen**, z.B. mit Name
   „Capture One @ Studio-Mac". Den Token KOPIEREN — er wird nur
   einmal angezeigt.

2. Eine Datei `~/.lumio-c1.json` mit folgendem Inhalt anlegen:

   ```json
   {
     "host": "https://lumio-cloud.de",
     "token": "lum_xxxxxxxxxxxxxxxxxxxxxx"
   }
   ```

   `host` ist deine Lumio-URL ohne abschließenden Slash. Wenn du
   Self-Hosting auf einem anderen Domain machst, hier eintragen.

3. Verbindung testen:

   ```bash
   ~/Library/Scripts/Capture\ One\ Scripts/lumio-c1-sync.py test
   ```

   Erwartete Ausgabe: `{"ok": true, "apiVersion": "1"}`.

   Bei `Lumio: API-Token ungültig oder abgelaufen`: im Studio einen
   neuen Token anlegen und die `host`/`token`-Werte in der
   `.lumio-c1.json` aktualisieren.

## Benutzung

1. In Capture One den Katalog oder die Session öffnen, die die
   Original-RAW-/JPEG-Dateien enthält.

2. **Scripts → Lumio - Pull Selection** auswählen.

3. Aus der Galerie-Liste die zu synchronisierende Galerie wählen.

4. Das Script holt alle Files der Galerie, matcht sie per Dateiname
   gegen den aktuell aktiven Katalog/Session und wendet folgendes an:

   | Lumio | Capture One |
   |---|---|
   | Color "red" | Color-Tag 1 (Rot) |
   | Color "yellow" | Color-Tag 3 (Gelb) |
   | Color "green" | Color-Tag 4 (Grün) |
   | Rating 1–5 | Rating 1–5 |
   | Pick (ohne Color-Tag) | Color-Tag 5 (Blau) |
   | Liked | Rating mindestens 1 (sanfter Marker) |

5. Am Ende erscheint ein Dialog mit der Anzahl gematchter Files. Wenn
   Files in Lumio existieren, aber nicht im Katalog, listet der Dialog
   die ersten als Beispiel.

## Match-Logik

Wie das Lightroom-Plugin matcht das Capture-One-Plugin **per
Dateinamen** (lowercase, ohne Pfad). Wenn derselbe Dateiname mehrfach
im Katalog existiert (z.B. duplizierte Variants oder mehrere Imports),
wird die Auswahl **auf alle gleichnamigen Variants** angewendet.

**Was das bedeutet:**

- Wenn du in Lumio mehrere RAW-Variants desselben Shots hochgeladen
  hast und der Kunde nur eine markiert hat, kann das Plugin das nicht
  unterscheiden — die Markierung landet auf allen.
- Bei umbenannten Files (z.B. C1-Side-Car Edit-Variants mit suffix)
  matcht das Plugin nichts. Das ist Absicht: wir wollen nicht raten.

## Bekannte Einschränkungen

- **Windows wird nicht unterstützt.** Capture One stellt nur unter
  macOS eine AppleScript-Bibliothek bereit. Für Workflows auf Windows
  ist aktuell nur das Lightroom-Classic-Plugin verfügbar.
- **Pick → Color-Tag-5-Mapping** ist eine Konvention, kein echtes
  C1-Konzept. C1 hat im Gegensatz zu Lightroom kein dediziertes
  Pick-/Reject-Flag. Studios, die Color-Tag 5 (Blau) für etwas anderes
  verwenden, sollten sich der Kollision bewusst sein.
- **Keine bidirektionale Synchronisation.** Das Plugin schreibt nur
  Lumio → C1. Änderungen im C1 (z.B. nachträgliches Picks-Bewerten)
  finden ihren Weg nicht zurück zur Galerie.
- **Großer Katalog = langsamer Scan.** Der Datei-Index ist linear
  über alle Variants. Bei einem Katalog mit 50k+ Files dauert der
  erste Scan einige Sekunden. Wir scannen nur einmal pro Aufruf,
  nicht pro Datei.

## Fehlerbehandlung

| Meldung | Ursache | Lösung |
|---|---|---|
| „Konfigurationsdatei fehlt: ~/.lumio-c1.json" | Setup-Schritt 2 übersprungen | Datei anlegen wie oben beschrieben |
| „Lumio: API-Token ungültig oder abgelaufen" | Token im Studio widerrufen oder abgelaufen | Neuen Token erzeugen, in `.lumio-c1.json` eintragen |
| „Lumio: Verbindung fehlgeschlagen" | Host nicht erreichbar (DNS/Firewall) | `host`-Wert prüfen, mit `curl` testen |
| „Bitte zuerst einen Capture-One-Katalog oder eine Session öffnen" | Kein aktives Dokument in C1 | Katalog/Session öffnen, Script erneut starten |
| „N Files nicht im Katalog gefunden" | Filenames im Katalog passen nicht zu Lumio | Filenames vergleichen — meist sind Umbenennungen oder reine Edit-Variants betroffen |

## Updates

Wenn ein neues Repo-Update das Plugin verändert:

1. Neue Versionen der drei Dateien (`.scpt`, `.py`, README) aus
   `apps/capture-one-plugin/` im Repo holen.
2. In `~/Library/Scripts/Capture One Scripts/` ersetzen.
3. Capture One einmal neu starten.

Die Datei `~/.lumio-c1.json` bleibt bestehen — die wird nie vom Update
angefasst.
