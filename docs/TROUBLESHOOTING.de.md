[English](TROUBLESHOOTING.md) · **Deutsch**

# Troubleshooting

Sammlung häufiger Probleme beim Self-Hosting und ihre Lösungen.

## Diagnose-Werkzeuge

Vor allem anderen: schau in die Logs.

```bash
# Status aller Container
docker compose ps

# Logs eines Service (live mitlesen mit -f)
docker compose logs api --tail=50 -f
docker compose logs caddy --tail=50 -f
docker compose logs worker --tail=50 -f

# Alle Services gleichzeitig
docker compose logs --tail=20 -f

# Letzte 30 Sekunden aller Container
docker compose logs --since=30s
```

Health-Check der API:

```bash
curl -s http://localhost/health
```

---

## Setup-Probleme

### Container starten nicht

```bash
docker compose ps
```

Wenn ein Service `Restarting` oder `Exited` zeigt, dessen Logs anschauen:

```bash
docker compose logs <service-name> --tail=100
```

Häufige Ursachen:

- **`POSTGRES_PASSWORD` nicht gesetzt** → Postgres-Container exited mit "POSTGRES_PASSWORD not specified". `.env`-Datei prüfen.
- **Port 80 oder 443 belegt** → ein anderer Webserver läuft schon. Mit `ss -tlnp | grep -E ':80|:443'` finden und stoppen oder die `CADDY_HTTP_PORT`/`CADDY_HTTPS_PORT` in `.env` ändern.
- **Disk voll** → `df -h` prüfen. Docker-Images + Logs fressen schnell mehrere GB.

### Domain ist nicht erreichbar (Connection Refused / Timeout)

Reihenfolge der Checks:

1. **DNS zeigt richtige IP?** `dig deine-domain.de +short`
2. **Firewall offen?** Bei Hetzner Cloud: sowohl OS-Firewall (`ufw`) als auch Cloud-Console-Firewall. Beide!
3. **Caddy läuft?** `docker compose ps caddy` → muss "running" sein
4. **Caddy bindet 80/443?** `docker compose ps caddy` zeigt Ports wie `0.0.0.0:80->80/tcp`. Wenn nur `127.0.0.1:...` → Caddy-Service wurde nicht gestartet.

Häufiger Fehler: `docker compose up -d --build api worker frontend` – das startet **nur** die genannten Services, Caddy fehlt. Stattdessen einfach `docker compose up -d` (alle Services).

### Caddy bekommt keine Zertifikate

```bash
docker compose logs caddy | grep -iE "error|acme"
```

Typische Fehler:

