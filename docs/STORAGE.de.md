[English](STORAGE.md) · **Deutsch** · [Italiano](STORAGE.it.md)

# Storage

Lumio nutzt S3-kompatiblen Object-Storage für alle Foto- und Video-Dateien. Standard-Setup ist der **mitgelieferte Speicher im selben Compose-Stack** (RustFS) – funktioniert sofort, ohne externes Konto.

Sobald du Skalierungs- oder Backup-Anforderungen hast, lohnt sich der Wechsel zu externem S3.

## Wann was nutzen

| Setup | Wann |
|---|---|
| **Mitgelieferter Speicher (Default)** | Single-Studio, <500 GB Daten, ein Server |
| **Hetzner Object Storage** | Server auch bei Hetzner, DSGVO wichtig, <10 TB |
| **Cloudflare R2** | CDN-Setup, viel öffentlicher Traffic, Egress sparen |
| **Backblaze B2** | Sehr günstig pro TB, große Mengen, Archiv-Charakter |
| **Wasabi** | Pauschalpreis, vorhersehbare Kosten, keine API-Calls-Limits |
| **AWS S3** | Multi-Region, Enterprise-Compliance |

---

## Mitgelieferter Speicher: RustFS oder MinIO

Lumio bringt einen eigenen S3-Speicher mit, damit es ohne externes Konto läuft. Seit v0.89 ist das **RustFS**. Installationen von vor v0.89 nutzen **MinIO** und bleiben dabei, bis du selbst umziehst.

### Welchen nutze ich?

Schau in deine `.env`:

```bash
grep COMPOSE_FILE .env
```

- Zeigt `COMPOSE_FILE=docker-compose.yml:docker-compose.rustfs.yml` → **RustFS**.
- Zeigt nichts → **MinIO**. Alles läuft weiter wie bisher, ein Umzug ist freiwillig.

In beiden Fällen heißt der Service in Compose `minio`. So bleiben `S3_ENDPOINT=http://minio:9000`, Caddy und alle Befehle gleich, nur das Programm darin ist ein anderes.

### Muss ich umziehen?

Nein. MinIO läuft weiter mit einem festen Image, das das Projekt pflegt. MinIO selbst wird aber nicht mehr als Open Source weiterentwickelt, deshalb empfehlen wir den Umzug, wenn es passt. Er braucht einen Befehl und ein paar Minuten Ausfallzeit.

### Umzug von MinIO auf RustFS

Vorher: Lumio aktualisieren (`git pull`, dann wie gewohnt `docker compose up -d`) und ein Backup machen (siehe [Backup](BACKUP.de.md)).

Dann im Lumio-Ordner:

```bash
./scripts/migrate-minio-to-rustfs.sh
```

Das Skript

1. stoppt API, Worker und Frontend, damit während der Kopie nichts hochgeladen wird,
2. startet RustFS mit einem neuen, leeren Volume (`rustfs_data`),
3. kopiert alle Dateien aus MinIO und prüft, dass Anzahl und Größe übereinstimmen,
4. trägt die `COMPOSE_FILE`-Zeile in deine `.env` ein (vorher wird eine Sicherung `.env.bak-<datum>` angelegt),
5. startet Lumio wieder, jetzt mit RustFS.

Geht unterwegs etwas schief, wird nichts umgestellt, und Lumio läuft nach `docker compose up -d` wieder mit MinIO.

Danach eine Galerie öffnen und ein Testbild hochladen.

**Was nicht mitkommt:** Umgezogen werden nur die aktuellen Dateien. Ältere Versionen und gelöschte Dateien, die über Bucket-Versioning noch wiederherstellbar wären, bleiben in MinIO. Wer etwas vor dem Umzug Gelöschtes zurückholen muss, macht das vorher oder behält das alte MinIO-Volume, bis alles sicher ist.

**Deine MinIO-Daten bleiben unverändert** im Volume `<projekt>_minio_data` (meist `lumio_minio_data`). Wenn alles läuft, kannst du es löschen:

```bash
docker volume rm lumio_minio_data
```

**Zurück zu MinIO:** die `COMPOSE_FILE`-Zeile aus der `.env` entfernen, dann `docker compose up -d`. Dateien, die unter RustFS hochgeladen wurden, sind dann nicht in MinIO.

### Wenn du Compose mit eigenen `-f`-Dateien startest

Mit `-f` auf der Kommandozeile ignoriert Compose die `COMPOSE_FILE`-Zeile aus der `.env`. Dann `-f docker-compose.rustfs.yml` direkt hinter `-f docker-compose.yml` ergänzen, zum Beispiel:

```bash
docker compose -f docker-compose.yml -f docker-compose.rustfs.yml -f docker-compose.ml.yml up -d
```

Vergisst du es, startet MinIO absichtlich nicht, und das Log sagt, was zu tun ist. So landen neue Dateien nie im falschen, leeren Speicher.

