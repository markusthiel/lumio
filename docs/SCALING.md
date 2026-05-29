# Horizontale Skalierung — zusätzliche Worker-Nodes

Lumio verarbeitet Bilder, RAWs, Videos und ZIP-Exporte in **Celery-Workern**, die Jobs aus einer zentralen Redis-Queue ziehen. Reicht die Rechenleistung eines Servers nicht mehr (große Shootings, viele Videos parallel), kannst du **zusätzliche Server** dranhängen, die nur Worker fahren. Celery verteilt die Jobs automatisch auf alle verbundenen Worker — kein Loadbalancer, keine Job-Zuteilung von Hand.

> **Single-Node-Self-Hoster?** Dieses Kapitel ist für dich **irrelevant**. Lass alles wie es ist — die hier beschriebenen Variablen (`REDIS_PASSWORD`, `REDIS_BIND_IP`, `POSTGRES_BIND_IP`) sind optional und stehen im Auslieferungszustand auf "nur lokal, kein Passwort". Ein einzelner Server braucht nichts davon. Ändere nichts an Redis/Postgres, wenn du nur einen Server betreibst.

---

## Konzept: Was skaliert, was bleibt zentral

```
        Privates Netzwerk (z.B. Hetzner Private Network, kostenlos)
        ┌──────────────────────────┬──────────────────────────────┐
        │                          │                              │
  ┌─────┴───────────────┐    ┌─────┴────────────────┐
  │  Haupt-Server       │    │  Worker-Node(s)      │
  │  10.0.0.2           │    │  10.0.0.3, .4, …     │
  │                     │    │                      │
  │  API, Frontend      │    │  Worker × N          │
  │  Caddy, acme-dns    │    │  (nur Celery)        │
  │  Postgres ◄─────────┼────┤  liest/schreibt DB   │
  │  Redis (Queue) ◄────┼────┤  zieht Jobs          │
  │  Worker (auch hier) │    │                      │
  └─────────────────────┘    └──────────────────────┘
            │                          │
            └───────────┬──────────────┘
                        ▼
          S3 / Object Storage (extern, von allen erreichbar)
```

**Zentral (genau einmal, auf dem Haupt-Server):**
- **Postgres** — die eine Quelle der Wahrheit für alle Metadaten
- **Redis** — die Job-Queue (Celery-Broker) und Cache
- **API, Frontend, Caddy** — Web-Layer, Datenbank-Migrationen

**Verteilbar (beliebig viele Nodes):**
- **Worker** — halten keinen eigenen Zustand. Sie holen einen Job aus Redis, verarbeiten ihn (Bild/RAW/Video/ZIP), schreiben das Ergebnis nach S3, fertig.

**Extern (von überall erreichbar):**
- **S3 / Object Storage** — z.B. Hetzner Object Storage. Schon extern, also für jeden Node ohne Zusatzkonfiguration erreichbar.

Worker-Nodes führen **keine** Datenbank-Migrationen aus und brauchen **keinen** offenen Port nach außen. Sie sind reine Konsumenten.

---

## Voraussetzungen

- Zwei (oder mehr) Server in einem **gemeinsamen privaten Netzwerk**. Bei Hetzner Cloud: ein "Network", beide Server in **derselben Region** (z.B. Falkenstein/fsn1), kostenlos.
- Der Haupt-Server läuft bereits (siehe [SELFHOSTING.md](SELFHOSTING.md)).
- S3-kompatibler externer Storage (kein MinIO-im-Docker, denn das wäre nur auf dem Haupt-Server). Siehe [STORAGE.md](STORAGE.md).

> **Warum externes S3 Pflicht ist:** Ein Worker-Node muss die Original-Dateien lesen und Renditions zurückschreiben können. Läuft der Storage als MinIO-Container nur auf dem Haupt-Server, müsste auch der übers private Netz exponiert werden. Sauberer und robuster ist externes Object Storage (Hetzner/S3/R2/B2/Wasabi), das ohnehin von allen Nodes erreichbar ist.

---

## Schritt 1 — Privates Netzwerk

**Hetzner Cloud Console → Networks → Create Network:**
- Name: `lumio-net`
- IP-Range: `10.0.0.0/16`

Beide Server zum Netzwerk hinzufügen (Server → Networking → Attach). Sie bekommen private IPs, in dieser Anleitung:
- Haupt-Server: `10.0.0.2`
- Worker-Node: `10.0.0.3`

Verifiziere auf **beiden** Servern, dass das private Interface da ist:

```bash
ip addr | grep 10.0.0
```

Zeigt das nichts, hat der Server die private IP noch nicht gezogen — meist hilft ein `reboot` nach dem Attach.