- **`connection refused` während ACME-Challenge** → Port 80 nicht erreichbar von außen. Firewall, Cloud-Firewall, falsche DNS-IP prüfen.
- **`no solvers available for remaining challenges (offered=[dns-01])`** → Du versuchst ein Wildcard-Cert (`*.deine-domain.de`). Wildcards brauchen DNS-01-Challenge, nicht HTTP-01. Siehe [MULTI_TENANT.md](MULTI_TENANT.de.md#wildcard-zertifikate).
- **`too many requests` (Rate Limit)** → Let's Encrypt erlaubt max. 50 Zertifikate pro Domain pro Woche. Falls du oft testest: Caddy auf Staging-CA umstellen.

---

## Upload-Probleme

### "Failed" beim Bild-Upload

Die API ist sauber, der Browser-zu-S3-Upload schlägt fehl. Klassisches **CORS-Problem**.

Lumio nutzt presigned URLs – der Browser uploadet direkt zum S3-Bucket, nicht über die API. Ohne CORS-Header am Bucket blockt der Browser den PUT-Request.

**Fix bei externem S3** (Hetzner, R2, B2, Wasabi):

In der Provider-Console des Buckets eine CORS-Regel anlegen:

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

Wenn dein Storage-Provider kein Web-UI dafür hat, per AWS-CLI:

```bash
docker run --rm \
  -e AWS_ACCESS_KEY_ID="<key>" \
  -e AWS_SECRET_ACCESS_KEY="<secret>" \
  amazon/aws-cli s3api put-bucket-cors \
  --bucket lumio-prod \
  --endpoint-url https://<dein-s3-endpoint> \
  --region <deine-region> \
  --cors-configuration file:///path/to/cors.json
```

**Bei MinIO** ist CORS standardmäßig permissiv und sollte einfach funktionieren. Wenn nicht, im MinIO Container:

```bash
docker compose exec minio mc anonymous set download local/lumio
```

### "S3 connection refused" / Upload-Init schlägt fehl

API-Logs anschauen (`docker compose logs api`). Häufige Ursachen:

- **`S3_ENDPOINT` falsch** – sollte `http://minio:9000` für MinIO oder `https://<dein-endpoint>` für externes S3 sein. **Nicht** localhost, der Container kommt da nicht ran.
- **`S3_REGION` falsch** – Default ist `us-east-1`. Bei Hetzner muss es `fsn1` (oder `nbg1`/`hel1`) sein, sonst Signature-Mismatch (403).
- **`S3_FORCE_PATH_STYLE` fehlt** – bei den meisten S3-Kompatiblen (außer AWS selbst) muss das auf `true`.
- **Bucket existiert nicht** – manche Provider legen ihn nicht automatisch an. In der Provider-Console manuell erstellen.

---

## Login-Probleme

### „JSON.parse: unexpected character" / „Unexpected token '<'" beim Login

Das Frontend hat HTML statt JSON von der API erhalten. Zwei häufige Ursachen:

1. **Du gehst am Proxy vorbei.** Lumio muss über Caddy auf **Port 80/443**
   aufgerufen werden — der routet `/api/*` zur API. Direkter Zugriff auf den
   Frontend-Port (3000), z.B. per SSH-Tunnel `ssh -L 3000:127.0.0.1:3000 …`,
   trifft Next.js ohne API-Routen. Stattdessen Port 80 tunneln:
   `ssh -L 8080:127.0.0.1:80 dein-server` → `http://localhost:8080` öffnen.
   (Seit v0.49.1 proxied Port 3000 API-Aufrufe als Fallback mit, auf älteren
   Versionen ist das aber exakt dieses Fehlerbild.)
2. **Der API-Container ist down** — Caddy antwortet dann mit einer
   HTML-Fehlerseite. Prüfen: `docker compose ps` und
   `docker compose logs api --tail=50`.

Seit v0.49.1 zeigt das Frontend statt des rohen `JSON.parse`-Fehlers eine
verständliche Fehlermeldung.

### Kein Login-Button, leere Seite

Frontend-Logs:

```bash
docker compose logs frontend --tail=50
```

Wenn `ECONNREFUSED` zu Port 3001 → API ist nicht erreichbar. Häufig wegen Migrations-Fehler in Postgres. API-Logs prüfen:

```bash
docker compose logs api | grep -iE "error|migration"
```

### "Invalid credentials" trotz richtigen Daten

Häufigste Ursache: User wurde in einem anderen Tenant angelegt, du loggst dich auf der falschen Domain ein.

Im Single-Mode unkritisch. Im Multi-Mode: Tenant-Slug in der Login-URL prüfen.

User listen:

```bash
docker compose exec api npx prisma studio
```

(Öffnet Web-UI auf Port 5555, dort User-Tabelle inspizieren.)

### `create-admin` läuft, aber Login geht nicht

Passwort muss mindestens 12 Zeichen lang sein. Mit kürzeren Passwörtern bricht das Script ab – aber falls du `create-admin` über Custom-Code aufrufst, könnte ein zu kurzes Passwort durchschlüpfen und beim Login fehlschlagen.

Lösung: Admin neu anlegen, das Script ist idempotent (überschreibt existierende).

---

## SaaS-Mode-Probleme

### `price_not_configured` beim Sign-up

Die Stripe-Pläne wurden noch nicht angelegt. Einmal:

```bash
docker compose exec api npm run stripe-bootstrap
```

Voraussetzung: `STRIPE_SECRET_KEY` muss in `.env` gesetzt sein (mit `sk_test_...` für Test-Modus).

Das Script ist idempotent, kann mehrfach laufen. Legt drei Plans (Solo, Studio, Pro) + Storage-Pack in Stripe an und schreibt die Price-IDs in die Lumio-DB.

### Stripe-Webhooks kommen nicht an

Im Stripe Dashboard → Developers → Webhooks prüfen:

- Endpoint-URL korrekt: `https://deine-domain.de/api/billing/webhook`
- Events abonniert: mindestens `customer.subscription.*`, `invoice.payment_*`, `checkout.session.completed`
- Signing-Secret in `.env` als `STRIPE_WEBHOOK_SECRET`
- API-Container neu starten nach .env-Änderung: `docker compose restart api`

Test: im Stripe Dashboard kann man Test-Events triggern und sieht ob Lumio sie annimmt.

---

## Performance-Probleme

### Upload langsam

Vom Frontend zur API → zur S3-Storage zurück zum Browser ist ein Umweg. Lumio nutzt **presigned URLs**: Browser uploadet direkt zu S3, ohne API-Hop.

Wenn das langsam ist:

- **Externes S3 statt MinIO** – MinIO auf einer kleinen VM saturiert die Disk schnell
- **Storage im gleichen Datacenter** wie der Server (z.B. Hetzner Cloud + Hetzner Object Storage in Falkenstein)
- **`UPLOAD_CHUNK_SIZE_MIB`** in `.env` von 8 auf 16 hochsetzen für große Files

### Thumbnail-Generierung dauert ewig

Worker-Logs:

```bash
docker compose logs worker --tail=50
```

- **CPU-Auslastung hoch?** Workers skalieren: `docker compose up -d --scale worker=4`
- **Viele große RAW-Files?** Das ist normal CPU-intensiv. GPU-Beschleunigung siehe [GPU.md](GPU.de.md).
- **KI-Auto-Tagging aktiv?** CLIP läuft auf CPU bei 1–3s pro Bild. Auch hier hilft GPU oder mehr Worker.

---

## Last-Resort-Debug

Wenn nichts mehr hilft, alles zurücksetzen (⚠️ **alle Daten weg**):

```bash
docker compose down -v   # -v löscht auch Volumes!
docker compose up -d --build
```

Oder partiell – nur die DB neu:

```bash
docker compose down
docker volume rm lumio_postgres_data
docker compose up -d
```

Und vorher mal in einem **frischen** Verzeichnis Lumio neu clonen, um sicherzugehen dass kein lokaler Drift in den Configs ist.

---

## Issue melden

Wenn du einen Fehler gefunden hast, der hier nicht steht: Issue auf https://github.com/markusthiel/lumio/issues mit:

1. Was wolltest du tun?
2. Was ist passiert?
3. Logs (`docker compose logs --tail=200`)
4. Setup-Mode (single/multi, MinIO oder externes S3, Caddy oder externer Proxy)
5. Lumio-Version (`git rev-parse HEAD`)
