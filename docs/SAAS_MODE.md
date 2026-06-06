**English** · [Deutsch](SAAS_MODE.de.md)

# SaaS mode

> ⚠️ **License note:** Multi-tenant use for **your own organization or agency** is unrestricted. But running Lumio as a **commercial SaaS for paying third parties** — exactly what this guide enables — is *Competing Use* and is **not** permitted out of the box under the FSL-1.1-ALv2. It needs a commercial license (it's the business model behind the maintainer's own lumio-cloud.de). See [LICENSE](../LICENSE).

Lumio can run not only as a single-studio tool but also as a complete SaaS platform: multiple tenants, Stripe billing, trials, self-signup. This guide describes the setup.

**Prerequisite:** the [production setup](SELFHOSTING.md) is successfully completed, Lumio runs behind your own domain with HTTPS.

---

## Concept

In SaaS mode:

- **DEPLOYMENT_MODE=multi** – one Lumio stack, many tenants
- Each tenant is a standalone studio with its own galleries, users, branding
- Trial period on sign-up (14 days full access)
- Stripe handles subscription management and payment
- The super admin manages the whole platform via `/super`

Plans (current definitions in `apps/api/src/services/plans.ts`):

| Plan | Storage | Price/month | Price/year |
|---|---|---|---|
| Trial | 50 GB | €0 (14 days) | – |
| Solo | 50 GB | €19 | €190 (2 months free) |
| Studio | 250 GB | €39 | €390 |
| Pro | 1 TB | (see plans.ts) | (see plans.ts) |

Plus an optional **storage pack** as an add-on for every plan.

---

## Setup

### 1. Enable multi mode

In `.env`:

```bash
DEPLOYMENT_MODE=multi
LUMIO_HOST=studio.your-saas-domain.com       # login domain for all tenants
BILLING_ENABLED=true
```

Then:

```bash
docker compose -f docker-compose.yml -f docker-compose.prod.yml up -d --build api worker
```

### 2. Prepare the Stripe account

- Create a Stripe account (or use an existing one)
- Use **test mode** until everything works – toggle the API keys at the top of the dashboard between test/live
- Copy the secret key: Developers → API Keys → Secret key (`sk_test_...` for test, `sk_live_...` for production)

### 3. Stripe in `.env`

```bash
STRIPE_SECRET_KEY=sk_test_...
STRIPE_PUBLISHABLE_KEY=pk_test_...
STRIPE_WEBHOOK_SECRET=                # stays empty for now, comes in step 5
BILLING_CURRENCY=EUR
```

Restart the API:

```bash
docker compose restart api
```

### 4. Create the plans in Stripe

Lumio ships a bootstrap script that creates all products and prices in Stripe and writes the IDs into the Lumio DB:

```bash
docker compose exec api npm run stripe-bootstrap
```

Output should be:
```
[stripe-bootstrap] ✓ Product 'Lumio Solo' synced
[stripe-bootstrap] ✓ Price 'plan_solo_monthly' created (price_xxx)
[stripe-bootstrap] ✓ Price 'plan_solo_yearly' created (price_xxx)
... (for Studio, Pro, storage pack)
```

In the Stripe Dashboard → Products you should now see three Lumio products.

The script is **idempotent** – running it multiple times is safe and only updates what has changed.

### 5. Set up the webhook

Stripe must inform Lumio when a payment goes through or a subscription is cancelled.

In the Stripe Dashboard → Developers → Webhooks → Add endpoint:

- **Endpoint URL:** `https://studio.your-saas-domain.com/api/billing/webhook`
- **Events:**
  - `customer.subscription.created`
  - `customer.subscription.updated`
  - `customer.subscription.deleted`
  - `customer.subscription.trial_will_end`
  - `invoice.payment_succeeded`
  - `invoice.payment_failed`
  - `checkout.session.completed`

After creating it, copy the "Signing secret" (`whsec_...`) → into `.env`:

```bash
STRIPE_WEBHOOK_SECRET=whsec_...
```

Restart the API:

```bash
docker compose restart api
```

Test: in the webhook detail in Stripe click "Send test webhook" → the event should appear in the API logs.

### 6. Create a super admin

```bash
docker compose exec api npm run create-super-admin -- \
  --email=ops@your-saas-domain.com \
  --password=atleast12chars \
  --name="Ops"
```

Password: at least 12 characters.

### 7. Test sign-up

On the marketing site (if deployed) go through the sign-up flow. Or directly:

→ `https://studio.your-saas-domain.com/signup`

The trial should start immediately, no Stripe payment needed at trial start.

Super admin area:

→ `https://studio.your-saas-domain.com/super`

Here you see all tenants, subscriptions, MRR.

---

## Going live

Once the test-mode setup runs stably:

1. In Stripe toggle "View test data" at the top left (back to live)
2. Copy the live secret and publishable key
3. In `.env` change `sk_test_...` → `sk_live_...` and `pk_test_...` → `pk_live_...`
4. **Create the webhook again** in live mode (live + test have separate webhooks)
5. Update `STRIPE_WEBHOOK_SECRET` with the new signing secret
6. **Run `stripe-bootstrap` again** – creates the products in live Stripe (test products stay in test mode)
7. Restart the API

---

## Tenant routing

In multi mode an important question arises: how does Lumio know which request belongs to which tenant?

Resolution happens in the API in this order:

1. **Logged-in user** – the session cookie points to the tenant
2. **`X-Lumio-Tenant` header** – for the mobile app and API clients
3. **Custom domain** – `client-photos.com` matched against `tenants.customDomain`
4. **Subdomain** – `studio-mueller.your-domain.com` (needs a wildcard cert, see [WILDCARD.md](WILDCARD.md))

**Recommendation for the start:** all tenants log in via `studio.your-saas-domain.com`. Tenant resolution then runs via the logged-in user. You can enable custom domains and subdomains later – see [MULTI_TENANT.md](MULTI_TENANT.md).

---

## Trial and subscription lifecycle

- **Sign-up** → tenant + user is created, the trial starts (14 days), no payment
- **Trial expires** → the user gets a UI banner, the `trial_will_end` webhook (3 days prior) triggers an email
- **Plan choice** → Stripe Checkout, afterwards the `checkout.session.completed` webhook sets the plan
- **Payment failed** → `invoice.payment_failed` → the tenant goes into `past_due`, after Stripe's retry logic into `suspended`
- **Suspended** → tenant login still works (to update the plan), but galleries are read-only
- **Cancel** → the tenant is marked in `tenants.archived`, not deleted immediately. The hard delete runs as a sweeper after a grace period.

Concrete implementation in `apps/api/src/services/billing.ts` and `apps/api/src/routes/billing.ts`.

---

## Setting up email sending

For trial reminders, payment-failed notifications, gallery invitations, etc. you need SMTP:

```bash
SMTP_HOST=smtp.your-mail.com
SMTP_PORT=587
SMTP_SECURE=false                    # STARTTLS, true for SMTPS on port 465
SMTP_USER=noreply@your-saas-domain.com
SMTP_PASSWORD=...
SMTP_FROM="Lumio <noreply@your-saas-domain.com>"
LEAD_ADMIN_EMAIL=ops@your-saas-domain.com
```

If `SMTP_HOST` stays empty, everything runs in no-op mode – trial emails aren't sent, the rest works normally.

Recommended providers: **Postmark** (transactional, high deliverability), **Mailjet** (EU servers, GDPR), **SES** (cheap, AWS-bound).

---

## Common errors

→ see [TROUBLESHOOTING.md – SaaS mode problems](TROUBLESHOOTING.md#saas-mode-problems)
