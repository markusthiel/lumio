# Multi-Tenant-Setup

Lumio kann mehrere Tenants (Studios/Foto-Kunden) auf derselben
Installation betreiben. Dieses Dokument beschreibt, wie ein neuer
Tenant erreichbar wird — DB + UI legen ihn an, aber damit die richtige
URL auch beim richtigen Tenant landet, brauchst du eines der drei
Routing-Verfahren unten.

Wenn du gerade SaaS aufbaust und unter 20 Kunden hast, ist **Verfahren B
(Custom-Domains pro Kunde)** der empfohlene Weg. Wildcards lohnen sich
erst, wenn manuelles Caddyfile-Editieren pro Kunde lästig wird.

## Wie die Tenant-Auflösung funktioniert

Wenn ein API-Request reinkommt, läuft die Tenant-Auflösung in dieser
Reihenfolge ab (siehe `apps/api/src/plugins/auth.ts:resolveTenant`):

1. **Eingeloggter User** (Cookie) — die Session weiß welcher Tenant
2. **`X-Lumio-Tenant`-Header** — für die Mobile-App und API-Clients
3. **Custom-Domain** — `studio-mueller.de` matched gegen
   `tenants.customDomain`
4. **Subdomain** — `studio-mueller.lumio-cloud.de` matched gegen
   `tenants.slug`, vorausgesetzt `LUMIO_DOMAIN_BASE` ist gesetzt
5. **Single-Mode-Fallback** — wenn nur ein Tenant existiert, wird der
   genommen

Sobald du den zweiten Tenant anlegst, fällt Schritt 5 weg — du musst
2, 3 oder 4 nutzen.

---

## Verfahren B: Custom-Domains pro Kunde (empfohlen für die ersten Kunden)

Jeder Kunde bekommt seine eigene Domain wie `studio-mueller.de` oder
eine schöne Subdomain wie `mueller.lumio.app`. Pro Domain ein
Caddyfile-Block (am externen Caddy), Cert wird per HTTP-Challenge
automatisch geholt — kein DNS-Plugin nötig, läuft mit dem Stock-Caddy.

### Schritte für einen neuen Kunden

1. **DNS-Eintrag** — Kunde (oder du) zeigt seine Domain auf deine IP:
   ```
   studio-mueller.de    A    <IP des externen Caddy-Hosts>
   ```

2. **Externer Caddy** — Block ergänzen:
   ```caddyfile
   studio-mueller.de {
       reverse_proxy 192.168.178.90:32080
   }
   ```
   Dann `caddy reload` (oder Caddy-Container neu starten). Cert wird
   per HTTP-Challenge automatisch geholt sobald die Domain auflöst.

3. **Im Super-Admin** auf `https://studio.lumio-cloud.de/super/login`:
   - „+ Neuer Tenant"
   - Slug, Name, **Custom-Domain `studio-mueller.de`** eintragen
   - Owner-Name + Owner-E-Mail
   - „Anlegen + Einladen"

4. **Owner** klickt den Setup-Link in der Mail, setzt sein Passwort,
   ist eingeloggt. Ab dem Moment ist `https://studio-mueller.de` sein
   Studio.

Galerie-Links sind unabhängig davon — die nutzen den Galerie-Slug,
nicht den Tenant-Slug, und funktionieren auf der jeweiligen
Tenant-Domain (`studio-mueller.de/g/<gallery-slug>`).

### Wichtig: Interner Caddy hat einen Catch-All

Der interne Caddy (`infra/caddy/Caddyfile`) ist so konfiguriert dass
er einen `http://`-Catch-All-Block enthält, der für **jeden Host**
gilt der nicht spezifischer gematcht wird. Das ist genau das was
Custom-Domains brauchen — sonst würde Caddy für unbekannte Hosts
einen 308 nach `https://` schicken und damit (in Verbindung mit dem
externen Caddy) einen `ERR_TOO_MANY_REDIRECTS` produzieren.

**Du musst am internen Caddy NICHTS pro Kunde anpassen.** Der
Tenant-Auflösungs-Code in `apps/api/src/plugins/auth.ts` matcht
über den Host-Header gegen `tenants.customDomain`. Wenn die Domain
dort eingetragen ist, läuft alles automatisch.

### Wenn du noch keine Custom-Domain hast

