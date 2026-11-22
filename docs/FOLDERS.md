**English** · [Deutsch](FOLDERS.de.md) · [Italiano](FOLDERS.it.md)

# Folders

Folders put a tree on top of your galleries, for example *customer › country › city*. They are purely for the studio: customers never see them, and gallery links stay the same.

## How folders work

- Folders belong to the studio. Everyone on the team sees the same tree.
- A gallery lives in at most one folder. Galleries without a folder stay at the top level.
- Folders can be nested up to 20 levels deep.
- **All galleries** still lists every gallery, flat, with its folder path under the title. **No folder** shows the galleries that aren't filed yet.
- Search always covers all folders.
- Deleting a folder deletes no galleries: its subfolders and galleries move up one level.
- Team members who only have access to some galleries don't see folders whose galleries all belong to others. Empty folders are visible to everyone.
- Owners and admins can delete any folder. Other team members can delete a folder only if they have access to every gallery in it.

## In the studio

- **Create a folder:** *New folder* above the gallery list, or *+ New folder* at the bottom of the tree in the navigation. Inside a folder, the button creates a subfolder.
- **File a gallery:** drag it onto a folder in the navigation or onto a subfolder card, or use *Move to folder …* in the gallery's menu.
- **Rename, move or delete a folder:** open it and use *Edit folder*.
- **New gallery in a folder:** open the folder and click *New gallery here*.

The tree appears in the navigation under *Galleries* as soon as there is at least one folder. The arrow next to *Galleries* collapses it. Studios without folders look exactly as before.

## API

Every studio endpoint also accepts an API token. Create one under **Settings › API tokens**; it has the same rights as your studio account. All paths are relative to `https://<your-studio-domain>/api/v1`.

| Method | Path | Body | Purpose |
|---|---|---|---|
| `GET` | `/folders` | – | All folders as a flat list (`id`, `parentId`, `name`, `galleryCount`, `totalGalleryCount`) |
| `POST` | `/folders` | `{ "name", "parentId"? }` | Create a folder. `parentId` omitted or `null` = top level |
| `PATCH` | `/folders/:id` | `{ "name"?, "parentId"? }` | Rename and/or move a folder |
| `DELETE` | `/folders/:id` | – | Delete a folder; its contents move up one level |
| `PUT` | `/folders/assign` | `{ "folderId", "galleryIds": [] }` | Put up to 1000 galleries into a folder (`folderId: null` = no folder) |
| `GET` | `/galleries?folder=<id>` | – | Galleries directly in a folder (`folder=none`: without a folder) |

Creating a folder whose name already exists under the same parent (case-insensitive) returns `409` with `error: "folder_name_taken"` and the existing folder's `folderId`. That makes scripts safe to run more than once. Other errors: `folder_not_found` (404), `folder_cycle` (moving a folder into itself or below itself), `folder_too_deep`, `folder_delete_forbidden` (403).

`POST /galleries` and `PATCH /galleries/:id` also accept `folderId`.

### Example: build *customer › country › city* and file a gallery

```bash
BASE=https://studio.example.com/api/v1
AUTH="Authorization: Bearer $LUMIO_TOKEN"

# Create a folder, or reuse the existing one with the same name.
folder() {  # folder <name> [parentId]
  local parent=${2:+\"$2\"}
  local res=$(curl -s -X POST "$BASE/folders" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"$1\",\"parentId\":${parent:-null}}")
  echo "$res" | jq -r '.folder.id // .folderId'
}

customer=$(folder "Meyer Travel")
country=$(folder "France" "$customer")
city=$(folder "Paris" "$country")

# File galleries into the city folder.
curl -s -X PUT "$BASE/folders/assign" -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d "{\"folderId\":\"$city\",\"galleryIds\":[\"<gallery-id>\"]}"
```

Gallery IDs come from `GET /galleries` (field `id`).
