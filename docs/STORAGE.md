**English** · [Deutsch](STORAGE.de.md)

# Storage

Lumio uses S3-compatible object storage for all photo and video files. The default setup is **MinIO in the same Compose stack** – works out of the box, no external account.

As soon as you have scaling or backup requirements, switching to external S3 pays off.

## When to use what

| Setup | When |
|---|---|
| **MinIO (default)** | Single studio, <500 GB of data, one server |
| **Hetzner Object Storage** | Server also on Hetzner, GDPR matters, <10 TB |
| **Cloudflare R2** | CDN setup, lots of public traffic, save on egress |
| **Backblaze B2** | Very cheap per TB, large volumes, archival character |
| **Wasabi** | Flat price, predictable costs, no API call limits |
| **AWS S3** | Multi-region, enterprise compliance |

---

## General setup

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

`STORAGE_PROVIDER` can be: `minio`, `s3`, `r2`, `b2`, `wasabi`, `custom`. The provider values are only hints for logging – the actual configuration comes from the `S3_*` variables.

After switching: `docker compose restart api worker`.

**Always set CORS on the bucket too** (see below), otherwise browser uploads fail.

---

## Hetzner Object Storage

S3-compatible storage in Falkenstein, Nuremberg or Helsinki. GDPR, German provider.

### Create the bucket

Hetzner Cloud Console → Object Storage → "Create Bucket"
- Location: Falkenstein (or wherever your server is – saves latency and traffic cost)
- Name: `lumio-prod` (or anything)
- Generate credentials, note ACCESS_KEY and SECRET_KEY

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

In the Hetzner Cloud Console: Bucket → CORS:
- Allowed Origins: `https://gallery.your-studio.com`
- Methods: `GET, PUT, POST, HEAD`
- Headers: `*`
- Expose: `ETag`

### Pricing

From €6.49/month net for 1 TB storage + 1 TB egress. Additional usage is pay-as-you-go. Traffic between a Hetzner Cloud server and Hetzner Object Storage in the same region: free.

---

## Cloudflare R2

Zero egress fees. Ideal when a lot of public image traffic is expected.

### Create the bucket

Cloudflare Dashboard → R2 → "Create Bucket"
- Bucket name: `lumio-prod`
- Location: Automatic or EU (for GDPR)
- Create an API token: R2 → "Manage R2 API Tokens" → edit rights for the bucket

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

Optional: for direct image URLs via the Cloudflare CDN, set up a custom domain for R2 and point `S3_PUBLIC_URL` to that domain.

### CORS

In R2 → Bucket → Settings → CORS Policy.

### Pricing

$0.015/GB-month storage, **egress completely free**. Class A operations (writes) $4.50/million.

---

## Backblaze B2

Cheapest price per TB. Combined with Cloudflare as a CDN: free egress.

### Create the bucket

B2 Cloud Storage Dashboard → Create Bucket
- Bucket name: `lumio-prod` (must be globally unique)
- Private
- Create an application key: "Add a New Application Key", restricted to the bucket

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

### Pricing

$6/TB storage. Free egress up to 3x storage size, then $0.01/GB. With a Cloudflare CDN in front: unlimited free.

---

## Wasabi

Flat price, no API call costs. But: 90-day minimum storage per object.

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

When you're in AWS anyway or have compliance requirements.

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

IAM policy for the user: at minimum `s3:GetObject`, `s3:PutObject`, `s3:DeleteObject`, `s3:ListBucket`, `s3:AbortMultipartUpload`, restricted to the bucket.

---

## Migrating from MinIO to external S3

If you're running MinIO live and want to move:

```bash
# Into the MinIO container, mc is already there
docker compose exec minio mc alias set src http://localhost:9000 <minio-key> <minio-secret>
docker compose exec minio mc alias set dst https://<external-endpoint> <ext-key> <ext-secret>

docker compose exec minio mc mirror --overwrite src/lumio dst/lumio-prod
```

Lumio can keep running during the migration. When done, switch `.env` to the new provider, `docker compose restart api worker`. The MinIO container can then be stopped.

For large data volumes, prefer `rclone` on the host: parallelizable, resumable.

---

## CORS configuration

Lumio uses presigned URLs. The browser uploads directly to S3. Without CORS the browser blocks it.

Standard CORS rule for all providers:

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

Multiple origins (production + staging) as an array. Wildcards (`*`) work but are insecure.

If the provider has no web UI for it:

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
