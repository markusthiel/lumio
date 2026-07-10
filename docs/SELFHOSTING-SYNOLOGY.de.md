[English](SELFHOSTING-SYNOLOGY.md) · **Deutsch**

# Lumio auf einer Synology-NAS betreiben

Lumio ist ein reiner Docker-Compose-Stack, der alles Nötige mitbringt
(PostgreSQL, Redis, MinIO als Objektspeicher, Caddy, die App selbst). Damit
*kann* Lumio auf einer Synology-NAS laufen — mit ein paar Einschränkungen bei
Modell, RAM und TLS. Diese Seite ist die Synology-Ergänzung zu
[SELFHOSTING.de.md](SELFHOSTING.de.md); lies die zuerst, hier stehen nur die
Unterschiede.

> **Status:** Synology ist kein offiziell getestetes Ziel. Es funktioniert,
> weil es Standard-Docker-Compose auf amd64/arm64 ist — aber es gibt kein
> Ein-Klick-Paket, und du solltest mit SSH und dem DSM-Reverse-Proxy umgehen
> können.

## Kann deine Synology das?

- [ ] **DSM 7.2 oder neuer mit dem Paket *Container Manager*.** Container
      Manager bringt Docker Engine ≥ 24 **und Compose v2** (`docker compose`)
      mit — genau das braucht Lumio. Das alte „Docker"-Paket auf DSM 6 / frühem
      7 hatte nur Compose v1 und funktioniert **nicht** ohne Handarbeit.
- [ ] **64-Bit-Modell.** Sowohl `amd64` (Intel/AMD) als auch `arm64` (aarch64)
      werden unterstützt. **x86-64-„Plus"/„+"-Modelle sind klar empfohlen**
      (z.B. DS920+/DS923+, DS1522+/DS1621+). Alte 32-Bit-ARM-Modelle werden
      **nicht** unterstützt.
- [ ] **RAM** (der übliche Flaschenhals):
    - Nur Fotos: **mindestens 4 GB**
    - Mit Video-Transcoding: **8 GB**
    - Mit KI-Auto-Tagging (ML-Worker): **+4 GB** obendrauf — auf einer NAS
      besser **aus** lassen
- [ ] **Freier Speicher** auf einem Volume für die Volumes `minio_data` /
      `postgres_data`, passend zu deiner Foto-/Video-Menge.

Hat deine NAS 2 GB RAM oder ist ein 32-Bit-ARM-Modell: hier aufhören — das wird
kein gutes Erlebnis.

## Leistung — was dich erwartet

- **Der erste `up` baut die Images aus dem Quellcode** (Frontend, API und der
  Python-Worker mit libvips). Auf einer NAS-CPU ist das langsam und
  RAM-hungrig; rechne mit **10–30+ Minuten** und ein paar GB freiem RAM
  während des Builds. Eine schwache/RAM-arme NAS kann hier ins OOM laufen —
  dann die Images auf einem stärkeren Rechner bauen und rüberkopieren, oder
  RAM aufrüsten.
- **Video-Transcoding ist mit Abstand die schwerste Aufgabe** (x264 auf CPU).
  Eine 2-Kern-NAS transkodiert eine Hochzeit an Clips langsam und nur nach-
  einander. Reine Foto-Studios sind deutlich leichter.
- **KI-Auto-Tagging (CLIP) ist optional und schwer** — das ML-Image ist
  ~2,5 GB und will +4 GB RAM. Auf einer NAS **das ML-Profil nicht aktivieren**;
  alles andere läuft auch ohne.
- **Lokaler MinIO-Speicher** ist für ein einzelnes Studio in Ordnung; als
  Daumenregel sinnvoll bis ~500 GB. Darüber hinaus Lumio auf externes S3
  zeigen lassen (siehe [STORAGE.de.md](STORAGE.de.md)), damit die NAS nur die
  App fährt, nicht den Speicher.
- **Kunden-Downloads laufen direkt aus dem MinIO auf deiner NAS**, die
  Download-Geschwindigkeit deiner Kunden ist also durch deine **Upload-
  Bandbreite zu Hause** gedeckelt. Bei großen Galerien fällt das mehr ins
  Gewicht als die NAS selbst. (Große ZIPs werden automatisch in Teile
  aufgeteilt, das hilft bei wackligen Verbindungen.)

