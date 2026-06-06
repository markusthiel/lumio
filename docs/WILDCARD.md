**English** · [Deutsch](WILDCARD.de.md)

# Wildcard certificates for tenant subdomains

If you run Lumio in **multi mode** with tenant subdomains (e.g. `saro.lumio-cloud.de`, `acme.lumio-cloud.de`), you need a wildcard certificate for `*.lumio-cloud.de`. Here's the clean solution — works with **any** DNS provider, even if it has no API.

> For **single mode** (one domain, one studio) and **custom domains** (the client points their own domain at your IP) this is **not** needed. Caddy automatically obtains standard certs for the single main domain and for custom domains via HTTP-01.

## Why not a direct DNS plugin?

Let's Encrypt requires a DNS-01 challenge for wildcards — Caddy must be able to set a TXT record `_acme-challenge.lumio-cloud.de`. Directly that only works with DNS provider API plugins (Cloudflare, Route53, etc.). Many providers (domain reselling, Strato, IONOS without a premium plan) have no API access or require premium plans. Solution: **acme-dns** as an intermediary.

## How acme-dns works

`acme-dns` is a tiny DNS server that only serves `_acme-challenge` TXT records. You delegate exactly this one record to your acme-dns server, everything else stays with your main provider. Advantages:

- **Provider-agnostic:** you need no API access
- **Secure:** if the acme-dns credentials are compromised, the attacker can only change `_acme-challenge`, not your main DNS records
- **Standard component:** Caddy has an official plugin, has been running in production for years

Lumio ships acme-dns as a Docker service (`lumio_acme_dns`) — you only need to set it up once.

## Requirements

- Lumio runs in multi mode
- You have a domain (e.g. `lumio-cloud.de`) at any DNS provider
- Port 53 UDP+TCP is reachable from outside on your server (open the cloud firewall if needed)
- You know your server's public IP

## Setup in 6 steps

### 1. Defuse systemd-resolved (Ubuntu/Debian)

On Ubuntu, `systemd-resolved` listens on `127.0.0.53:53`. Linux then forbids `0.0.0.0:53` binds — even though that's only loopback. We therefore bind acme-dns explicitly to the external server IP instead of 0.0.0.0:

```bash
# Add the server IP to .env
echo "ACME_DNS_BIND_IP=YOUR.SERVER.IP" >> .env
```

systemd-resolved keeps running normally, acme-dns listens on the external IP. No conflict.

### 2. Create a Postgres DB for acme-dns

On a fresh setup the init script `02-acme-dns.sql` does this automatically. On an existing Postgres (volume already exists) do it manually:

```bash
docker compose exec postgres psql -U lumio -d postgres -c \
  "CREATE USER acme_dns WITH PASSWORD 'acme_dns_local_pw';"
docker compose exec postgres psql -U lumio -d postgres -c \
  "CREATE DATABASE acme_dns OWNER acme_dns;"
docker compose exec postgres psql -U lumio -d postgres -c \
  "GRANT ALL PRIVILEGES ON DATABASE acme_dns TO acme_dns;"
```

### 3. Cloud firewall: open port 53

On Hetzner Cloud Console → Firewalls → Add Rule:
- TCP 53, inbound, source: Any
- UDP 53, inbound, source: Any

On AWS / DigitalOcean / others: accordingly in the security group.

### 4. Create the live config + start the container

acme-dns reads its config from `infra/acme-dns/config.local.cfg` (gitignored, untouched by `git pull`). Create it once from the template and enter your real domain + IP:

```bash
cp infra/acme-dns/config.cfg infra/acme-dns/config.local.cfg
# Open config.local.cfg and replace:
#   auth.example.com  → your auth subdomain (e.g. auth.lumio-cloud.de)
#   203.0.113.10      → your public server IP
```

Then start acme-dns. The container sits behind the Compose profile `wildcard` and only starts when the profile is active:

```bash
docker compose --profile wildcard \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  up -d acme_dns
```

> **Important:** from now on you need `--profile wildcard` on **every** deploy, otherwise Compose stops the acme-dns container and the wildcard certificates can no longer be renewed. So your standard deploy command from now on is:
>
> ```bash
> docker compose --profile wildcard \
>   -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml \
>   up -d --build
> ```

Verify:

```bash
docker logs lumio_acme_dns --tail=10
```

Expected: `Starting DNS listener` and `Listening HTTP`, no sqlite errors.

### 5. DNS records at the provider

At your DNS provider for the zone `lumio-cloud.de` (example domain — replace everywhere with yours):

| Type | Hostname | Value | TTL |
|---|---|---|---|
| A | `auth` | `YOUR.SERVER.IP` | 300 |
| NS | `auth` | `auth.lumio-cloud.de.` | 300 |

Important: the NS value with a trailing dot.

