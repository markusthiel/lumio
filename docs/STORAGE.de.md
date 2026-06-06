[English](STORAGE.md) · **Deutsch**

# Storage

Lumio nutzt S3-kompatiblen Object-Storage für alle Foto- und Video-Dateien. Standard-Setup ist **MinIO im selben Compose-Stack** – funktioniert sofort, ohne externes Konto.

Sobald du Skalierungs- oder Backup-Anforderungen hast, lohnt sich der Wechsel zu externem S3.

## Wann was nutzen

| Setup | Wann |
|---|---|
| **MinIO (Default)** | Single-Studio, <500 GB Daten, ein Server |
| **Hetzner Object Storage** | Server auch bei Hetzner, DSGVO wichtig, <10 TB |
| **Cloudflare R2** | CDN-Setup, viel öffentlicher Traffic, Egress sparen |
| **Backblaze B2** | Sehr günstig pro TB, große Mengen, Archiv-Charakter |
| **Wasabi** | Pauschalpreis, vorhersehbare Kosten, keine API-Calls-Limits |
| **AWS S3** | Multi-Region, Enterprise-Compliance |

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

## Migration von MinIO zu externem S3

Wenn du MinIO im Live-Betrieb hast und umziehen willst:

```bash
# In den MinIO-Container, mc ist schon drin
docker compose exec minio mc alias set src http://localhost:9000 <minio-key> <minio-secret>
docker compose exec minio mc alias set dst https://<external-endpoint> <ext-key> <ext-secret>

docker compose exec minio mc mirror --overwrite src/lumio dst/lumio-prod
```

Während der Migration kann Lumio weiterlaufen. Nach Abschluss `.env` auf den neuen Provider umstellen, `docker compose restart api worker`. MinIO-Container kann dann gestoppt werden.

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

Mehrere Origins (Production + Staging) als Array. Wildcards (`*`) gehen, sind aber unsicher.

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
