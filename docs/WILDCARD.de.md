[English](WILDCARD.md) · **Deutsch**

# Wildcard-Zertifikate für Tenant-Subdomains

Wenn du Lumio im **Multi-Mode** mit Tenant-Subdomains betreibst (z.B. `saro.lumio-cloud.de`, `acme.lumio-cloud.de`), brauchst du ein Wildcard-Zertifikat für `*.lumio-cloud.de`. Hier die saubere Lösung — funktioniert mit **jedem** DNS-Provider, auch wenn der keine API hat.

> Für **Single-Mode** (eine Domain, ein Studio) und **Custom-Domains** (Kunde lässt seine eigene Domain auf deine IP zeigen) ist das **nicht** nötig. Caddy holt für die einzelne Hauptdomain und für Custom-Domains automatisch Standard-Certs via HTTP-01.

## Warum nicht direkter DNS-Plugin?

Let's Encrypt verlangt für Wildcards eine DNS-01-Challenge — Caddy muss einen TXT-Record `_acme-challenge.lumio-cloud.de` setzen können. Das geht direkt nur mit DNS-Provider-API-Plugins (Cloudflare, Route53 etc.). Viele Provider (Domainreselling, Strato, IONOS ohne Premium-Tarif) haben keinen API-Zugang oder verlangen Premium-Tarife. Lösung: **acme-dns** als Vermittler.

## Wie acme-dns funktioniert

`acme-dns` ist ein winziger DNS-Server, der nur `_acme-challenge`-TXT-Records bedient. Du delegierst genau diesen einen Record an deinen acme-dns-Server, alles andere bleibt bei deinem Haupt-Provider. Vorteile:

- **Provider-agnostisch:** Du brauchst keinen API-Zugang
- **Sicher:** Bei Kompromittierung der acme-dns-Credentials kann der Angreifer nur `_acme-challenge` ändern, nicht deine Haupt-DNS-Records
- **Standardkomponente:** Caddy hat einen offiziellen Plugin, läuft seit Jahren in Produktion

Lumio bringt acme-dns als Docker-Service mit (`lumio_acme_dns`) — du musst ihn nur einmalig einrichten.

## Voraussetzungen

- Lumio läuft im Multi-Mode
- Du hast eine Domain (z.B. `lumio-cloud.de`) bei einem beliebigen DNS-Provider
- Port 53 UDP+TCP ist von außen auf deinen Server erreichbar (Cloud-Firewall ggf. öffnen)
- Du kennst die öffentliche IP deines Servers

## Setup in 6 Schritten

### 1. systemd-resolved entschärfen (Ubuntu/Debian)

Auf Ubuntu hört `systemd-resolved` auf `127.0.0.53:53`. Linux verbietet dann `0.0.0.0:53`-Binds — auch wenn das nur Loopback ist. Wir binden daher acme-dns explizit an die externe Server-IP, statt 0.0.0.0:

```bash
# In .env die Server-IP eintragen
echo "ACME_DNS_BIND_IP=DEINE.SERVER.IP" >> .env
```

systemd-resolved läuft normal weiter, acme-dns hört auf der externen IP. Kein Konflikt.

### 2. Postgres-DB für acme-dns anlegen

Bei einem frischen Setup macht das Init-Skript `02-acme-dns.sql` automatisch. Bei einem bestehenden Postgres (Volume existiert schon) manuell nachholen:

```bash
docker compose exec postgres psql -U lumio -d postgres -c \
  "CREATE USER acme_dns WITH PASSWORD 'acme_dns_local_pw';"
docker compose exec postgres psql -U lumio -d postgres -c \
  "CREATE DATABASE acme_dns OWNER acme_dns;"
docker compose exec postgres psql -U lumio -d postgres -c \
  "GRANT ALL PRIVILEGES ON DATABASE acme_dns TO acme_dns;"
```

### 3. Cloud-Firewall: Port 53 öffnen

Bei Hetzner Cloud Console → Firewalls → Add Rule:
- TCP 53, Inbound, Source: Any
- UDP 53, Inbound, Source: Any

