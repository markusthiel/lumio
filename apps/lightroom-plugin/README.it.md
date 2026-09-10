[Deutsch](README.md) · **Italiano**

# Lumio Lightroom Classic Plugin

Ponte bidirezionale tra Lightroom Classic e Lumio:

1. **Import selezione** (Lumio → LR): la selezione del cliente di
   una galleria arriva nel catalogo Lightroom come flag Pick, stelle
   e Color Label.
2. **Servizio di pubblicazione** (LR → Lumio): carica le immagini da
   LR direttamente in una galleria Lumio. Una raccolta pubblicata
   per ogni galleria Lumio. Il contenuto è determinato da
   drag-and-drop o da regole della smart collection.

## Prerequisiti

- Lightroom Classic 9.0 o successivo
- Un'istanza Lumio attiva (self-hosted o hosted)
- Un token API (vedi "Setup")

## Installazione

1. Copia questa cartella — `lumio.lrdevplugin/` — sul disco locale
   (es. in `~/Documents/Lightroom Plugins/`).
2. In Lightroom Classic:
   **File → Gestione plug-in… → Aggiungi**
3. Seleziona la cartella `lumio.lrdevplugin` → **Aggiungi plug-in**.
4. Il plugin appare come "Lumio" nel gestore. Lo stato dovrebbe
   essere "Installato e attivato".

**Nota per macOS:** se il Finder mostra la cartella come "bundle" e
non riesci ad aprirla — rinominala semplicemente da `.lrdevplugin` a
`.lrplugin` (oppure fai clic destro → "Mostra contenuto pacchetto").

## Setup

1. Genera un token API nello studio Lumio:
   **Impostazioni → Token API → Crea token**, ad es. con nome
   "Lightroom @ Studio-Mac". COPIA il token — viene mostrato solo
   una volta.
2. Nel gestore plug-in seleziona il plugin Lumio, nel pannello a
   destra "Connessione Lumio":
   - **Server**: il tuo URL Lumio incluso `https://`, es.
     `https://studio.lumio-cloud.de`
   - **Token API**: incolla il token appena generato
3. Clicca su **Verifica connessione**. Output atteso:
   `✓ Verbunden (API v1)`.

## Utilizzo: Import selezione (pick del cliente verso LR)

1. In Lightroom: **Libreria → Opzioni plug-in → Importa selezione
   Lumio…**
2. Scegli la galleria dalla lista.
3. Seleziona le opzioni:
   - **Imposta i pick come flag Lightroom**: un pick del cliente
     diventa un flag Pick nel catalogo.
   - **Like come valutazione a 1 stella**: un like senza rating
     esplicito diventa 1 stella. Le valutazioni più alte già
     presenti restano invariate.
   - **Applica le valutazioni**: le stelle da 1 a 5 vengono
     riportate direttamente.
   - **Applica i Color Label**: red/yellow/green diventano i
     Red/Yellow/Green di Lightroom.
4. **Ricerca per nome file**: nell'intero catalogo oppure solo
   nella raccolta attiva. Quest'ultima opzione è più veloce con
   cataloghi grandi.
5. **OK** → il plugin trova le corrispondenze dei file in base al
   nome file originale (case-insensitive) e scrive i metadati in
   un'unica transazione, così puoi annullare completamente l'import
   con Cmd/Ctrl-Z.

## Utilizzo: servizio di pubblicazione (immagini LR verso Lumio)

1. In Lightroom, a sinistra sotto "Servizi di pubblicazione" appare
   **Lumio**. Clicca su **Configura** → salva il servizio.
2. **Crea raccolta pubblicata** sotto il servizio Lumio.
3. Nella finestra di dialogo:
   - scegli una **galleria esistente** dalla lista, OPPURE
   - **creane una nuova** con titolo + modalità (selezione/proofing
     o presentazione).
   - **Metti automaticamente 'live' dopo il caricamento**: se
     attivo, la galleria diventa live subito dopo il primo
     caricamento riuscito — i clienti possono aprire l'URL.
4. **Salva** → la raccolta appare sotto Lumio.
5. Trascina le immagini nella raccolta con drag-and-drop oppure
   tramite smart collection → sotto la raccolta le immagini si
   accumulano come "Pronte per la pubblicazione".