Pro Kunde eine schöne Subdomain unter deiner eigenen Marke ist auch
OK — z.B. `mueller.lumio-cloud.de` als „interim" bis der Kunde sich
für eine Custom-Domain entscheidet. Jede solche Subdomain ist ein
eigener Caddyfile-Block mit eigenem Cert. Bei 5-10 Kunden völlig
problemlos.

---

## Verfahren A: Wildcard-Subdomain (`*.lumio-cloud.de`)

Sobald du SaaS-mäßig viele Kunden hast und das manuelle Caddyfile-
Editieren pro Kunde nervt, lohnt sich der Sprung auf Wildcards. Dann
ist `<slug>.lumio-cloud.de` automatisch der Studio-URL für jeden
Tenant, ohne Caddy-Reload pro neuem Kunde.

**Aber**: Wildcard-Zertifikate brauchen DNS-Challenge, weil
HTTP-Challenge `*.domain` nicht validieren kann. Du brauchst entweder
ein DNS-Plugin (für United Domains Reselling gibt's
[`KlettIT/caddy-autodns`](https://github.com/KlettIT/caddy-autodns) als
Drittanbieter-Plugin, müsste in den Caddy via xcaddy gebaut werden),
oder du nutzt acme-dns CNAME-Delegation.

Wenn du diesen Weg gehst, sind die Schritte:

1. **DNS** — Wildcard-A-Record `*.lumio-cloud.de` → IP
2. **Vorgeschalteter Caddy** — Wildcard-Block mit DNS-Challenge
3. **Interner Lumio-Caddy** — `LUMIO_WILDCARD_HOST=*.lumio-cloud.de:80`
   in `.env` setzen (Caddyfile-Block ist schon vorbereitet, siehe
   `infra/caddy/Caddyfile`)
4. **API-Env** — `LUMIO_DOMAIN_BASE=lumio-cloud.de`

Heute (Stand des ersten Onboardings) macht das keinen Aufwand-Sinn.
Wenn du soweit bist, schau dir diesen Abschnitt nochmal an oder frag
nach.

---

## Verfahren C: `X-Lumio-Tenant`-Header (für API-Clients)

Wird vor allem von der Mobile-App genutzt. Statt über Domain/Subdomain
spricht der Client direkt mit der API-URL und schickt einen Header mit:

```
GET /api/v1/galleries HTTP/1.1
Host: studio.lumio-cloud.de
X-Lumio-Tenant: studio-mueller
```

Wichtige Sicherheits-Eigenschaft: wenn ein Session-Cookie vorhanden
ist, **gewinnt der Tenant aus der Session**, nicht der Header. Sonst
könnte ein User mit Cookie für Tenant A einfach durch
Header-Manipulation auf Tenant B zugreifen.

Der Header wirkt also nur bei nicht-eingeloggten Requests (Login der
Mobile-App, API-Token-Auth).

---

## Default-Tenant umbenennen

Der erste Tenant, der per `npm run create-admin` angelegt wurde, heißt
slug=`default`. Wenn du eine echte Multi-Tenant-Plattform betreibst,
willst du das umbenennen:

- Super-Admin → Tenants → klick auf den Default-Tenant → Bearbeiten
- Slug ändern (Warnung wird angezeigt)
- Speichern

⚠ Bestehende Subdomain-URLs unter `default.lumio-cloud.de` brechen
sofort (falls Verfahren A aktiv). Galerie-Share-Links sind **nicht**
betroffen — die nutzen den Galerie-Slug, nicht den Tenant-Slug.
Eingeloggte Studio-Sessions des Tenants bleiben bestehen (Cookie
trägt tenantId, nicht slug).

---

## Welches Verfahren wofür

| Wofür                            | Verfahren                            |
|----------------------------------|--------------------------------------|
| Erste 1-20 Kunden, jeder mit eigener Brand-Domain | B (Custom-Domain) |
| 20+ Kunden, willst nicht mehr pro Kunde Caddy editieren | A (Wildcard) |
| Mobile-App                       | C (Header)                           |
| Browser-Studio                   | wird automatisch resolved via Cookie nach erstem Login |
| Customer-Galerie-Links           | funktioniert auf jeder Tenant-Domain |

Verfahren sind kombinierbar — ein Tenant kann gleichzeitig eine
Custom-Domain UND eine Wildcard-Subdomain UND Mobile-Header haben.
