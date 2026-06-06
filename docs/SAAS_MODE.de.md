[English](SAAS_MODE.md) · **Deutsch**

# SaaS-Mode

Lumio kann nicht nur als Single-Studio-Tool, sondern auch als komplette SaaS-Plattform laufen: mehrere Tenants, Stripe-Abrechnung, Trials, Self-Signup. Dieser Guide beschreibt das Setup.

**Voraussetzung:** [Production-Setup](SELFHOSTING.de.md) ist erfolgreich abgeschlossen, Lumio läuft hinter eigener Domain mit HTTPS.

---

## Konzept

Im SaaS-Mode:

- **DEPLOYMENT_MODE=multi** – ein Lumio-Stack, viele Tenants
- Jeder Tenant ist ein eigenständiges Studio mit eigenen Galerien, Usern, Branding
- Trial-Period beim Sign-Up (14 Tage Vollzugriff)
- Stripe macht Subscription-Management und Payment
- Super-Admin verwaltet die ganze Plattform über `/super`

Pläne (Stand: aktuelle Definitionen in `apps/api/src/services/plans.ts`):

| Plan | Storage | Preis/Monat | Preis/Jahr |
|---|---|---|---|
| Trial | 50 GB | 0 € (14 Tage) | – |
| Solo | 50 GB | 19 € | 190 € (2 Monate gratis) |
| Studio | 250 GB | 39 € | 390 € |
| Pro | 1 TB | (siehe plans.ts) | (siehe plans.ts) |

Plus optionaler **Storage Pack** als Add-On für jeden Plan.

---

## Setup

### 1. Multi-Mode aktivieren

In der `.env`:

```bash
DEPLOYMENT_MODE=multi
LUMIO_HOST=studio.deine-saas-domain.de       # Login-Domain für alle Tenants
BILLING_ENABLED=true
```

Dann:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build api worker
```

### 2. Stripe-Account vorbereiten

- Stripe-Account anlegen (oder bestehenden nutzen)
- **Test-Modus** verwenden bis alles läuft – API-Keys oben im Dashboard zwischen Test/Live togglen
- Secret-Key kopieren: Developers → API Keys → Secret key (`sk_test_...` für Test, `sk_live_...` für Production)

### 3. Stripe in `.env`

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=                # bleibt erstmal leer, kommt in Schritt 5
BILLING_CURRENCY=EUR
```

API neu starten:

```bash
docker compose restart api
```

### 4. Pläne in Stripe anlegen

Lumio liefert ein Bootstrap-Script, das alle Products und Prices in Stripe anlegt und die IDs in die Lumio-DB schreibt:

```bash
docker compose exec api npm run stripe-bootstrap
```

Output sollte sein:
```
[stripe-bootstrap] ✓ Product 'Lumio Solo' synced
[stripe-bootstrap] ✓ Price 'plan_solo_monthly' created (price_xxx)
[stripe-bootstrap] ✓ Price 'plan_solo_yearly' created (price_xxx)
... (für Studio, Pro, Storage Pack)
```

Im Stripe Dashboard → Products solltest du jetzt drei Lumio-Produkte sehen.

Das Script ist **idempotent** – mehrfaches Ausführen ist sicher und aktualisiert nur was sich geändert hat.

### 5. Webhook einrichten

Stripe muss Lumio informieren wenn ein Payment durchläuft oder eine Subscription gekündigt wird.

Im Stripe Dashboard → Developers → Webhooks → Add endpoint:

- **Endpoint URL:** `https://studio.deine-saas-domain.de/api/billing/webhook`
- **Events:**
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.trial_will_end`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `checkout.session.completed`

Nach dem Anlegen "Signing secret" kopieren (`whsec_...`) → in `.env`:

```bash
STRIPE_WEBHOOK_SECRET=whsec_...
```

API neu starten:

```bash
docker compose restart api
```

Test: im Webhook-Detail in Stripe auf "Send test webhook" → in den API-Logs sollte das Event auftauchen.

### 6. Super-Admin anlegen

```bash
docker compose exec api npm run create-super-admin -- \
  --email=ops@deine-saas-domain.de \
  --password=mindestens12zeichen \
  --name="Ops"