---

## Schritt 2 — Redis absichern + exponieren (Haupt-Server)

Im privaten Netz ist Redis nur zwischen deinen Servern erreichbar, aber wir setzen trotzdem ein Passwort (Defense-in-Depth) und binden **ausschließlich** auf die private IP — niemals `0.0.0.0`.

```bash
cd /opt/docker/lumio/lumio
git pull

# Passwort generieren — sicher aufbewahren, der Worker-Node braucht es
REDIS_PW=$(openssl rand -hex 24)
echo "Redis-Passwort: $REDIS_PW"

# In .env eintragen
echo "REDIS_PASSWORD=$REDIS_PW"  >> .env
echo "REDIS_BIND_IP=10.0.0.2"    >> .env
echo "POSTGRES_BIND_IP=10.0.0.2" >> .env

# REDIS_URL aller lokalen Services auf Passwort umstellen
sed -i 's|^REDIS_URL=.*|REDIS_URL=redis://:'"$REDIS_PW"'@redis:6379|' .env
```

Wie das funktioniert: Der Redis-Container fügt `--requirepass` nur hinzu, wenn `REDIS_PASSWORD` gesetzt ist (sh-Expansion im `command`). `REDIS_BIND_IP`/`POSTGRES_BIND_IP` steuern das Host-Port-Mapping — Standard ist `127.0.0.1` (nur lokal), hier setzen wir es auf die private IP.

---

## Schritt 3 — Stack neu starten (Haupt-Server)

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  up -d
```

Kurze Unterbrechung (Sekunden), während Redis + die Services mit der neuen URL neu starten.

---

## Schritt 4 — Verifizieren (Haupt-Server)

```bash
# Redis verlangt jetzt Auth
docker exec lumio_redis redis-cli ping
# → (error) NOAUTH Authentication required.     ✓

docker exec lumio_redis redis-cli -a "$REDIS_PW" ping
# → PONG                                         ✓

# Redis + Postgres hören NUR auf der privaten IP
ss -tlnp | grep -E '10.0.0.2:(6379|5432)'
# → beide gelistet                               ✓

# ... und NICHT öffentlich
ss -tlnp | grep -E '0.0.0.0:(6379|5432)'
# → leer                                         ✓
```

---

## Schritt 5 — Worker-Node aufsetzen (10.0.0.3)

### 5a. Docker installieren

```bash
curl -fsSL https://get.docker.com | sh
docker compose version
```

### 5b. Konnektivität testen (zuerst!)

```bash
nc -zv 10.0.0.2 6379    # Redis
nc -zv 10.0.0.2 5432    # Postgres
```

Beide "open/succeeded" → weiter. Sonst privates Netz prüfen (`ip addr | grep 10.0.0`).

### 5c. Repo klonen

```bash
mkdir -p /opt/docker/lumio && cd /opt/docker/lumio
git clone https://<FORGEJO_TOKEN>@forgejo.thiel.tools/thiel/lumio.git lumio
cd lumio
```

### 5d. `.env.worker` anlegen

```bash
cp .env.worker.example .env.worker
nano .env.worker
```

Die Werte: DB-User/Name/Passwort und S3-Credentials **1:1 vom Haupt-Server** (`grep -E "^POSTGRES_|^REDIS_PASSWORD|^S3_" /opt/docker/lumio/lumio/.env` dort ausführen), Hosts auf die **private IP** des Haupt-Servers:

```
DATABASE_URL=postgres://lumio:<DB_PASSWORT>@10.0.0.2:5432/lumio
REDIS_URL=redis://:<REDIS_PASSWORT>@10.0.0.2:6379
STORAGE_PROVIDER=s3
S3_ENDPOINT=https://fsn1.your-objectstorage.com
S3_REGION=fsn1
S3_BUCKET=lumio-prod
S3_ACCESS_KEY=...
S3_SECRET_KEY=...
S3_FORCE_PATH_STYLE=true
WORKER_CONCURRENCY=10
LOG_LEVEL=info
```

### 5e. Worker starten

```bash
docker compose -f docker-compose.worker.yml --env-file .env.worker up -d --build
```

### 5f. Verifizieren

```bash
docker compose -f docker-compose.worker.yml --env-file .env.worker logs -f
```

Erfolgs-Indikatoren im Log:
- `Connected to redis://:**@10.0.0.2:6379//` — Broker-Verbindung steht
- `mingle: sync with 1 nodes` / `mingle: sync complete` — der neue Worker hat die anderen Worker gefunden (Cluster gebildet)
- `celery@… ready.` — nimmt Jobs an

Sobald ein Job reinkommt, siehst du `Task … received` / `… succeeded`.

---

## Tuning