6. Clicca su **Pubblica** → Lightroom renderizza le immagini come
   JPEG (sRGB) e le carica su Lumio. Per ogni caricamento vengono
   generate in background le varianti di anteprima, thumbnail ed
   eventualmente watermark.
7. **Mostra in Lumio** (clic destro sulla raccolta) apre la galleria
   nell'area di gestione dello Studio nel browser (non la vista
   pubblica lato cliente).

### Ripubblicare

Se modifichi un'immagine in LR, puoi impostarla manualmente su
"Ripubblica" (clic destro → "Ripubblica"). Al successivo ciclo di
caricamento, il file vecchio viene eliminato da Lumio e viene
caricato quello nuovo.

### Rimuovere le immagini

Rimuovi la foto dalla raccolta oppure elimina la raccolta → Lumio
elimina automaticamente i file corrispondenti.

## Logica di aggregazione (import selezione)

Quando più clienti nella galleria fanno selezioni diverse, i valori
vengono aggregati lato server:

| Lumio-Server | Lightroom |
|---|---|
| **picked**: almeno un cliente ha scelto `pick` | Flag Pick |
| **liked**: almeno un cliente ha messo un cuore | Almeno 1 stella |
| **color**: colore più frequente tra tutti i clienti | Color Label |
| **rating**: stelle massime tra tutti i clienti | Rating a stelle |

## Limitazioni note

- **Matching per nome file (import selezione)**: per i file pubblicati
  con questa versione del plugin, nel JPEG caricato viene incorporato
  anche un hash MD5 del master originale. Questo risolve automaticamente
  le corrispondenze ambigue, e con l'opzione "ritrova i file rinominati
  tramite hash" è possibile ritrovare anche i file rinominati. Per i file
  pubblicati con versioni precedenti (o caricati da browser/upload-link)
  questo hash non esiste — per quelli vale ancora: i file rinominati non
  vengono trovati.
- **Nomi file duplicati**: se il tuo catalogo contiene più foto con lo
  stesso nome file (es. due fotocamere), la corrispondenza è considerata
  ambigua. Senza un hash che la risolva, per questi file non viene
  scritto nulla — meglio saltarli che aggiornare per errore la foto
  sbagliata.
- **Flag Reject**: al momento Lumio conosce solo "pick" e "none",
  non "reject". Per questo, durante l'import nessun flag Reject
  esistente viene sovrascritto.
- **Pubblicazione: solo JPEG, sRGB**: renderizziamo in JPEG sRGB e
  carichiamo solo quello. Gli originali (RAW) restano in locale.
- **Pubblicazione: solo upload single-part**: i file > 100 MB
  vengono attualmente rifiutati. Con i render JPEG non è un
  problema; con gli export TIFF potrebbe servire ridurre
  manualmente la qualità.
- **Smart Preview / stack RAW+JPEG**: il matching avviene a livello
  di nome file, la voce principale del catalogo riceve i metadati.

## Struttura delle cartelle del plugin

```
lumio.lrdevplugin/
├── Info.lua                       Manifest (Selection + Publish)
├── PluginManager.lua              UI nel gestore plug-in (Host+Token)
├── ImportSelectionDialog.lua      Dialogo galleria + opzioni (Import)
├── ImportSelectionTask.lua        Logica dell'import
├── LumioPublishService.lua        Publish-Service-Provider (Upload)
├── LumioApi.lua                   Wrapper HTTP con Bearer-Auth
├── JpegXmp.lua                    Incorpora l'hash originale come XMP
├── Json.lua                       Libreria JSON (MIT, rxi/json.lua)
├── Logger.lua                     Wrapper LrLogger
└── icon.png / icon@2x.png         Icona del Publish-Service
```

## Log

I log del plugin si trovano in:
- macOS: `~/Library/Logs/Adobe/Lightroom/LrClassicLogs/Lumio.log` (confermato su LrC 15.5)
- Windows: `%USERPROFILE%\Documents\LrClassicLogs\Lumio.log`
- La posizione dei log di LrLogger è già cambiata tra versioni di LrC in passato — in caso di dubbio controllare entrambi i percorsi.

## Licenza

FSL-1.1-ALv2 (Functional Source License), come il resto di Lumio.
