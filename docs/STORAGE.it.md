[English](STORAGE.md) · [Deutsch](STORAGE.de.md) · **Italiano**

# Archiviazione

Lumio usa un'archiviazione a oggetti compatibile con S3 per tutti i file
foto e video. Il setup predefinito è lo **storage incluso nello stesso stack Compose**
(RustFS) – funziona subito, senza account esterno.

Non appena hai esigenze di scalabilità o di backup, passare a un S3 esterno
conviene.

## Quando usare cosa

| Setup | Quando |
|---|---|
| **Storage incluso (predefinito)** | Studio singolo, <500 GB di dati, un server |
| **Hetzner Object Storage** | Server anche su Hetzner, il GDPR conta, <10 TB |
| **Cloudflare R2** | Setup CDN, molto traffico pubblico, risparmiare sull'egress |
| **Backblaze B2** | Molto economico per TB, grandi volumi, carattere archivistico |
| **Wasabi** | Prezzo fisso, costi prevedibili, nessun limite di chiamate API |
| **AWS S3** | Multi-regione, compliance enterprise |

---

## Storage incluso: RustFS o MinIO

Lumio include un proprio storage S3, così funziona senza account esterno. Dalla v0.89 è **RustFS**. Le installazioni precedenti alla v0.89 usano **MinIO** e continuano a farlo finché non decidi di migrare.

### Quale sto usando?

Controlla il tuo `.env`:

```bash
grep COMPOSE_FILE .env
```

- Mostra `COMPOSE_FILE=docker-compose.yml:docker-compose.rustfs.yml` → **RustFS**.
- Non mostra nulla → **MinIO**. Tutto continua a funzionare come prima; la migrazione è facoltativa.

In entrambi i casi il servizio in Compose si chiama `minio`. Così `S3_ENDPOINT=http://minio:9000`, Caddy e tutti i comandi restano uguali; cambia solo il programma all'interno.

### Devo migrare?

No. MinIO continua a girare con un'immagine fissa mantenuta dal progetto. MinIO però non è più sviluppato come open source, quindi consigliamo di migrare quando è comodo. Basta un comando e qualche minuto di fermo.

### Migrare da MinIO a RustFS

Prima: aggiorna Lumio (`git pull`, poi il solito `docker compose up -d`) e fai un backup (vedi [Backup](BACKUP.it.md)).

Poi, nella cartella di Lumio:

```bash
./scripts/migrate-minio-to-rustfs.sh
```

Lo script:

1. ferma API, worker e frontend, così durante la copia non arrivano nuovi upload,
2. avvia RustFS con un volume nuovo e vuoto (`rustfs_data`),
3. copia tutti i file da MinIO e verifica che numero e dimensione coincidano,
4. aggiunge la riga `COMPOSE_FILE` al tuo `.env` (prima crea una copia `.env.bak-<data>`),
5. riavvia Lumio, ora su RustFS.

Se qualcosa va storto, non viene cambiato nulla e dopo `docker compose up -d` Lumio gira di nuovo su MinIO.

Dopo, apri una galleria e carica un'immagine di prova.

**Cosa non viene copiato:** si spostano solo i file attuali. Le versioni precedenti e i file eliminati ancora recuperabili tramite il versioning del bucket restano in MinIO. Se devi recuperare qualcosa eliminato prima della migrazione, fallo prima, oppure tieni il vecchio volume MinIO finché sei sicuro.

**I tuoi dati MinIO restano intatti** nel volume `<progetto>_minio_data` (di solito `lumio_minio_data`). Quando tutto funziona, puoi eliminarlo:

```bash
docker volume rm lumio_minio_data
```

**Tornare a MinIO:** rimuovi la riga `COMPOSE_FILE` dal `.env`, poi `docker compose up -d`. I file caricati durante l'uso di RustFS non sono in MinIO.

### Se avvii Compose con file `-f` propri

Con `-f` sulla riga di comando, Compose ignora `COMPOSE_FILE` nel `.env`. In quel caso aggiungi `-f docker-compose.rustfs.yml` subito dopo `-f docker-compose.yml`, per esempio:

```bash
docker compose -f docker-compose.yml -f docker-compose.rustfs.yml -f docker-compose.ml.yml up -d
```

Se lo dimentichi, MinIO volutamente non si avvia e il suo log spiega cosa fare. Così i nuovi file non finiscono mai nello storage sbagliato e vuoto.

### Una cartella propria invece di un volume Docker

RustFS gira come utente `10001`, non come root. Se monti una cartella dell'host al posto del volume `rustfs_data`, assegnala una volta a quell'utente:

```bash
sudo chown -R 10001:10001 /percorso/della/cartella
```

