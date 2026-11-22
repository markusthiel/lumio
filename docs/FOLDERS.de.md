[English](FOLDERS.md) · **Deutsch** · [Italiano](FOLDERS.it.md)

# Ordner

Ordner legen einen Baum über deine Galerien, zum Beispiel *Kunde › Land › Stadt*. Sie sind rein für das Studio da: Kunden sehen sie nie, und Galerie-Links bleiben gleich.

## So funktionieren Ordner

- Ordner gehören zum Studio. Alle im Team sehen denselben Baum.
- Eine Galerie liegt in höchstens einem Ordner. Galerien ohne Ordner bleiben auf oberster Ebene.
- Ordner lassen sich bis zu 20 Ebenen tief verschachteln.
- **Alle Galerien** zeigt weiterhin jede Galerie flach, mit dem Ordnerpfad unter dem Titel. **Ohne Ordner** zeigt die Galerien, die noch nicht einsortiert sind.
- Die Suche läuft immer über alle Ordner.
- Beim Löschen eines Ordners wird keine Galerie gelöscht: Unterordner und Galerien rutschen eine Ebene höher.
- Teammitglieder mit Zugriff nur auf einen Teil der Galerien sehen keine Ordner, deren Galerien ausnahmslos anderen gehören. Leere Ordner sehen alle.
- Owner und Admins können jeden Ordner löschen. Andere Teammitglieder nur, wenn sie auf jede Galerie darin Zugriff haben.

## Im Studio

- **Ordner anlegen:** *Neuer Ordner* über der Galerieliste oder *+ Neuer Ordner* unten im Baum in der Navigation. In einem Ordner legt der Button einen Unterordner an.
- **Galerie einsortieren:** auf einen Ordner in der Navigation oder auf eine Unterordner-Karte ziehen, oder *In Ordner verschieben …* im Menü der Galerie.
- **Ordner umbenennen, verschieben oder löschen:** Ordner öffnen, dann *Ordner bearbeiten*.
- **Neue Galerie in einem Ordner:** Ordner öffnen und *Neue Galerie hier* klicken.

Der Baum erscheint in der Navigation unter *Galerien*, sobald es mindestens einen Ordner gibt. Der Pfeil neben *Galerien* klappt ihn ein. Studios ohne Ordner sehen aus wie bisher.

## API

Jeder Studio-Endpunkt akzeptiert auch ein API-Token. Du legst es unter **Einstellungen › API-Tokens** an; es hat dieselben Rechte wie dein Studio-Konto. Alle Pfade sind relativ zu `https://<deine-studio-domain>/api/v1`.

| Methode | Pfad | Body | Zweck |
|---|---|---|---|
| `GET` | `/folders` | – | Alle Ordner als flache Liste (`id`, `parentId`, `name`, `galleryCount`, `totalGalleryCount`) |
| `POST` | `/folders` | `{ "name", "parentId"? }` | Ordner anlegen. `parentId` weglassen oder `null` = oberste Ebene |
| `PATCH` | `/folders/:id` | `{ "name"?, "parentId"? }` | Ordner umbenennen und/oder verschieben |
| `DELETE` | `/folders/:id` | – | Ordner löschen; der Inhalt rutscht eine Ebene höher |
| `PUT` | `/folders/assign` | `{ "folderId", "galleryIds": [] }` | Bis zu 1000 Galerien in einen Ordner legen (`folderId: null` = ohne Ordner) |
| `GET` | `/galleries?folder=<id>` | – | Galerien direkt in einem Ordner (`folder=none`: ohne Ordner) |

Gibt es unter demselben Elternordner schon einen Ordner mit gleichem Namen (Groß/Klein egal), kommt `409` mit `error: "folder_name_taken"` und der `folderId` des vorhandenen Ordners zurück. So können Skripte gefahrlos mehrfach laufen. Weitere Fehler: `folder_not_found` (404), `folder_cycle` (Ordner in sich selbst oder darunter verschieben), `folder_too_deep`, `folder_delete_forbidden` (403).

`POST /galleries` und `PATCH /galleries/:id` nehmen ebenfalls `folderId` an.

### Beispiel: *Kunde › Land › Stadt* aufbauen und eine Galerie einsortieren

```bash
BASE=https://studio.example.com/api/v1
AUTH="Authorization: Bearer $LUMIO_TOKEN"

# Ordner anlegen oder den vorhandenen gleichen Namens wiederverwenden.
folder() {  # folder <name> [parentId]
  local parent=${2:+\"$2\"}
  local res=$(curl -s -X POST "$BASE/folders" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"$1\",\"parentId\":${parent:-null}}")
  echo "$res" | jq -r '.folder.id // .folderId'
}

kunde=$(folder "Meyer Reisen")
land=$(folder "Frankreich" "$kunde")
stadt=$(folder "Paris" "$land")

# Galerien in den Stadt-Ordner legen.
curl -s -X PUT "$BASE/folders/assign" -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d "{\"folderId\":\"$stadt\",\"galleryIds\":[\"<galerie-id>\"]}"
```

Galerie-IDs liefert `GET /galleries` (Feld `id`).
