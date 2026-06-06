[English](SELFHOSTING.md) · **Deutsch**

# Production Self-Hosting

Du hast den Quick-Start durch und willst Lumio jetzt sauber unter deiner eigenen Domain laufen lassen, mit HTTPS und Backups. Dieser Guide nimmt **15 Minuten** und setzt voraus:

- Linux-Server mit öffentlicher IP (Hetzner, Netcup, eigenes Blech – egal),
  **amd64 oder arm64** — beide werden unterstützt
- Eine Domain (z.B. `galerien.dein-studio.de`)
- Docker + Docker Compose v2

Detaillierte Hardware-/Architektur-Voraussetzungen: [REQUIREMENTS.md](REQUIREMENTS.de.md).

Dieser Guide deckt **Single-Studio** ab. Für Multi-Tenant siehe [MULTI_TENANT.md](MULTI_TENANT.md).

---

## 1. DNS einrichten

Beim DNS-Anbieter einen A-Record (und ggf. AAAA für IPv6) anlegen:

```
galerien.dein-studio.de.   A     <server-ip>
```

TTL erstmal niedrig (300s), kannst du später hochsetzen.

Prüfen:

```bash
dig galerien.dein-studio.de +short
```

Sollte deine Server-IP zurückgeben.

## 2. Firewall öffnen

Auf dem Server (oder per Cloud-Console):

```bash
# UFW als Beispiel
ufw allow 22/tcp
ufw allow 80/tcp
ufw allow 443/tcp
ufw enable
```

**Wichtig bei Hetzner Cloud**: zusätzlich zur OS-Firewall gibt es noch die Cloud Firewall in der Hetzner Console – auch dort 80 und 443 freischalten, sonst kommt nichts durch.

## 3. Lumio installieren

```bash
mkdir -p /opt/docker && cd /opt/docker
git clone https://github.com/markusthiel/lumio.git
cd lumio
cp .env.example .env
```

Sichere Secrets generieren:

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=$(openssl rand -hex 12)|" .env
sed -i "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$(openssl rand -base64 32 | tr -d '/+=')|" .env
```

## 4. Domain in .env eintragen

```bash
nano .env
```

Diese Werte setzen:

```bash
LUMIO_HOST=galerien.dein-studio.de
PUBLIC_URL=https://galerien.dein-studio.de

# S3-Public-URL für Browser-Uploads — gleiche Domain mit /s3-Pfad,
# oder eine eigene Subdomain (siehe unten)
S3_PUBLIC_URL=https://galerien.dein-studio.de/s3
```

## 5. Starten

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Caddy holt sich automatisch ein Let's-Encrypt-Zertifikat (dauert ca. 30 Sekunden). Beobachten:

```bash
docker compose logs -f caddy
```

Erfolg sieht so aus: `certificate obtained successfully ... galerien.dein-studio.de`.

## 6. Admin-User anlegen

Im Single-Mode legt Lumio beim ersten Start automatisch einen Tenant namens "My Studio" an – du brauchst keinen Super-Admin, keinen Tenant manuell erstellen. Nur den ersten User:

```bash
docker compose exec api npm run create-admin -- \
  --email=du@dein-studio.de \
  --password=mindestens12zeichen \
  --name="Dein Studio"
```

## 7. Einloggen

→ `https://galerien.dein-studio.de`

Beim ersten Login Test-Galerie anlegen, ein Bild hochladen, Galerie-Link teilen, von einem anderen Gerät öffnen. Wenn alles funktioniert: läuft.

---

## Backups

Mindestens zwei Sachen sichern:

1. **Postgres** – die ganze Anwendungsdatenbank (User, Galerien, Permissions)
2. **S3-Bucket** – die eigentlichen Bilder/Videos

### Postgres-Dump nightly

In Crontab (`crontab -e`) eintragen:

```cron
0 3 * * * cd /opt/docker/lumio && docker compose exec -T postgres pg_dump -U lumio lumio | gzip > /backup/lumio-$(date +\%Y\%m\%d).sql.gz && find /backup -name "lumio-*.sql.gz" -mtime +14 -delete
```

Speichert 14 Tage. Anschließend nach extern syncen (z.B. mit `rclone` zu einem Backup-Provider).

### S3-Bucket-Backup

Bei MinIO einfach das `minio_data`-Volume rsyncen. Bei externem S3 (Hetzner, R2, B2) Versioning + Lifecycle aktivieren – machen die Provider in der Console.

### Restore-Test

**Mache regelmäßig einen Restore-Test auf einer Test-VM.** Ein nicht-getestetes Backup ist kein Backup.

---

## Updates

```bash
cd /opt/docker/lumio
git pull
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build
```

Prisma-Migrationen laufen automatisch beim API-Start. **Vor jedem Update Postgres-Dump anlegen** – Migrations sind selten reversibel.

Aktuell laufende Version siehst du in `docker compose logs api | grep "Lumio API ready"`.

---

## Eigenes externes S3 statt MinIO

MinIO funktioniert für kleinere Setups (bis ~500 GB) gut. Für mehr Volumen lohnt sich externes S3:

- **Hetzner Object Storage** – günstig, DSGVO, gleicher Datacenter wie der Server möglich
- **Cloudflare R2** – kostenloser Egress, gut für CDN-Setups
- **Backblaze B2** – günstigster Storage-Preis, etwas höhere Latenz

Setup-Schritte: siehe [STORAGE.md](STORAGE.md).

**Wichtig bei externem S3**: CORS am Bucket setzen! Lumio uploadet Bilder direkt vom Browser zu S3 (presigned URLs). Ohne CORS scheitert das. Konkret:

```json
{
  "CORSRules": [{
    "AllowedOrigins": ["https://galerien.dein-studio.de"],
    "AllowedMethods": ["GET", "PUT", "POST", "HEAD"],
    "AllowedHeaders": ["*"],
    "ExposeHeaders": ["ETag"],
    "MaxAgeSeconds": 3000
  }]
}
```

Bei Hetzner Object Storage zusätzlich `S3_FORCE_PATH_STYLE=true` und `S3_REGION=fsn1` (oder dein Bucket-Standort).

---

## Sicherheit

- **`.env` niemals committen** – steht in `.gitignore`, aber check trotzdem
- **Postgres-Port nicht nach außen exponieren** – Default schon korrekt, nur intern erreichbar
- **MinIO-Console (Port 9001) absichern** – im Production-Compose ist sie standardmäßig nicht von außen erreichbar, nur über `docker exec`
- **Backups verschlüsseln** wenn auf fremdem Storage gelagert (`gpg`, `restic`, `borg`)
- **SSH-Key-only Login** auf dem Server, keine Passwort-Auth
- **Unattended-Upgrades** für OS-Patches aktivieren

---

## Häufige Stolperfallen

→ siehe [TROUBLESHOOTING.md](TROUBLESHOOTING.md)