---

## Configurazione generale

In `.env`:

```bash
STORAGE_PROVIDER=custom        # for everything except MinIO
S3_ENDPOINT=https://...
S3_REGION=...
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_FORCE_PATH_STYLE=true       # for all S3-compatibles except AWS itself
S3_PUBLIC_URL=https://...      # same endpoint, unless you put a CDN in front
```

`STORAGE_PROVIDER` può essere: `minio`, `s3`, `r2`, `b2`, `wasabi`,
`custom`. I valori del provider sono solo indicazioni per il logging – la
configurazione effettiva viene dalle variabili `S3_*`.

Dopo il cambio: `docker compose restart api worker`.

**Imposta sempre anche il CORS sul bucket** (vedi sotto), altrimenti i
caricamenti dal browser falliscono.

---

## Sicurezza degli accessi (mantieni il bucket privato)

Il modello di accesso di Lumio si basa sul fatto che il **bucket resti
privato**. Non attivare l'accesso pubblico in lettura — non serve e
comprometterebbe la protezione:

- **Nessuna ACL pubblica.** Lumio non marca mai come pubblici gli oggetti
  caricati; ereditano il default del bucket, che deve restare privato. Un
  URL di oggetto grezzo senza firma deve restituire `AccessDenied`.
- **Accesso firmato e limitato nel tempo.** Tutta la distribuzione
  (thumbnail, anteprime, download, asset di branding) avviene tramite **URL
  presigned** che l'API emette solo all'interno di handler di richiesta
  autorizzati; scadono dopo ~1 ora. I download video (HLS) e ZIP vengono
  trasmessi in streaming attraverso l'API stessa, quindi il browser non
  legge mai direttamente il bucket.
- **Chiavi non indovinabili.** Le chiavi di archiviazione sono basate su
  UUID (`t/<tenant-uuid>/g/<gallery-uuid>/r/<file-uuid>/…`) — non possono
  essere enumerate né indovinate.

Limite intrinseco di cui essere consapevoli: un URL presigned funziona per
chiunque lo possieda finché non scade (è così che funziona il presigning).
Espone un singolo oggetto per quella finestra temporale, non la galleria —
ma non trattare un link presigned come qualcosa da pubblicare.

Verifica rapida che il tuo bucket sia privato: una richiesta non firmata
verso qualsiasi URL di oggetto (anche una chiave inesistente) dovrebbe
restituire HTTP `403 AccessDenied`. Se ottieni `200` o un elenco di file
XML, il bucket è pubblico — correggilo prima di andare in produzione.

## Hetzner Object Storage

Archiviazione compatibile S3 a Falkenstein, Norimberga o Helsinki. GDPR,
provider tedesco.

### Crea il bucket

Hetzner Cloud Console → Object Storage → "Create Bucket"
- Location: Falkenstein (o dove si trova il tuo server – risparmia latenza
  e costi di traffico)
- Nome: `lumio-prod` (o quello che vuoi)
- Genera le credenziali, annota ACCESS_KEY e SECRET_KEY

### `.env`

```bash
STORAGE_PROVIDER=custom
S3_ENDPOINT=https://fsn1.your-objectstorage.com    # adjust for NBG1/HEL1 accordingly
S3_REGION=fsn1
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<from console>
S3_SECRET_KEY=<from console>
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://fsn1.your-objectstorage.com
```

### CORS

Nella Hetzner Cloud Console: Bucket → CORS:
- Allowed Origins: `https://gallery.your-studio.com`
- Methods: `GET, PUT, POST, HEAD`
- Headers: `*`
- Expose: `ETag`

### Prezzi

A partire da €6,49/mese netti per 1 TB di archiviazione + 1 TB di egress.
L'utilizzo aggiuntivo è pay-as-you-go. Traffico tra un server Hetzner Cloud
e Hetzner Object Storage nella stessa regione: gratuito.

---

## Cloudflare R2

Zero costi di egress. Ideale quando ci si aspetta molto traffico pubblico
di immagini.

### Crea il bucket

Cloudflare Dashboard → R2 → "Create Bucket"
- Nome bucket: `lumio-prod`
- Location: Automatic o EU (per il GDPR)
- Crea un token API: R2 → "Manage R2 API Tokens" → diritti di modifica per
  il bucket

### `.env`

```bash
STORAGE_PROVIDER=r2
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<R2 access key>
S3_SECRET_KEY=<R2 secret key>
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://<account-id>.r2.cloudflarestorage.com
```

Opzionale: per URL immagine diretti tramite la CDN Cloudflare, configura un
dominio personalizzato per R2 e punta `S3_PUBLIC_URL` a quel dominio.

### CORS

