**English** · [Deutsch](MULTI_TENANT.de.md)

# Multi-tenant setup

> ⚠️ **License note:** Running Lumio multi-tenant for **your own organization or an agency** (several brands/clients you operate yourself) is unrestricted. Offering Lumio as a **commercial SaaS to third parties** that competes with the maintainer's hosted service is *Competing Use* and is **not** permitted out of the box under the FSL-1.1-ALv2 — that requires a commercial license. See [LICENSE](../LICENSE).

Lumio can run multiple tenants (studios/photographer clients) on the same installation. This document describes how a new tenant becomes reachable — the DB + UI create it, but for the right URL to land on the right tenant you need one of the three routing methods below.

If you're building SaaS and have fewer than 20 clients, **method B (custom domains per client)** is the recommended path. Wildcards only pay off once editing the Caddyfile manually per client becomes tedious.

## How tenant resolution works

When an API request comes in, tenant resolution runs in this order (see `apps/api/src/plugins/auth.ts:resolveTenant`):

1. **Logged-in user** (cookie) — the session knows which tenant
2. **`X-Lumio-Tenant` header** — for the mobile app and API clients
3. **Custom domain** — `studio-mueller.de` matched against `tenants.customDomain`
4. **Subdomain** — `studio-mueller.lumio-cloud.de` matched against `tenants.slug`, provided `LUMIO_DOMAIN_BASE` is set
5. **Single-mode fallback** — if only one tenant exists, it's used

As soon as you create the second tenant, step 5 drops out — you have to use 2, 3 or 4.

---

## Method B: Custom domains per client (recommended for the first clients)

Each client gets their own domain like `studio-mueller.de` or a nice subdomain like `mueller.lumio.app`. One Caddyfile block per domain (on the external Caddy), the cert is obtained automatically via the HTTP challenge — no DNS plugin needed, works with stock Caddy.

### Steps for a new client

1. **DNS record** — the client (or you) points their domain at your IP:
   ```
   studio-mueller.de    A    <IP of the external Caddy host>
   ```

2. **External Caddy** — add a block:
   ```caddyfile
   studio-mueller.de {
       reverse_proxy 192.168.178.90:32080
   }
   ```
   Then `caddy reload` (or restart the Caddy container). The cert is obtained automatically via the HTTP challenge as soon as the domain resolves.

3. **In the super admin** at `https://studio.lumio-cloud.de/super/login`:
   - "+ New tenant"
   - Enter slug, name, **custom domain `studio-mueller.de`**
   - Owner name + owner email
   - "Create + invite"

4. **The owner** clicks the setup link in the email, sets their password, is logged in. From that moment `https://studio-mueller.de` is their studio.

Gallery links are independent of this — they use the gallery slug, not the tenant slug, and work on the respective tenant domain (`studio-mueller.de/g/<gallery-slug>`).

### Important: the internal Caddy has a catch-all

The internal Caddy (`infra/caddy/Caddyfile`) is configured to contain an `http://` catch-all block that applies to **any host** not matched more specifically. That's exactly what custom domains need — otherwise Caddy would send a 308 to `https://` for unknown hosts and thereby (in combination with the external Caddy) produce an `ERR_TOO_MANY_REDIRECTS`.

**You don't need to change anything per client on the internal Caddy.** The tenant resolution code in `apps/api/src/plugins/auth.ts` matches against `tenants.customDomain` via the Host header. If the domain is entered there, everything runs automatically.

### If you don't have a custom domain yet

A nice subdomain under your own brand per client is also fine — e.g. `mueller.lumio-cloud.de` as an "interim" until the client decides on a custom domain. Each such subdomain is its own Caddyfile block with its own cert. With 5-10 clients completely fine.

---

## Method A: Wildcard subdomain (`*.lumio-cloud.de`)

Once you have many SaaS-style clients and editing the Caddyfile manually per client gets annoying, the jump to wildcards pays off. Then `<slug>.lumio-cloud.de` is automatically the studio URL for every tenant, without a Caddy reload per new client.

**But**: wildcard certificates need the DNS challenge, because the HTTP challenge can't validate `*.domain`. You need either a DNS plugin (for United Domains Reselling there's [`KlettIT/caddy-autodns`](https://github.com/KlettIT/caddy-autodns) as a third-party plugin, which would have to be built into Caddy via xcaddy), or you use acme-dns CNAME delegation.

If you go this route, the steps are:

1. **DNS** — wildcard A record `*.lumio-cloud.de` → IP
2. **Upstream Caddy** — wildcard block with the DNS challenge
3. **Internal Lumio Caddy** — set `LUMIO_WILDCARD_HOST=*.lumio-cloud.de:80` in `.env` (the Caddyfile block is already prepared, see `infra/caddy/Caddyfile`)
4. **API env** — `LUMIO_DOMAIN_BASE=lumio-cloud.de`

The full walkthrough is in [WILDCARD.md](WILDCARD.md). For the very first onboarding this isn't worth the effort yet — come back to this section when you're ready, or ask.

---

## Method C: `X-Lumio-Tenant` header (for API clients)

Used mainly by the mobile app. Instead of going via domain/subdomain, the client talks directly to the API URL and sends a header:

```
GET /api/v1/galleries HTTP/1.1
Host: studio.lumio-cloud.de
X-Lumio-Tenant: studio-mueller
```

Important security property: if a session cookie is present, **the tenant from the session wins**, not the header. Otherwise a user with a cookie for tenant A could simply access tenant B through header manipulation.

So the header only takes effect on non-logged-in requests (mobile app login, API token auth).

---

## Renaming the default tenant

The first tenant, created via `npm run create-admin`, has slug=`default`. If you run a real multi-tenant platform, you'll want to rename it:

- Super admin → Tenants → click the default tenant → Edit
- Change the slug (a warning is shown)
- Save

⚠ Existing subdomain URLs under `default.lumio-cloud.de` break immediately (if method A is active). Gallery share links are **not** affected — they use the gallery slug, not the tenant slug. Logged-in studio sessions of the tenant remain valid (the cookie carries tenantId, not slug).

---

## Which method for what

| For what                            | Method                            |
|----------------------------------|--------------------------------------|
| First 1-20 clients, each with their own brand domain | B (custom domain) |
| 20+ clients, no longer want to edit Caddy per client | A (wildcard) |
| Mobile app                       | C (header)                           |
| Browser studio                   | resolved automatically via cookie after first login |
| Customer gallery links           | works on any tenant domain |

The methods are combinable — one tenant can have a custom domain AND a wildcard subdomain AND a mobile header at the same time.