Bei AWS / DigitalOcean / sonstigen: entsprechend in der Security-Group.

### 4. Live-Konfig anlegen + Container starten

acme-dns liest seine Konfig aus `infra/acme-dns/config.local.cfg`
(gitignored, von `git pull` unberührt). Einmalig aus der Vorlage anlegen
und deine echte Domain + IP eintragen:

```bash
cp infra/acme-dns/config.cfg infra/acme-dns/config.local.cfg
# config.local.cfg öffnen und ersetzen:
#   auth.example.com  → deine Auth-Subdomain (z.B. auth.lumio-cloud.de)
#   203.0.113.10      → deine öffentliche Server-IP
```

Dann acme-dns starten. Der Container liegt hinter dem Compose-Profile
`wildcard` und startet nur, wenn das Profile aktiv ist:

```bash
docker compose --profile wildcard \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  up -d acme_dns
```

> **Wichtig:** Ab jetzt brauchst du `--profile wildcard` bei **jedem**
> Deploy, sonst stoppt Compose den acme-dns-Container und die
> Wildcard-Zertifikate können nicht mehr erneuert werden. Dein
> Standard-Deploy-Befehl lautet also künftig:
>
> ```bash
> docker compose --profile wildcard \
>   -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml \
>   up -d --build
> ```

Verifizieren:

```bash
docker logs lumio_acme_dns --tail=10
```

Erwartet: `Starting DNS listener` und `Listening HTTP`, keine sqlite-Fehler.

### 5. DNS-Einträge beim Provider

Bei deinem DNS-Provider für Zone `lumio-cloud.de` (Beispiel-Domain — ersetze überall durch deine):

| Type | Hostname | Wert | TTL |
|---|---|---|---|
| A | `auth` | `DEINE.SERVER.IP` | 300 |
| NS | `auth` | `auth.lumio-cloud.de.` | 300 |

Wichtig: NS-Wert mit Punkt am Ende.

Nach ~5-10 Min Propagation testen:

```bash
dig auth.lumio-cloud.de +short              # → DEINE.SERVER.IP
dig NS auth.lumio-cloud.de +short            # → auth.lumio-cloud.de.
dig auth.lumio-cloud.de SOA                  # ANSWER mit auth.lumio-cloud.de.
```

Alle drei müssen vor dem nächsten Schritt funktionieren.

### 6. acme-dns-Account anlegen + CNAME setzen

```bash
docker exec lumio_acme_dns \
  wget -qO- --post-data='' --header='Content-Type: application/json' \
  http://localhost:80/register
```

Response (Beispiel):
```json
{
  "username": "6a1c4fbe-974b-...",
  "password": "oDfYLXqJmhy...",
  "subdomain": "af7bc62d-eac2-...",
  "fulldomain": "af7bc62d-eac2-....auth.lumio-cloud.de"
}
```

**Diese Werte sicher aufbewahren.** Sie sind einmalig generiert und nicht wieder abrufbar.

Bei deinem DNS-Provider einen CNAME ergänzen:

| Type | Hostname | Wert |
|---|---|---|
| CNAME | `_acme-challenge` | `<fulldomain>.` (mit Punkt am Ende) |

Propagation testen:

```bash
dig _acme-challenge.lumio-cloud.de +short
# → <fulldomain>.
```

### 7. Caddy konfigurieren

Credentials für Caddy ablegen:

```bash
mkdir -p infra/caddy/secrets
cat > infra/caddy/secrets/acmedns.json <<'EOF'
{
  "username": "6a1c4fbe-974b-...",
  "password": "oDfYLXqJmhy...",
  "subdomain": "af7bc62d-eac2-...",
  "fulldomain": "af7bc62d-eac2-....auth.lumio-cloud.de",
  "server_url": "http://acme_dns:80"
}
EOF
chmod 600 infra/caddy/secrets/acmedns.json
```

Wildcard-Host in `.env` aktivieren:

