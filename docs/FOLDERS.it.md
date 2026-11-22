[English](FOLDERS.md) · [Deutsch](FOLDERS.de.md) · **Italiano**

# Cartelle

Le cartelle mettono un albero sopra le tue gallerie, ad esempio *cliente › paese › città*. Servono solo allo studio: i clienti non le vedono mai e i link delle gallerie restano gli stessi.

## Come funzionano le cartelle

- Le cartelle appartengono allo studio. Tutto il team vede lo stesso albero.
- Una galleria sta in al massimo una cartella. Le gallerie senza cartella restano al livello principale.
- Le cartelle si possono annidare fino a 20 livelli.
- **Tutte le gallerie** elenca ancora ogni galleria, in modo piatto, con il percorso della cartella sotto il titolo. **Senza cartella** mostra le gallerie non ancora archiviate.
- La ricerca copre sempre tutte le cartelle.
- Eliminare una cartella non elimina nessuna galleria: sottocartelle e gallerie salgono di un livello.
- I membri del team con accesso solo ad alcune gallerie non vedono le cartelle le cui gallerie appartengono tutte ad altri. Le cartelle vuote sono visibili a tutti.
- Owner e admin possono eliminare qualsiasi cartella. Gli altri membri solo se hanno accesso a ogni galleria al suo interno.

## Nello studio

- **Creare una cartella:** *Nuova cartella* sopra l'elenco delle gallerie, oppure *+ Nuova cartella* in fondo all'albero nella navigazione. Dentro una cartella il pulsante crea una sottocartella.
- **Archiviare una galleria:** trascinala su una cartella nella navigazione o su una scheda di sottocartella, oppure usa *Sposta in cartella …* nel menu della galleria.
- **Rinominare, spostare o eliminare una cartella:** aprila e usa *Modifica cartella*.
- **Nuova galleria in una cartella:** apri la cartella e clicca *Nuova galleria qui*.

L'albero compare nella navigazione sotto *Gallerie* non appena esiste almeno una cartella. La freccia accanto a *Gallerie* lo comprime. Gli studi senza cartelle restano esattamente come prima.

## API

Ogni endpoint dello studio accetta anche un token API. Crealo in **Impostazioni › Token API**; ha gli stessi diritti del tuo account studio. Tutti i percorsi sono relativi a `https://<il-tuo-dominio-studio>/api/v1`.

| Metodo | Percorso | Body | Scopo |
|---|---|---|---|
| `GET` | `/folders` | – | Tutte le cartelle come elenco piatto (`id`, `parentId`, `name`, `galleryCount`, `totalGalleryCount`) |
| `POST` | `/folders` | `{ "name", "parentId"? }` | Crea una cartella. `parentId` omesso o `null` = livello principale |
| `PATCH` | `/folders/:id` | `{ "name"?, "parentId"? }` | Rinomina e/o sposta una cartella |
| `DELETE` | `/folders/:id` | – | Elimina una cartella; il contenuto sale di un livello |
| `PUT` | `/folders/assign` | `{ "folderId", "galleryIds": [] }` | Mette fino a 1000 gallerie in una cartella (`folderId: null` = nessuna cartella) |
| `GET` | `/galleries?folder=<id>` | – | Gallerie direttamente in una cartella (`folder=none`: senza cartella) |

Se sotto lo stesso genitore esiste già una cartella con lo stesso nome (senza distinzione tra maiuscole e minuscole), la risposta è `409` con `error: "folder_name_taken"` e il `folderId` della cartella esistente. Così gli script si possono eseguire più volte senza rischi. Altri errori: `folder_not_found` (404), `folder_cycle` (spostare una cartella in sé stessa o sotto di sé), `folder_too_deep`, `folder_delete_forbidden` (403).

Anche `POST /galleries` e `PATCH /galleries/:id` accettano `folderId`.

### Esempio: costruire *cliente › paese › città* e archiviare una galleria

```bash
BASE=https://studio.example.com/api/v1
AUTH="Authorization: Bearer $LUMIO_TOKEN"

# Crea una cartella o riusa quella esistente con lo stesso nome.
folder() {  # folder <nome> [parentId]
  local parent=${2:+\"$2\"}
  local res=$(curl -s -X POST "$BASE/folders" -H "$AUTH" \
    -H 'Content-Type: application/json' \
    -d "{\"name\":\"$1\",\"parentId\":${parent:-null}}")
  echo "$res" | jq -r '.folder.id // .folderId'
}

cliente=$(folder "Meyer Travel")
paese=$(folder "Francia" "$cliente")
citta=$(folder "Parigi" "$paese")

# Archivia le gallerie nella cartella della città.
curl -s -X PUT "$BASE/folders/assign" -H "$AUTH" \
  -H 'Content-Type: application/json' \
  -d "{\"folderId\":\"$citta\",\"galleryIds\":[\"<id-galleria>\"]}"
```

Gli ID delle gallerie arrivano da `GET /galleries` (campo `id`).
