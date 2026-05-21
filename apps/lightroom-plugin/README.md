# Lumio Lightroom Classic Plugin

Bringt die Kunden-Auswahl aus einer Lumio-Galerie direkt in den
Lightroom-Katalog: Picks landen als Pick-Flag, Bewertungen als Sterne,
Color-Labels werden gespiegelt.

## Voraussetzungen

- Lightroom Classic 9.0 oder neuer
- Eine laufende Lumio-Instanz (Self-Host oder Hosted)
- Ein API-Token (siehe „Setup")

## Installation

1. Diesen Ordner — `lumio.lrdevplugin/` — auf die lokale Platte legen
   (z.B. nach `~/Documents/Lightroom Plugins/`).
2. In Lightroom Classic:
   **Datei → Zusatzmodul-Manager… → Hinzufügen**
3. Den Ordner `lumio.lrdevplugin` auswählen → **Plug-in hinzufügen**.
4. Das Plugin erscheint als „Lumio" im Manager. Status sollte
   „Installiert und aktiviert" sein.

**macOS-Hinweis:** Wenn Finder den Ordner als „Bundle" anzeigt und du
ihn nicht öffnen kannst — einfach von `.lrdevplugin` auf `.lrplugin`
umbenennen (oder per Rechtsklick → „Paketinhalt zeigen").

## Setup

1. Im Lumio-Studio einen API-Token erzeugen:
   **Einstellungen → API-Tokens → Token erstellen**, z.B. mit Name
   „Lightroom @ Studio-Mac". Den Token KOPIEREN — er wird nur einmal
   angezeigt.
2. Im Zusatzmodul-Manager das Lumio-Plugin auswählen, im rechten
   Bereich „Lumio Verbindung":
   - **Server**: deine Lumio-URL inklusive `https://`, z.B.
     `https://studio.lumio-cloud.de`
   - **API-Token**: den eben erzeugten Token einfügen
3. **Verbindung testen** klicken. Erwartete Ausgabe:
   `✓ Verbunden (API v1)`.

Falls die Verbindung fehlschlägt, prüfe:
- Erreichbarkeit des Servers (im Browser einloggen)
- Token wurde nicht widerrufen
- Plugin-Logs unter `~/Documents/LrClassicLogs/Lumio.log` (macOS) bzw.
  `%USERPROFILE%\Documents\LrClassicLogs\Lumio.log` (Windows)

## Benutzung

1. In Lightroom: **Bibliothek → Zusatzmoduloptionen → Lumio-Auswahl
   importieren…**
2. Galerie aus der Liste wählen.
3. Optionen anhaken:
   - **Picks als Lightroom-Flag setzen**: ein Kunden-Pick wird ein
     Pick-Flag im Katalog.
   - **Likes als 1-Stern-Bewertung**: Like ohne explizites Rating wird
     1 Stern. Bestehende höhere Bewertungen bleiben.
   - **Bewertungen übernehmen**: 1–5 Sterne werden direkt gespiegelt.
   - **Color-Labels übernehmen**: red/yellow/green werden zu
     Lightrooms Red/Yellow/Green.
4. **Suche nach Dateinamen**: entweder im gesamten Katalog oder nur in
   der aktiven Sammlung. Letzteres ist schneller bei großen Katalogen.
5. **OK** → das Plugin matched die Files anhand des Original-Dateinamens
   (case-insensitive) und schreibt die Metadaten in einer einzigen
   Transaktion, sodass du den Import mit Cmd/Strg-Z komplett rückgängig
   machen kannst.

Am Ende erscheint eine Zusammenfassung mit der Anzahl gematchter Files
und einer Liste der nicht gefundenen Filenames (die ersten 20).

## Aggregations-Logik

Wenn mehrere Kunden in der Galerie verschiedene Auswahlen treffen,
werden die Werte serverseitig zusammengefasst:

| Lumio-Server | Lightroom |
|---|---|
| **picked**: irgendein Kunde hat `pick` gewählt | Pick-Flag |
| **liked**: irgendein Kunde hat ein Herz vergeben | Mindestens 1 Stern |
| **color**: häufigste Farbe über alle Kunden | Color-Label |
| **rating**: maximale Sterne über alle Kunden | Sterne-Rating |

## Bekannte Einschränkungen

- **Filename-Matching**: Wenn du Files in Lightroom umbenannt hast,
  finden wir sie nicht. SHA-256-basiertes Matching ist als zukünftige
  Verbesserung geplant.
- **Doppelte Filenames**: Wenn dein Katalog mehrere Photos mit demselben
  Dateinamen enthält (z.B. zwei Kameras), werden alle aktualisiert.
- **Reject-Flag**: Lumio kennt aktuell nur „pick" und „none", kein
  „reject". Daher wird beim Import kein bestehender Reject-Flag
  überschrieben.
- **Smart-Previews / RAW+JPEG-Stacks**: Wir matchen auf Dateinamens-
  Ebene, der primäre Catalog-Eintrag bekommt die Metadaten.

## Plugin-Ordnerstruktur

```
lumio.lrdevplugin/
├── Info.lua                       Manifest
├── PluginManager.lua              UI im Zusatzmodul-Manager (Host+Token)
├── ImportSelectionDialog.lua      Galerie- + Optionen-Dialog
├── ImportSelectionTask.lua        Eigentliche Import-Logik
├── LumioApi.lua                   HTTP-Wrapper mit Bearer-Auth
├── Json.lua                       JSON-Lib (MIT, rxi/json.lua)
└── Logger.lua                     LrLogger-Wrapper
```

## Lizenz

AGPL-3.0, wie der Rest von Lumio.