Referenz-Hardwaretabelle: [REQUIREMENTS.de.md](REQUIREMENTS.de.md).

## Einschränkungen auf einer Synology

- **Kein GPU-Auto-Tagging.** GPU-Beschleunigung braucht NVIDIA/CUDA (nur
  amd64) — auf keiner Synology verfügbar. Auf CPU ist das Tagging funktional
  identisch, nur langsamer. Siehe [GPU.de.md](GPU.de.md).
- **Ports 80/443 sind von DSM belegt.** Du legst Lumios Caddy auf hohe Ports
  und stellst den DSM-Reverse-Proxy davor (siehe unten).
- **Bauen auf der NAS kann zäh sein** auf schwachen Modellen (siehe Leistung).
- **DSM-Updates / Neustarts starten die Container neu.** Mit
  `restart: unless-stopped` kommt der Stack von allein zurück, aber rechne mit
  ein paar Minuten Ausfall während DSM-Wartung.
- **Das hier ist Single-Studio-Self-Hosting.** Multi-Tenant/Wildcard-TLS
  ([MULTI_TENANT.de.md](MULTI_TENANT.de.md)) willst du auf einer Heim-NAS nicht
  betreiben.

## Einrichtung

### 1. Container Manager aktivieren

**Container Manager** im Paket-Zentrum installieren (DSM 7.2+). Per SSH prüfen:

```bash
sudo docker compose version   # muss v2.x ausgeben
```

### 2. Dateien auf die NAS bringen

Ordner auf einem Daten-Volume anlegen, z.B. `/volume1/docker/lumio`, und den
Quellcode dorthin holen. Am einfachsten per SSH (Systemsteuerung → Terminal &
SNMP → SSH aktivieren):

```bash
mkdir -p /volume1/docker && cd /volume1/docker
git clone https://github.com/markusthiel/lumio.git
cd lumio
cp .env.example .env
```

Ist `git` auf deiner NAS nicht vorhanden, lade das Repository am PC als ZIP
herunter und lade den entpackten Ordner per **File Station** hoch.

### 3. Secrets und Modus

Secrets erzeugen (wie in der allgemeinen Anleitung):

```bash
sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=$(openssl rand -base64 24 | tr -d '/+=')|" .env
sed -i "s|^JWT_SECRET=.*|JWT_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^SESSION_SECRET=.*|SESSION_SECRET=$(openssl rand -base64 32 | tr -d '/+=')|" .env
sed -i "s|^S3_ACCESS_KEY=.*|S3_ACCESS_KEY=$(openssl rand -hex 12)|" .env
sed -i "s|^S3_SECRET_KEY=.*|S3_SECRET_KEY=$(openssl rand -base64 32 | tr -d '/+=')|" .env
```

`DEPLOYMENT_MODE=single` ist der Default — so lassen. Single-Mode legt beim
ersten Start automatisch ein Studio an; kein Super-Admin nötig.

### 4. Ports von DSM wegräumen

DSM lauscht bereits auf 80/443. Lumios Caddy in der `.env` auf hohe Ports
legen, damit die Container nicht mit DSM kollidieren:

```bash
CADDY_HTTP_PORT=8080
CADDY_HTTPS_PORT=8443
```

(Die MinIO-Ports kannst du auf den Defaults 9000/9001 lassen, sofern nichts
anderes auf der NAS sie benutzt.)

### 5. TLS — den DSM-Reverse-Proxy nutzen (empfohlen)

Auf einer NAS ist der sauberste Weg: **DSM terminiert HTTPS** mit einem von
Synology verwalteten Zertifikat und leitet einfaches HTTP an Lumios Caddy
weiter. Lumios Caddy unterstützt den Betrieb hinter einem externen
Reverse-Proxy ausdrücklich.

1. **DNS:** einen Hostnamen auf deine NAS zeigen lassen — eine echte Domain
   oder Synology-DDNS (`irgendwas.synology.me`). Du brauchst zwei Namen, z.B.
   `galerie.example.com` und `s3.example.com` (eine eigene S3-Subdomain ist das
   dokumentierte Reverse-Proxy-Muster).