In R2 → Bucket → Settings → CORS Policy.

### Prezzi

$0,015/GB-mese di archiviazione, **egress completamente gratuito**.
Operazioni Class A (scritture) $4,50/milione.

---

## Backblaze B2

Prezzo più economico per TB. Combinato con Cloudflare come CDN: egress
gratuito.

### Crea il bucket

B2 Cloud Storage Dashboard → Create Bucket
- Nome bucket: `lumio-prod` (deve essere univoco a livello globale)
- Privato
- Crea una application key: "Add a New Application Key", limitata al bucket

### `.env`

```bash
STORAGE_PROVIDER=b2
S3_ENDPOINT=https://s3.<region>.backblazeb2.com    # e.g. eu-central-003
S3_REGION=eu-central-003
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<keyID>
S3_SECRET_KEY=<applicationKey>
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://s3.<region>.backblazeb2.com
```

### CORS

B2 Dashboard → Bucket → CORS Rules.

### Prezzi

$6/TB di archiviazione. Egress gratuito fino a 3x la dimensione
dell'archiviazione, poi $0,01/GB. Con una CDN Cloudflare davanti: illimitato
e gratuito.

---

## Wasabi

Prezzo fisso, nessun costo per le chiamate API. Ma: 90 giorni di
archiviazione minima per oggetto.

### `.env`

```bash
STORAGE_PROVIDER=wasabi
S3_ENDPOINT=https://s3.<region>.wasabisys.com   # e.g. eu-central-1
S3_REGION=eu-central-1
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<from Wasabi console>
S3_SECRET_KEY=<from Wasabi console>
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://s3.<region>.wasabisys.com
```

---

## AWS S3

Quando sei comunque già su AWS o hai requisiti di compliance.

### `.env`

```bash
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.<region>.amazonaws.com
S3_REGION=eu-central-1     # Frankfurt
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<IAM access key>
S3_SECRET_KEY=<IAM secret>
S3_FORCE_PATH_STYLE=false     # AWS uses virtual-hosted style
S3_PUBLIC_URL=https://lumio-prod.s3.<region>.amazonaws.com
```

Policy IAM per l'utente: come minimo `s3:GetObject`, `s3:PutObject`,
`s3:DeleteObject`, `s3:ListBucket`, `s3:AbortMultipartUpload`, limitata al
bucket.

---

## Migrare dallo storage incluso a S3 esterno

Se hai lo storage incluso in produzione e vuoi migrare:

```bash
# Il servizio minio_init contiene il client MinIO (mc) ed è nella rete di Lumio
docker compose run --rm --entrypoint sh minio_init -c '
  mc alias set src http://minio:9000 <chiave-storage> <segreto-storage> &&
  mc alias set dst https://<endpoint-esterno> <ext-key> <ext-secret> &&
  mc mirror --overwrite src/lumio dst/lumio-prod'
```

Funziona allo stesso modo con RustFS incluso e con MinIO incluso.

Lumio può continuare a girare durante la migrazione. Al termine, cambia
`.env` verso il nuovo provider, `docker compose restart api worker`. Il
container dello storage può poi essere fermato.

Per grandi volumi di dati, preferisci `rclone` sull'host: parallelizzabile,
ripristinabile.

---

## Configurazione CORS

Lumio usa URL presigned. Il browser carica direttamente su S3. Senza CORS
il browser lo blocca.

Regola CORS standard per tutti i provider:

```json
{
  "CORSRules": [{
    "AllowedOrigins": ["https://your-domain.com"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}
```

Più origin (produzione + staging) come array.

**Studi con un proprio dominio (domini personalizzati):** ogni dominio da cui
lavora uno studio deve comparire in `AllowedOrigins`. Altrimenti il browser
blocca l'upload: i file restano su "queued" e poi passano a "failed", e né
Lumio né lo storage ricevono una richiesta. Se i tuoi studi usano domini
propri, `"AllowedOrigins": ["*"]` è la scelta pratica: l'accesso al bucket è
protetto dalla firma degli URL di upload e download (validi circa un'ora),
non dal CORS, e il browser non invia cookie allo storage. Da v0.96.0 Lumio
registra questi errori nel log dell'API
(`docker logs lumio_api | grep "upload failed in browser"`), compresa
l'origin bloccata.

Se il provider non ha una UI web per questo:

```bash
docker run --rm \
  -e AWS_ACCESS_KEY_ID="<key>" \
  -e AWS_SECRET_ACCESS_KEY="<secret>" \
  amazon/aws-cli s3api put-bucket-cors \
  --bucket lumio-prod \
  --endpoint-url https://<endpoint> \
  --region <region> \
  --cors-configuration file:///path/to/cors.json
```
