# Multi-Tenant-Setup

Lumio kann mehrere Tenants (Studios/Foto-Kunden) auf derselben
Installation betreiben. Dieses Dokument beschreibt, wie ein neuer
Tenant erreichbar wird — DB + UI legen ihn an, aber damit die richtige
URL auch beim richtigen Tenant landet, brauchst du eines der drei
Routing-Verfahren unten.

## Drei Wege zum Tenant

Wenn ein API-Request reinkommt, läuft die Tenant-Auflösung in dieser
Reihenfolge:

1. **Eingeloggter User** (Cookie) — die Session weiß welcher Tenant
2. **X-Lumio-Tenant-Header** — für die Mobile-App und API-Clients
3. **Custom-Domain** — `studio-mueller.de` matched gegen
   `tenants.customDomain`
4. **Subdomain** — `studio-mueller.lumio-cloud.de` matched gegen
   `tenants.slug`, vorausgesetzt `LUMIO_DOMAIN_BASE=lumio-cloud.de`
5. **Single-Mode-Fallback** — wenn nur ein Tenant existiert, wird der
   genommen

Sobald du den zweiten Tenant anlegst, fällt Schritt 5 weg — du musst
2, 3 oder 4 nutzen.

## Verfahren A: Subdomains (empfohlen für SaaS-Mode)

Jeder Tenant bekommt automatisch `<slug>.lumio-cloud.de` als Studio-URL.
Customer-Galerien sind weiter unter beliebigen URLs erreichbar (siehe
KONZEPT.md), aber das Studio liegt klar pro Tenant.

### Drei Stellen, die zusammenspielen müssen

Setup an drei Punkten, damit ein Request bei `markus.lumio-cloud.de`
auch wirklich bei Tenant `markus` landet:

1. **DNS** — Wildcard-A-Record `*.lumio-cloud.de` → IP des Proxy-Hosts
2. **Vorgeschalteter Caddy** (TLS-Terminierung, deine externe Instanz)
   bekommt einen Wildcard-Block neben dem bestehenden
   `lumio-cloud.de`-Block
3. **Interner Lumio-Caddy** (im docker-compose) bekommt einen
   Wildcard-Block, der die gleichen reverse_proxy-Regeln wie die
   Hauptdomain anwendet — sonst fällt der Request beim
   Host-Header-Matching durch

### 1. DNS

Wildcard-Eintrag bei deinem DNS-Provider:

```
*.lumio-cloud.de    A    <IP deines Caddy-Hosts>
```

### 2. Vorgeschalteter Caddy

Aktuell siehst du in deinem Caddyfile wahrscheinlich sowas:

```caddyfile
lumio-cloud.de {
    reverse_proxy 192.168.178.90:32080
}

s3.lumio-cloud.de {
    reverse_proxy 192.168.178.90:32080
}
```

Ergänzen um einen Wildcard. Caddy matched spezifische Host-Blöcke
(`s3.lumio-cloud.de`) immer **vor** Wildcards, also kollidiert
der neue Block nicht mit dem S3-Subdomain-Eintrag.

```caddyfile
*.lumio-cloud.de {
    tls {
        # Wildcard-Zertifikate brauchen DNS-Challenge —
        # HTTP-Challenge kann *.domain nicht validieren.
        # Hier den passenden Block für deinen DNS-Provider:
        #
        #   dns cloudflare {env.CLOUDFLARE_API_TOKEN}
        #   dns hetzner    {env.HETZNER_API_TOKEN}
        #   dns inwx       {env.INWX_USER} {env.INWX_PASSWORD}
        #
        # caddy-dns-Plugins: https://github.com/caddy-dns
        # Plugin muss ins Caddy-Image kompiliert sein (xcaddy build).
    }
    reverse_proxy 192.168.178.90:32080
}
```

### 3. Interner Lumio-Caddy

In der `.env` (oder direkt im docker-compose):

```
LUMIO_WILDCARD_HOST=*.lumio-cloud.de:80
```

Der interne Caddy ist hinter dem vorgeschalteten Proxy, hört nur auf
:80 (kein TLS hier). `infra/caddy/Caddyfile` enthält bereits einen
Wildcard-Block, der nur aktiv wird wenn `LUMIO_WILDCARD_HOST` gesetzt
ist.

### 4. API-Env