**Parallele Jobs pro Node** = `WORKER_CONCURRENCY` × `replicas`.

- `WORKER_CONCURRENCY` (in `.env.worker`): Faustregel ≈ Anzahl CPU-Kerne. 12-vCPU-Server → 10–12.
- `replicas` (in `docker-compose.worker.yml`): mehrere Worker-Prozesse pro Node. Meist reicht 1 mit hoher Concurrency.

**CPU-Last nach Job-Typ:**
- **Video-Transcoding** (libx264 ohne GPU) ist der größte CPU-Fresser — hier bringt zusätzliche Hardware am meisten.
- **Bild/RAW** (libvips/LibRaw) ist relativ leicht — ein Node reicht lange.

Mehr Nodes: Schritt 5 auf weiteren Servern wiederholen (10.0.0.4, .5, …). Nichts am Haupt-Server zu ändern — neue Worker melden sich automatisch über `mingle` an.

**Queues:** Celery nutzt `default`, `heavy` (Video/große Jobs) und `io`. Standardmäßig nimmt jeder Worker alle drei. Willst du einen Node nur für Video reservieren, kann man ihn auf die `heavy`-Queue beschränken (Celery `-Q heavy`) — bei Bedarf erweitern.

---

## Updates auf dem Worker-Node

```bash
cd /opt/docker/lumio/lumio
git pull
docker compose -f docker-compose.worker.yml --env-file .env.worker up -d --build
```

Wichtig: Worker-Nodes nach dem Haupt-Server aktualisieren (erst Migrationen auf dem Haupt-Server via API, dann Worker), damit das DB-Schema passt.

### Welche Änderung braucht welchen Server?

| Geändert | Haupt-Server | Worker-Node(s) |
|---|---|---|
| `apps/frontend` (Studio-/Kunden-UI) | ✅ `up -d --build frontend` | — |
| `apps/api` (Backend, Endpoints) | ✅ `up -d --build api` | — |
| `apps/worker` (Bild/Video/RAW/ZIP-Verarbeitung) | ✅ `up -d --build worker` | ✅ `up -d --build` |
| Compose-/Infra-Dateien | je nach betroffenem Service | nur wenn worker-relevant |
| Doku, Marketing-Sites | — (bzw. eigener Marketing-Deploy) | — |

Faustregel: Das Frontend und die API laufen **nur** auf dem Haupt-Server. Nur Änderungen an `apps/worker` (der Konvertierungs-Logik) müssen zusätzlich auf jeden Worker-Node ausgerollt werden. Der Haupt-Server-Standard-Deploy bleibt:

```bash
cd /opt/docker/lumio/lumio && git pull && docker compose \
  -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml \
  up -d --build
```

---

## Sicherheit — Zusammenfassung

- Redis + Postgres binden **nur** auf die private IP (`10.0.0.2`), nie `0.0.0.0`. Von außen (öffentliche IP) sind die Ports zu.
- Redis zusätzlich passwortgeschützt.
- Worker-Nodes brauchen **keinen** eingehenden Port nach außen.
- Das private Netz trägt keinen Internet-Traffic — die Verbindung Worker↔DB/Redis verlässt nie das Hetzner-interne Netzwerk.

---

## Troubleshooting

**`Connection refused` zu 10.0.0.2:6379/5432 vom Worker-Node**
Privates Netz nicht durchgängig. `ip addr | grep 10.0.0` auf beiden Servern; ggf. Server nach Network-Attach rebooten. `nc -zv 10.0.0.2 6379` zum Test.

**`NOAUTH` / `WRONGPASS` im Worker-Log**
`REDIS_URL` in `.env.worker` enthält nicht (oder falsches) Passwort. Muss exakt dem `REDIS_PASSWORD` des Haupt-Servers entsprechen: `redis://:<PW>@10.0.0.2:6379`.

**Worker startet, zieht aber keine Jobs**
Prüfen ob `mingle: sync` geklappt hat. Wenn `mingle: all alone`, sieht der Node die Queue nicht — meist falsche/fehlende Redis-Verbindung. Auch prüfen: läuft auf dem Haupt-Server überhaupt Last? Bei leerer Queue ist Stille normal.

**`SecurityWarning: running with superuser privileges`**
Nur ein Hinweis, kein Fehler. Worker laufen als root im Container (wie auf dem Haupt-Server). Unkritisch.

**Bilder werden verarbeitet, aber Renditions fehlen**
S3-Credentials auf dem Worker-Node stimmen nicht mit dem Haupt-Server überein, oder falscher Bucket/Endpoint. Der Worker schreibt dann ins Leere. `.env.worker` gegen die Haupt-`.env` abgleichen.