```

Passwort: mindestens 12 Zeichen.

### 7. Sign-Up testen

Auf der Marketing-Site (falls deployed) den Sign-Up-Flow durchlaufen. Oder direkt:

→ `https://studio.deine-saas-domain.de/signup`

Trial sollte sofort starten, kein Stripe-Payment beim Trial-Start nötig.

Super-Admin-Bereich:

→ `https://studio.deine-saas-domain.de/super`

Hier siehst du alle Tenants, Subscriptions, MRR.

---

## Live-Switch

Wenn Test-Mode-Setup stabil läuft:

1. In Stripe oben links auf "View test data" toggeln (zurück zu Live)
2. Live-Secret und Publishable-Key kopieren
3. In `.env` `sk_test_...` → `sk_live_...` und `pk_test_...` → `pk_live_...`
4. **Webhook neu anlegen** im Live-Modus (Live + Test haben getrennte Webhooks)
5. `STRIPE_WEBHOOK_SECRET` mit dem neuen Signing-Secret aktualisieren
6. **`stripe-bootstrap` nochmal laufen lassen** – legt Products in Live-Stripe an (Test-Products bleiben im Test-Mode)
7. API neu starten

---

## Tenant-Routing

Im Multi-Mode kommt eine wichtige Frage: woher weiß Lumio, welcher Request zu welchem Tenant gehört?

Die Auflösung passiert in der API in dieser Reihenfolge:

1. **Eingeloggter User** – Session-Cookie verweist auf Tenant
2. **`X-Lumio-Tenant`-Header** – für Mobile-App und API-Clients
3. **Custom-Domain** – `kunden-fotos.de` matched gegen `tenants.customDomain`
4. **Subdomain** – `studio-mueller.deine-domain.de` (braucht Wildcard-Cert, siehe [WILDCARD.md](WILDCARD.de.md))

**Empfehlung für den Start:** alle Tenants login per `studio.deine-saas-domain.de`. Die Tenant-Auflösung läuft dann über den eingeloggten User. Custom-Domains und Subdomains kannst du später aktivieren – siehe MULTI_TENANT.md.

---

## Trial- und Subscription-Lifecycle

- **Sign-Up** → Tenant + User wird angelegt, Trial startet (14 Tage), keine Zahlung
- **Trial läuft ab** → User bekommt UI-Banner, Webhook `trial_will_end` (3 Tage vorher) löst E-Mail aus
- **Plan-Wahl** → Stripe Checkout, anschließend `checkout.session.completed`-Webhook setzt Plan
- **Payment fehlgeschlagen** → `invoice.payment_failed` → Tenant geht in `past_due`, nach Stripe-Retry-Logik in `suspended`
- **Suspended** → Tenant-Login funktioniert noch (zum Plan-Update), aber Galerien sind read-only
- **Cancel** → Tenant wird in `tenants.archived` markiert, nicht sofort gelöscht. Hard-Delete läuft als Sweeper nach Karenzfrist.

Konkrete Implementierung in `apps/api/src/services/billing.ts` und `apps/api/src/routes/billing.ts`.

---

## E-Mail-Versand einrichten

Für Trial-Reminder, Payment-Failed-Notifications, Galerie-Einladungen usw. brauchst du SMTP:

```bash
SMTP_HOST=smtp.deine-mail.de
SMTP_PORT=587
SMTP_SECURE=false                    # STARTTLS, true für SMTPS auf Port 465
SMTP_USER=noreply@deine-saas-domain.de
SMTP_PASSWORD=...
SMTP_FROM="Lumio <noreply@deine-saas-domain.de>"
LEAD_ADMIN_EMAIL=ops@deine-saas-domain.de
```

Wenn `SMTP_HOST` leer bleibt, läuft alles im No-Op-Modus – Trial-Mails werden nicht versendet, der Rest funktioniert normal.

Empfohlene Provider: **Postmark** (transactional, hohe Deliverability), **Mailjet** (DE-Server, DSGVO), **SES** (günstig, AWS-Bindung).

---

## Häufige Fehler

→ siehe [TROUBLESHOOTING.md – SaaS-Mode-Probleme](TROUBLESHOOTING.de.md#saas-mode-probleme)