```
LUMIO_DOMAIN_BASE=lumio-cloud.de
PUBLIC_URL=https://lumio-cloud.de
```

`LUMIO_DOMAIN_BASE` aktiviert in der API die Subdomain-basierte
Tenant-Auflösung. Ohne diese Variable ignoriert die API den
Subdomain-Teil und fällt auf den Header- oder Custom-Domain-Resolver
zurück.

### Test

```bash
curl -H "Host: markus.lumio-cloud.de" http://192.168.178.90:32080/health
# sollte 200 zurückgeben

# Im Browser: https://markus.lumio-cloud.de/login
# → Studio-Login für Tenant 'markus'
```

## Verfahren B: Custom-Domains (für White-Label)

Jeder Tenant bekommt eine eigene Domain wie `studio-mueller.de`. Im
Super-Admin trägst du die Custom-Domain ein; in Caddy musst du sie
einmalig erlauben.

### Pro Custom-Domain im Caddyfile:

```caddyfile
studio-mueller.de {
    reverse_proxy /api/* docker5:3001
    reverse_proxy /ws/* docker5:3001
    reverse_proxy * docker5:3000
}
```

Caddy holt automatisch ein Let's-Encrypt-Cert per HTTP-Challenge —
DNS-Eintrag der Domain muss auf docker5 zeigen, bevor du den Caddy
reloadest.

### Im Super-Admin

Tenant-Detail → Bearbeiten → Custom-Domain eintragen → Speichern.

### Geplant für später

Caddy `auto_https on_demand` mit Lumio als Validation-Endpoint —
dann reicht der Super-Admin-Eintrag, Caddy fragt bei jedem
unbekannten Host nach „darf ich für den ein Cert holen?". Spart das
manuelle Caddyfile-Editieren. Heute noch nicht implementiert.

## Verfahren C: X-Lumio-Tenant-Header

Wird vor allem von der Mobile-App und API-Clients genutzt. Statt
über Domain/Subdomain spricht der Client direkt mit der API-URL
(z.B. `lumio-cloud.de` oder `api.lumio-cloud.de`) und schickt einen
Header mit:

```
GET /api/v1/galleries HTTP/1.1
Host: lumio-cloud.de
X-Lumio-Tenant: studio-mueller
Cookie: lumio_session=...
```

Wichtige Sicherheits-Eigenschaft: wenn ein Session-Cookie vorhanden
ist, **gewinnt der Tenant aus der Session**, nicht der Header. Sonst
könnte ein User mit Cookie für Tenant A einfach durch
Header-Manipulation auf Tenant B zugreifen.

Der Header wirkt also nur bei nicht-eingeloggten Requests (z.B.
Login-Request der Mobile-App, oder bei API-Token-Auth wo der Token
selbst einen Tenant trägt).

## Workflow für einen neuen Tenant

1. Super-Admin auf `https://lumio-cloud.de/super/login` einloggen
2. „Tenants" → „+ Neuer Tenant"
3. Slug wählen (z.B. `studio-mueller`)
4. Name eingeben (z.B. „Studio Müller")
5. Optional Custom-Domain (z.B. `studio-mueller.de`)
6. Owner-Name + Owner-E-Mail
7. „Anlegen + Einladen" → Setup-Link wird angezeigt und an Owner
   per Mail geschickt
8. Owner klickt Link → setzt Passwort → landet im Studio

Bei **Subdomain-Setup** (A): erreichbar unter `studio-mueller.lumio-cloud.de`

Bei **Custom-Domain** (B): muss zusätzlich Caddyfile-Block angelegt
+ `caddy reload` ausgeführt werden, dann DNS warten, dann erreichbar
unter `https://studio-mueller.de`

## Default-Tenant umbenennen

Der erste Tenant, der per `npm run create-admin` angelegt wurde,
heißt slug=`default`. Wenn du eine echte Multi-Tenant-Plattform
betreibst, willst du das umbenennen:

- Super-Admin → Tenants → klick auf den Default-Tenant → Bearbeiten
- Slug ändern (Warnung wird angezeigt)
- Speichern

⚠ Bestehende Subdomain-URLs unter `default.lumio-cloud.de` brechen
sofort. Galerie-Share-Links sind nicht betroffen — die nutzen den
Galerie-Slug, nicht den Tenant-Slug. Eingeloggte Studio-Sessions
des Tenants bleiben bestehen (Cookie trägt tenantId, nicht slug).