### Eigener Ordner statt Docker-Volume

RustFS läuft als Benutzer `10001`, nicht als root. Wer statt des Volumes `rustfs_data` einen Host-Ordner einbindet, gibt ihn einmalig frei:

```bash
sudo chown -R 10001:10001 /pfad/zum/ordner
```

---

## Allgemeines Setup

In der `.env`:

```bash
STORAGE_PROVIDER=custom        # für alles außer MinIO
S3_ENDPOINT=https://...
S3_REGION=...
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_FORCE_PATH_STYLE=true       # für alle S3-Kompatiblen außer AWS selbst
S3_PUBLIC_URL=https://...      # gleicher Endpoint, außer du nutzt CDN davor
```

`STORAGE_PROVIDER` kann sein: `minio`, `s3`, `r2`, `b2`, `wasabi`, `custom`. Die Provider-Werte sind nur Hinweise für Logging – die eigentliche Konfiguration kommt aus den `S3_*`-Variablen.

Nach dem Wechsel: `docker compose restart api worker`.

**Immer auch CORS am Bucket setzen** (siehe unten), sonst scheitern Browser-Uploads.

---

## Zugriffsschutz (Bucket privat halten)

Lumios Zugriffsmodell setzt voraus, dass der **Bucket privat bleibt**. Aktiviere keinen öffentlichen Lesezugriff — er wird nicht gebraucht und würde den Schutz aushebeln:

- **Keine Public-ACL.** Lumio markiert hochgeladene Objekte nie öffentlich; sie erben die Bucket-Vorgabe, und die muss privat bleiben. Eine rohe Objekt-URL ohne Signatur muss `AccessDenied` liefern.
- **Signierter, zeitlich begrenzter Zugriff.** Die gesamte Auslieferung (Thumbnails, Vorschauen, Downloads, Branding-Assets) läuft über **presigned URLs**, die die API nur in autorisierten Handlern ausstellt; sie laufen nach ~1 Stunde ab. Video (HLS) und ZIP-Downloads werden durch die API selbst gestreamt — der Browser liest den Bucket nie direkt.
- **Nicht erratbare Keys.** Storage-Keys sind UUID-basiert (`t/<tenant-uuid>/g/<gallery-uuid>/r/<file-uuid>/…`) — nicht durchzählbar, nicht erratbar.

Systembedingte Grenze, die man kennen sollte: Eine presigned URL funktioniert für jeden, der sie hat, bis sie abläuft (so arbeitet Presigning). Sie gibt ein einzelnes Objekt für dieses Zeitfenster frei, nicht die Galerie — behandle einen presigned Link aber nicht als etwas, das man veröffentlicht.

Schnelltest, dass dein Bucket privat ist: Ein unsignierter Abruf einer beliebigen Objekt-URL (auch eines nicht existierenden Keys) sollte HTTP `403 AccessDenied` liefern. Kommt `200` oder eine XML-Dateiliste, ist der Bucket öffentlich — vor dem Livegang korrigieren.

## Hetzner Object Storage

S3-kompatibler Storage in Falkenstein, Nürnberg oder Helsinki. DSGVO, deutscher Anbieter.

### Bucket anlegen

Hetzner Cloud Console → Object Storage → "Create Bucket"
- Location: Falkenstein (oder dort wo dein Server steht – spart Latenz und Traffic-Kosten)
- Name: `lumio-prod` (oder beliebig)
- Credentials erzeugen, ACCESS_KEY und SECRET_KEY notieren

### `.env`

```bash
STORAGE_PROVIDER=custom
S3_ENDPOINT=https://fsn1.your-objectstorage.com    # bei NBG1/HEL1 entsprechend anpassen
S3_REGION=fsn1
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<aus Console>
S3_SECRET_KEY=<aus Console>
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://fsn1.your-objectstorage.com
```

### CORS

In der Hetzner Cloud Console: Bucket → CORS:
- Allowed Origins: `https://galerien.dein-studio.de`
- Methods: `GET, PUT, POST, HEAD`
- Headers: `*`
- Expose: `ETag`

### Preise

Ab 6,49 €/Monat netto für 1 TB Storage + 1 TB Egress. Zusätzlich pay-as-you-go. Traffic zwischen Hetzner Cloud Server und Hetzner Object Storage in derselben Region: kostenlos.

---

## Cloudflare R2

Zero-Egress-Fees. Ideal wenn viel öffentlicher Bildtraffic erwartet wird.

### Bucket anlegen

Cloudflare Dashboard → R2 → "Create Bucket"
- Bucket-Name: `lumio-prod`
- Location: Automatic oder EU (für DSGVO)
- API-Token erstellen: R2 → "Manage R2 API Tokens" → Edit-Rechte für den Bucket

### `.env`

```bash
STORAGE_PROVIDER=r2
S3_ENDPOINT=https://<account-id>.r2.cloudflarestorage.com
S3_REGION=auto
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<R2-Access-Key>
S3_SECRET_KEY=<R2-Secret-Key>
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://<account-id>.r2.cloudflarestorage.com
```