```bash
sed -i 's|^LUMIO_WILDCARD_HOST=.*|LUMIO_WILDCARD_HOST=*.lumio-cloud.de|' .env
```

Caddy mit Custom-Build neu starten (acme-dns-Plugin wird einkompiliert):

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  up -d --build caddy
```

Cert-Erteilung beobachten:

```bash
docker logs lumio_caddy -f --tail=30
```

Erwartet:
```
trying to solve challenge ... challenge_type=dns-01
authorization finalized ... authz_status=valid
certificate obtained successfully ... *.lumio-cloud.de
```

Dauert 30-90 Sek beim ersten Mal. Renewal danach läuft alle ~60 Tage vollautomatisch.

## Verifikation

```bash
curl -sI https://<beliebige-subdomain>.lumio-cloud.de | head -3
```

Sollte `HTTP/2 200` zurückgeben mit gültigem Cert (kein TLS-Warning).

## Troubleshooting

**`address already in use` bei `up -d acme_dns`**
Port 53 ist belegt. Prüfe `ss -tulnp | grep ':53'`. Falls systemd-resolved auf 127.0.0.53 hört — das ist okay, du musst nur an die externe IP binden (siehe Schritt 1). Falls ein anderer DNS-Server läuft (bind9, dnsmasq): stoppen.

**`sql: unknown driver "sqlite3"` in acme-dns Logs**
Das `joohoi/acme-dns:latest` Image hat keinen kompilierten sqlite3-Treiber mehr. Lumio nutzt deshalb Postgres — falls dein Setup noch auf sqlite konfiguriert ist, Postgres-DB anlegen (Schritt 2) und `infra/acme-dns/config.cfg` auf `engine = "postgres"` umstellen.

**`presenting DNS record` läuft auf timeout**
Der CNAME-Record propagiert noch nicht. `dig _acme-challenge.lumio-cloud.de +short` prüfen — muss auf `<fulldomain>.` zeigen. DNS-Propagation kann je nach Provider und vorherigem TTL bis zu 1 Stunde dauern.

**`tls.obtain: ... no DNS-01 challenge support`**
Caddy hat den acme-dns-Plugin nicht einkompiliert. Mit `docker compose ... up -d --build caddy` neu bauen — der Build nutzt `infra/caddy/Dockerfile` mit `xcaddy --with github.com/caddy-dns/acmedns`.

**`failed to set TXT record: 401 unauthorized`**
Credentials in `infra/caddy/secrets/acmedns.json` falsch. Doppelt prüfen — Username + Password müssen exakt aus dem `/register`-Output kommen, keine Whitespaces.

**Cert wird erteilt, aber Browser zeigt Warnung**
Caddy hat das neue Cert noch nicht serviert. `docker exec lumio_caddy caddy reload --config /etc/caddy/Caddyfile` oder Caddy neu starten.

## Architektur-Diagramm

```
Setup-DNS bei deinem Provider:
  auth.lumio-cloud.de        A      <SERVER-IP>
  auth.lumio-cloud.de        NS     auth.lumio-cloud.de.
  _acme-challenge.lumio...   CNAME  <fulldomain>.auth.lumio-cloud.de.


Renewal-Flow (alle 60 Tage):

  Let's Encrypt ──fragt──▶  Domainreselling-DNS (deine Zone)
                                    │
                                    │ folgt CNAME _acme-challenge → fulldomain
                                    ▼
                            acme-dns-Server (auf deinem Host)
                                    ▲
                                    │ schreibt TXT via HTTP-API
                                    │
  Caddy ────schreibt TXT─────────────┘
       (mit Credentials aus secrets/acmedns.json)
```

## Was acme-dns NICHT macht

- Hostet keine A/MX/anderen Records — der reine `_acme-challenge`-TXT-Vermittler
- Ist kein Replacement für deinen DNS-Provider — du brauchst weiter eine "echte" Zone für deine Hauptdomain
- Ist nicht für Custom-Domain-Certs zuständig — die laufen weiter über HTTP-01 (Standard-Caddy-Verhalten, keine Konfiguration nötig)
