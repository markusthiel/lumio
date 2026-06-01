# Lumio Lightroom Classic Plugin

Bidirektionale Brücke zwischen Lightroom Classic und Lumio:

1. **Selection-Import** (Lumio → LR): Kunden-Auswahl aus einer Galerie
   landet als Pick-Flag, Sterne und Color-Label im Lightroom-Katalog.
2. **Publish-Service** (LR → Lumio): Bilder aus LR direkt in eine
   Lumio-Galerie hochladen. Pro Lumio-Galerie eine Veröffentlichte
   Sammlung. Drag-and-Drop oder Smart-Collection-Regeln bestimmen den
   Inhalt.

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

## Benutzung: Selection-Import (Kunden-Picks nach LR)

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

## Benutzung: Publish-Service (LR-Bilder zu Lumio)

1. In Lightroom links unter „Veröffentlichungsdienste" erscheint
   **Lumio**. Klick auf **Einrichten** → Service speichern.
2. **Veröffentlichte Sammlung erstellen** unter dem Lumio-Service.
3. Im Dialog:
   - **Vorhandene Galerie** aus der Liste wählen, ODER
   - **Neue anlegen** mit Titel + Modus (Auswahl/Proofing oder
     Präsentation).
   - **Nach Upload automatisch auf 'live' schalten**: wenn an, wird
     die Galerie nach dem ersten erfolgreichen Upload sofort live —
     Kunden können die URL aufrufen.
4. **Speichern** → die Sammlung erscheint unter Lumio.
5. Bilder per Drag-and-Drop oder Smart-Collection in die Sammlung
   ziehen → unter der Sammlung sammeln sich die Bilder als „Bereit
   zu veröffentlichen".
6. **Veröffentlichen** klicken → Lightroom rendert die Bilder als
   JPEG (sRGB), lädt sie zu Lumio hoch. Pro Upload werden im Hintergrund
   Vorschau-, Thumbnail- und ggf. Watermark-Varianten erzeugt.
7. **In Lumio anzeigen** (Rechtsklick auf Sammlung) öffnet die
   Galerie im Browser.

### Re-Publish

Wenn du in LR ein Bild bearbeitest, kannst du es manuell auf
„Erneut veröffentlichen" setzen (Rechtsklick → „Erneut veröffentlichen").
Beim nächsten Upload-Lauf wird das alte File in Lumio gelöscht und das
neue hochgeladen.

### Bilder entfernen

Photo aus der Sammlung entfernen oder Sammlung löschen → Lumio
löscht die entsprechenden Files automatisch.

## Aggregations-Logik (Selection-Import)

Wenn mehrere Kunden in der Galerie verschiedene Auswahlen treffen,
werden die Werte serverseitig zusammengefasst:

| Lumio-Server | Lightroom |
|---|---|
| **picked**: irgendein Kunde hat `pick` gewählt | Pick-Flag |
| **liked**: irgendein Kunde hat ein Herz vergeben | Mindestens 1 Stern |
| **color**: häufigste Farbe über alle Kunden | Color-Label |
| **rating**: maximale Sterne über alle Kunden | Sterne-Rating |

## Bekannte Einschränkungen

- **Filename-Matching (Selection-Import)**: Wenn du Files in Lightroom
  umbenannt hast, finden wir sie nicht. SHA-256-basiertes Matching ist
  als zukünftige Verbesserung geplant.
- **Doppelte Filenames**: Wenn dein Katalog mehrere Photos mit demselben
  Dateinamen enthält (z.B. zwei Kameras), werden alle aktualisiert.
- **Reject-Flag**: Lumio kennt aktuell nur „pick" und „none", kein
  „reject". Daher wird beim Import kein bestehender Reject-Flag
  überschrieben.
- **Publish: nur JPEG, sRGB**: Wir rendern auf JPEG sRGB und laden
  nur das hoch. Originale (RAW) bleiben lokal.
- **Publish: nur single-part Upload**: Files > 100 MB werden aktuell
  abgelehnt. Bei JPEG-Renders kein Problem; bei TIFF-Exporten ggf.
  manuell die Quality reduzieren.
- **Smart-Previews / RAW+JPEG-Stacks**: Wir matchen auf Dateinamens-
  Ebene, der primäre Catalog-Eintrag bekommt die Metadaten.

## Plugin-Ordnerstruktur

```
lumio.lrdevplugin/
├── Info.lua                       Manifest (Selection + Publish)
├── PluginManager.lua              UI im Zusatzmodul-Manager (Host+Token)
├── ImportSelectionDialog.lua      Galerie- + Optionen-Dialog (Import)
├── ImportSelectionTask.lua        Eigentliche Import-Logik
├── LumioPublishService.lua        Publish-Service-Provider (Upload)
├── LumioApi.lua                   HTTP-Wrapper mit Bearer-Auth
├── Json.lua                       JSON-Lib (MIT, rxi/json.lua)
└── Logger.lua                     LrLogger-Wrapper
```

## Logs

Plugin-Logs liegen unter:
- macOS: `~/Documents/LrClassicLogs/Lumio.log`
- Windows: `%USERPROFILE%\Documents\LrClassicLogs\Lumio.log`

## Lizenz

FSL-1.1-ALv2 (Functional Source License), wie der Rest von Lumio.