Optional: für direkte Bild-URLs über Cloudflare CDN einen Custom-Domain für R2 anlegen und `S3_PUBLIC_URL` auf diese Domain umstellen.

### CORS

In R2 → Bucket → Settings → CORS Policy.

### Preise

$0,015/GB-Monat Storage, **Egress komplett gratis**. Class-A-Operations (Writes) $4,50/Million.

---

## Backblaze B2

Günstigster Preis pro TB. Kombiniert mit Cloudflare als CDN: kostenloses Egress.

### Bucket anlegen

B2 Cloud Storage Dashboard → Create Bucket
- Bucket-Name: `lumio-prod` (muss global eindeutig sein)
- Private
- Application Key erstellen: "Add a New Application Key", auf den Bucket beschränken

### `.env`

```bash
STORAGE_PROVIDER=b2
S3_ENDPOINT=https://s3.<region>.backblazeb2.com    # z.B. eu-central-003
S3_REGION=eu-central-003
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<keyID>
S3_SECRET_KEY=<applicationKey>
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://s3.<region>.backblazeb2.com
```

### CORS

B2 Dashboard → Bucket → CORS Rules.

### Preise

$6/TB Storage. Free Egress bis 3x Storage-Größe, dann $0,01/GB. Mit Cloudflare-CDN davor: unbegrenzt frei.

---

## Wasabi

Pauschal-Preis, keine API-Call-Kosten. Aber: 90-Tage-Mindestspeicherung pro Objekt.

### `.env`

```bash
STORAGE_PROVIDER=wasabi
S3_ENDPOINT=https://s3.<region>.wasabisys.com   # z.B. eu-central-1
S3_REGION=eu-central-1
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<aus Wasabi-Console>
S3_SECRET_KEY=<aus Wasabi-Console>
S3_FORCE_PATH_STYLE=true
S3_PUBLIC_URL=https://s3.<region>.wasabisys.com
```

---

## AWS S3

Wenn du eh in AWS bist oder Compliance-Anforderungen hast.

### `.env`

```bash
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://s3.<region>.amazonaws.com
S3_REGION=eu-central-1     # Frankfurt
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=<IAM Access Key>
S3_SECRET_KEY=<IAM Secret>
S3_FORCE_PATH_STYLE=false     # AWS nutzt virtual-hosted-style
S3_PUBLIC_URL=https://lumio-prod.s3.<region>.amazonaws.com
```

IAM-Policy für den User: mindestens `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`, `s3:AbortMultipartUpload` auf den Bucket beschränken.

---

## Migration vom mitgelieferten Speicher zu externem S3

Wenn du den mitgelieferten Speicher im Live-Betrieb hast und umziehen willst:

```bash
# Der Service minio_init hat den MinIO-Client (mc) und hängt im Lumio-Netz
docker compose run --rm --entrypoint sh minio_init -c '
  mc alias set src http://minio:9000 <speicher-key> <speicher-secret> &&
  mc alias set dst https://<externer-endpoint> <ext-key> <ext-secret> &&
  mc mirror --overwrite src/lumio dst/lumio-prod'
```

Das funktioniert gleich für mitgeliefertes RustFS und mitgeliefertes MinIO.

Während der Migration kann Lumio weiterlaufen. Nach Abschluss `.env` auf den neuen Provider umstellen, `docker compose restart api worker`. Der Speicher-Container kann dann gestoppt werden.

Bei großen Datenmengen besser `rclone` auf dem Host: parallelisierbar, resume-fähig.

---

## CORS-Konfiguration

Lumio nutzt presigned URLs. Browser uploadet direkt zu S3. Ohne CORS blockt der Browser.

Standard-CORS-Regel für alle Provider:

```json
{
  "CORSRules": [{
    "AllowedOrigins": ["https://deine-domain.de"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}
```

Mehrere Origins (Production + Staging) als Array.

**Studios mit eigener Domain (Custom-Domains):** Jede Domain, unter der ein
Studio arbeitet, muss in `AllowedOrigins` stehen. Sonst blockt der Browser
den Upload: Dateien stehen auf „queued“ und dann auf „failed“, und weder
Lumio noch der Storage bekommen eine Anfrage. Wenn deine Studios eigene
Domains mitbringen, ist `"AllowedOrigins": ["*"]` der praktikable Weg: Der
Zugriff auf den Bucket ist durch die Signatur der Upload- und Download-URLs
geschützt (rund eine Stunde gültig), nicht durch CORS, und an den Storage
schickt der Browser keine Cookies. Seit v0.96.0 schreibt Lumio solche
Fehler ins API-Log (`docker logs lumio_api | grep "upload failed in browser"`),
inklusive der blockierten Origin.

Wenn der Provider kein Web-UI dafür hat:

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
