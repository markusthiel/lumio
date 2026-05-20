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

### DNS

Wildcard-Eintrag bei deinem DNS-Provider:

```
*.lumio-cloud.de    A    <IP von docker5>
```

(Bei Cloudflare ein „Proxied" + ein A-Record für `*`.)

### Caddy

In deinem bestehenden Caddyfile (oder caddy.yaml) einen Wildcard-Block
ergänzen. Beispiel:

```caddyfile
*.lumio-cloud.de, lumio-cloud.de {
    tls {
        # DNS-Challenge für das Wildcard-Cert, sonst kein *.cert möglich.
        # Für Cloudflare:
        dns cloudflare {env.CLOUDFLARE_API_TOKEN}
    }

    reverse_proxy /api/* docker5:3001
    reverse_proxy /ws/* docker5:3001
    reverse_proxy * docker5:3000
}
```

Wichtig: das Wildcard-Cert braucht eine DNS-Challenge (HTTP-Challenge
kann keine `*.domain` validieren). Für Cloudflare nutze das offizielle
Caddy-DNS-Plugin.

### API-Env

In der `docker-compose.yml` (oder `.env`) für den API-Container:

```
LUMIO_DOMAIN_BASE=lumio-cloud.de
PUBLIC_URL=https://lumio-cloud.de
```

Dann ist `<slug>.lumio-cloud.de/login` automatisch der Studio-Login für
jeden Tenant. Setup-Links in Einladungs-Mails zeigen weiter auf die
Hauptdomain (`PUBLIC_URL/auth/setup-password?token=...`) — nach dem
Passwort-Setzen ist der User eingeloggt, die Session enthält die
Tenant-ID, alle weiteren Requests landen beim richtigen Tenant
unabhängig von der URL.

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