2. **Zertifikat:** unter **Systemsteuerung → Sicherheit → Zertifikat** ein
   Let's-Encrypt-Zertifikat für beide Namen holen (macht Synology mit DDNS oder
   eigener Domain für dich).
3. **Reverse-Proxy:** **Systemsteuerung → Anmeldeportal → Erweitert →
   Reverse-Proxy**, zwei Regeln anlegen, beide auf den Caddy-HTTP-Port:
    - `https://galerie.example.com` → `http://localhost:8080`
    - `https://s3.example.com` → `http://localhost:8080`
   HTTP/2 aktivieren und unter *Eigene Kopfzeile* den `Host`-Header
   durchreichen (WebSocket ebenfalls an — Lumio nutzt `/ws`).
4. **`.env`:** Lumio seine öffentliche Identität mitteilen:

```bash
LUMIO_HOST=galerie.example.com
LUMIO_S3_HOST=s3.example.com
PUBLIC_URL=https://galerie.example.com
S3_PUBLIC_URL=https://s3.example.com
```

Lumios Caddy vertraut `X-Forwarded-Proto` aus privaten Netzbereichen, erkennt
das von DSM terminierte HTTPS also korrekt.

**Alternative (Caddy macht TLS selbst):** willst du lieber Lumio die
Zertifikate machen lassen, musst du 80/443 freiräumen — entweder die DSM-
eigenen Ports verlegen (Systemsteuerung → Anmeldeportal → DSM-HTTP/HTTPS-Ports
ändern), sodass Caddy `CADDY_HTTP_PORT=80` / `CADDY_HTTPS_PORT=443` nutzen kann,
oder am Router 80→8080 / 443→8443 weiterleiten. Caddy holt sich dann selbst ein
Let's-Encrypt-Zertifikat (Port 80 muss aus dem Internet erreichbar sein). Der
DSM-Reverse-Proxy-Weg oben ist auf einer NAS meist weniger Aufwand.

### 6. Starten

```bash
sudo docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d
```

Der erste Lauf baut die Images (siehe Leistung — Geduld). Fortschritt ansehen:

```bash
sudo docker compose logs -f
```

### 7. Admin-Benutzer anlegen

```bash
sudo docker compose exec api npm run create-admin -- \
  --email=du@example.com \
  --password=mind12zeichen \
  --name="Dein Studio"
```

### 8. Anmelden

`https://galerie.example.com` öffnen, eine Test-Galerie anlegen, ein Bild
hochladen, den Link teilen und vom Handy aus öffnen. Klappt dieser Durchlauf,
läuft's.

## Betriebshinweise

- **Caddyfile-Änderungen brauchen einen Restart, keinen Reload** (`admin off`
  ist gesetzt): `sudo docker compose restart caddy`.
- **Sichere zwei Dinge:** die Postgres-Datenbank und die MinIO-Objektdaten
  (Volume `minio_data`). Siehe [BACKUP.de.md](BACKUP.de.md). Synology Hyper
  Backup kann den Ordner `/volume1/docker/lumio` und die Docker-Volumes
  sichern.
- **Aktualisieren:** `git pull` im Projektordner, dann den `up -d`-Befehl aus
  Schritt 6 erneut ausführen (`--build` anhängen, um einen Rebuild zu
  erzwingen). DB-Migrationen laufen beim API-Start automatisch.
- Hängt's? [TROUBLESHOOTING.de.md](TROUBLESHOOTING.de.md).

## Siehe auch

- [SELFHOSTING.de.md](SELFHOSTING.de.md) — die allgemeine Self-Hosting-Anleitung (zuerst lesen)
- [REQUIREMENTS.de.md](REQUIREMENTS.de.md) — Hardware, Architektur, Dimensionierung
- [STORAGE.de.md](STORAGE.de.md) — MinIO vs. externes S3
- [BACKUP.de.md](BACKUP.de.md) — Backup-Strategie
- [GPU.de.md](GPU.de.md) — warum GPU-Tagging hier nicht verfügbar ist