After ~5-10 min of propagation, test:

```bash
dig auth.lumio-cloud.de +short              # → YOUR.SERVER.IP
dig NS auth.lumio-cloud.de +short            # → auth.lumio-cloud.de.
dig auth.lumio-cloud.de SOA                  # ANSWER with auth.lumio-cloud.de.
```

All three must work before the next step.

### 6. Create the acme-dns account + set the CNAME

```bash
docker exec lumio_acme_dns \
  wget -qO- --post-data='' --header='Content-Type: application/json' \
  http://localhost:80/register
```

Response (example):
```json
{
  "username": "6a1c4fbe-974b-...",
  "password": "oDfYLXqJmhy...",
  "subdomain": "af7bc62d-eac2-...",
  "fulldomain": "af7bc62d-eac2-....auth.lumio-cloud.de"
}
```

**Keep these values safe.** They're generated once and not retrievable again.

At your DNS provider add a CNAME:

| Type | Hostname | Value |
|---|---|---|
| CNAME | `_acme-challenge` | `<fulldomain>.` (with a trailing dot) |

Test propagation:

```bash
dig _acme-challenge.lumio-cloud.de +short
# → <fulldomain>.
```

### 7. Configure Caddy

Store the credentials for Caddy:

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

Enable the wildcard host in `.env`:

```bash
sed -i 's|^LUMIO_WILDCARD_HOST=.*|LUMIO_WILDCARD_HOST=*.lumio-cloud.de|' .env
```

Restart Caddy with a custom build (the acme-dns plugin gets compiled in):

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  up -d --build caddy
```

Watch the cert issuance:

```bash
docker logs lumio_caddy -f --tail=30
```

Expected:
```
trying to solve challenge ... challenge_type=dns-01
authorization finalized ... authz_status=valid
certificate obtained successfully ... *.lumio-cloud.de
```

Takes 30-90 sec the first time. Renewal afterwards runs fully automatically every ~60 days.

## Verification

```bash
curl -sI https://<any-subdomain>.lumio-cloud.de | head -3
```

Should return `HTTP/2 200` with a valid cert (no TLS warning).

## Troubleshooting

**`address already in use` on `up -d acme_dns`**
Port 53 is taken. Check `ss -tulnp | grep ':53'`. If systemd-resolved listens on 127.0.0.53 — that's fine, you just have to bind to the external IP (see step 1). If another DNS server is running (bind9, dnsmasq): stop it.

**`sql: unknown driver "sqlite3"` in the acme-dns logs**
The `joohoi/acme-dns:latest` image no longer has a compiled sqlite3 driver. Lumio therefore uses Postgres — if your setup is still configured for sqlite, create the Postgres DB (step 2) and switch `infra/acme-dns/config.cfg` to `engine = "postgres"`.

**`presenting DNS record` times out**
The CNAME record isn't propagating yet. Check `dig _acme-challenge.lumio-cloud.de +short` — it must point to `<fulldomain>.`. DNS propagation can take up to 1 hour depending on the provider and the previous TTL.

**`tls.obtain: ... no DNS-01 challenge support`**
Caddy doesn't have the acme-dns plugin compiled in. Rebuild with `docker compose ... up -d --build caddy` — the build uses `infra/caddy/Dockerfile` with `xcaddy --with github.com/caddy-dns/acmedns`.

**`failed to set TXT record: 401 unauthorized`**
The credentials in `infra/caddy/secrets/acmedns.json` are wrong. Double-check — username + password must come exactly from the `/register` output, no whitespace.

**Cert is issued, but the browser shows a warning**
Caddy hasn't served the new cert yet. `docker exec lumio_caddy caddy reload --config /etc/caddy/Caddyfile` or restart Caddy.

## Architecture diagram

```
Setup DNS at your provider:
  auth.lumio-cloud.de        A      <SERVER-IP>
  auth.lumio-cloud.de        NS     auth.lumio-cloud.de.
  _acme-challenge.lumio...   CNAME  <fulldomain>.auth.lumio-cloud.de.


Renewal flow (every 60 days):

  Let's Encrypt ──asks──▶  domain-reselling DNS (your zone)
                                    │
                                    │ follows CNAME _acme-challenge → fulldomain
                                    ▼
                            acme-dns server (on your host)
                                    ▲
                                    │ writes TXT via HTTP API
                                    │
  Caddy ────writes TXT───────────────┘
       (with credentials from secrets/acmedns.json)
```

## What acme-dns does NOT do

- Doesn't host A/MX/other records — it's the pure `_acme-challenge` TXT intermediary
- Is not a replacement for your DNS provider — you still need a "real" zone for your main domain
- Is not responsible for custom-domain certs — those keep running via HTTP-01 (standard Caddy behavior, no configuration needed)
