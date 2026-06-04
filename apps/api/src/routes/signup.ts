/**
 * Lumio API — Sign-up Routes
 *
 * Öffentliche Self-Service-Registrierung. Wird vom lumio-cloud.de
 * Marketing-Site aufgerufen (Astro Form → POST /signup). Erstellt:
 *   1. Tenant-Row (slug aus E-Mail-Lokalteil oder Name)
 *   2. Owner-User-Row
 *   3. Stripe-Customer
 *   4. Stripe-Checkout-Session (mode=subscription, mit 14-Tage-Trial)
 *
 * Returnt die Checkout-URL — Browser redirected den User dorthin. Nach
 * erfolgreichem Checkout sendet Stripe checkout.session.completed +
 * customer.subscription.created Events, die unser Worker verarbeitet
 * (siehe billing.py).
 *
 * E-Mail-Verification: NICHT in diesem Flow. Vertrauen wir der Stripe-
 * Karte als implizite Verification — wer eine 1-EUR-Reservation
 * bestätigen kann, hat eine valide E-Mail. Falls später zwingend
 * nötig: separater Verify-Flow per Magic-Link.
 *
 * Welcome-E-Mail kommt vom Stripe-Hosted-Receipt + unserer Lifecycle-
 * Mail (Sprint 2 Phase 3).
 */
import type { FastifyInstance } from "fastify";
import type Stripe from "stripe";
import { z } from "zod";
import { prisma } from "../db.js";
import { config } from "../config.js";
import { hashPassword, createSession } from "../services/auth.js";
import { SESSION_COOKIE } from "../plugins/auth.js";
import { getStripe, isStripeEnabled } from "../services/stripe-client.js";
import { verifyTurnstile } from "../services/turnstile.js";
import { sendWelcomeMail } from "../services/notifier.js";
import { notifySuperAdminsNewTenant } from "../services/notifier.js";
import {
  PLANS,
  planLookupKey,
  type PlanSlug,
} from "../services/plans.js";
import {
  RESERVED_SLUGS,
  suggestSlug,
  validateSlugFormat,
} from "../services/slugs.js";

const signupSchema = z.object({
  email: z.string().email().toLowerCase().max(200),
  password: z.string().min(8).max(200),
  studioName: z.string().min(1).max(120),
  // optional, aber UX-mäßig sinnvoll für die Mailing-Anrede
  name: z.string().max(120).optional(),
  // Slug optional — wenn der User auf der Marketing-Site einen wählt,
  // nehmen wir den (nach Validation). Sonst leiten wir aus studioName ab.
  slug: z.string().min(3).max(30).optional(),
  // Plan + Intervall — Default ist studio/monthly wenn nicht spezifiziert.
  // Trial ist nicht direkt wählbar (entsteht automatisch in der ersten
  // Subscription mit trial_period_days=14).
  plan: z.enum(["start", "solo", "studio", "pro"]).default("solo"),
  interval: z.enum(["monthly", "yearly"]).default("monthly"),
  // Cloudflare-Turnstile-Token (cf-turnstile-response). Optional im Schema,
  // weil bei deaktiviertem Turnstile keiner mitkommt; die Pflicht erzwingt
  // verifyTurnstile, wenn ein Secret gesetzt ist.
  turnstileToken: z.string().max(4096).optional(),
});

const cookieOpts = (maxAgeDays: number) => ({
  path: "/",
  httpOnly: true,
  sameSite: "lax" as const,
  secure: config.NODE_ENV === "production",
  maxAge: maxAgeDays * 24 * 60 * 60,
});

/** Slug aus Studio-Name oder E-Mail ableiten. Bei Kollision: numerischer
 *  Suffix. Format-Validation kommt via suggestSlug aus services/slugs.ts. */
async function generateUniqueSlug(input: string): Promise<string> {
  const base = suggestSlug(input);

  let slug = base;
  let counter = 1;
  while (true) {
    const existing = await prisma.tenant.findUnique({
      where: { slug },
      select: { id: true },
    });
    if (!existing && !RESERVED_SLUGS.has(slug)) return slug;
    counter++;
    slug = `${base}-${counter}`;
    if (counter > 99) {
      // Sehr unwahrscheinlich aber sicher ist sicher
      slug = `${base}-${Date.now().toString(36).slice(-4)}`;
      return slug;
    }
  }
}

export async function registerSignupRoutes(app: FastifyInstance) {
  // -------------------------------------------------------------------------
  // POST /signup
  // -------------------------------------------------------------------------
  app.post(
    "/signup",
    {
      // Öffentlicher Endpoint, der Accounts + Stripe-Customer anlegt.
      // Eng limitieren gegen automatisierten Missbrauch (Massen-Signups).
      config: {
        rateLimit: { max: 5, timeWindow: "10 minutes" },
      },
    },
    async (req, reply) => {
    if (!isStripeEnabled()) {
      return reply.status(503).send({
        error: "billing_disabled",
        message: "Self-Service-Sign-up nicht verfügbar.",
      });
    }

    const parsed = signupSchema.safeParse(req.body);
    if (!parsed.success) {
      app.log.warn(
        {
          issues: parsed.error.issues,
          bodyKeys: req.body && typeof req.body === "object"
            ? Object.keys(req.body as Record<string, unknown>)
            : null,
        },
        "signup.invalid_input"
      );
      // Detail-Message generieren damit der User weiss was los ist —
      // statt nur 'invalid_input' kriegt das Frontend "email ist
      // erforderlich" o.ä. Zod-Issues haben path + message.
      const firstIssue = parsed.error.issues[0];
      const fieldName = firstIssue?.path.join(".") ?? "unknown";
      const messageMap: Record<string, string> = {
        email: "Bitte gib eine gültige E-Mail-Adresse ein.",
        password: "Passwort muss mindestens 8 Zeichen lang sein.",
        studioName: "Studio-Name darf nicht leer sein.",
        slug: "Studio-Name muss 3-30 Zeichen lang sein (Kleinbuchstaben, Zahlen, Bindestrich).",
        name: "Name ist zu lang.",
        plan: "Ungültiger Plan.",
        interval: "Ungültiges Intervall.",
      };
      return reply.status(400).send({
        error: "invalid_input",
        field: fieldName,
        message:
          messageMap[fieldName] ??
          `${fieldName}: ${firstIssue?.message ?? "ungültig"}`,
        issues: parsed.error.issues,
      });
    }
    const body = parsed.data;

    // CAPTCHA prüfen (nur aktiv, wenn TURNSTILE_SECRET_KEY gesetzt ist).
    const captchaOk = await verifyTurnstile(body.turnstileToken, req.ip);
    if (!captchaOk) {
      return reply.status(400).send({
        error: "captcha_failed",
        message:
          "CAPTCHA-Prüfung fehlgeschlagen. Bitte lade die Seite neu und versuche es erneut.",
      });
    }

    // E-Mail darf nicht bereits an einen Tenant gebunden sein.
    // Wir checken global — multi-tenant-Wiederverwendung von E-Mails
    // wäre theoretisch denkbar (gleiche Person bei zwei Studios),
    // aber für Self-Service-Sign-up führt das nur zu Verwirrung beim
    // Login. Restriktiv: eine E-Mail = ein Tenant.
    const emailTaken = await prisma.user.findFirst({
      where: { email: body.email },
      select: { id: true },
    });
    if (emailTaken) {
      return reply.status(409).send({
        error: "email_taken",
        message: "Diese E-Mail-Adresse ist bereits registriert.",
      });
    }

    // Plan-Lookup in der DB — Bootstrap-Script muss vorher gelaufen sein
    const plan = await prisma.billingPlan.findUnique({
      where: { slug: body.plan },
    });
    if (!plan) {
      app.log.error(
        { slug: body.plan },
        "signup.plan_not_in_db_run_bootstrap"
      );
      return reply.status(500).send({
        error: "plan_not_configured",
        message: "Plan nicht verfügbar. Bitte später erneut versuchen.",
      });
    }
    const priceId =
      body.interval === "yearly"
        ? plan.stripePriceIdYearly
        : plan.stripePriceIdMonthly;
    if (!priceId) {
      app.log.error(
        { slug: body.plan, interval: body.interval },
        "signup.price_id_missing"
      );
      return reply.status(500).send({
        error: "price_not_configured",
      });
    }

    // Slug auflösen: entweder vom User gewählt (validieren + auf
    // Verfügbarkeit prüfen) oder automatisch aus dem Studio-Namen
    // ableiten. Selber-Wählen ist UX-mässig nett ("foto-mueller" statt
    // "saro-photography-3"), aber kein Pflichtfeld.
    let slug: string;
    if (body.slug) {
      const formatCheck = validateSlugFormat(body.slug);
      if (!formatCheck.ok) {
        return reply.status(400).send({
          error: "invalid_slug",
          field: "slug",
          message: formatCheck.message,
          reason: formatCheck.error,
        });
      }
      const taken = await prisma.tenant.findUnique({
        where: { slug: body.slug },
        select: { id: true },
      });
      if (taken) {
        return reply.status(409).send({
          error: "slug_taken",
          field: "slug",
          message: "Dieser Studio-Name ist bereits vergeben.",
        });
      }
      slug = body.slug;
    } else {
      const slugBase = body.studioName || body.email.split("@")[0];
      slug = await generateUniqueSlug(slugBase);
    }

    // Tenant + Owner-User + initiale BillingSubscription-Row in
    // einer Transaktion anlegen. Stripe-Customer erstellen wir
    // AUSSERHALB der Transaktion (sonst hängt die TX am Stripe-API-
    // Call) und schreiben die Customer-ID hinterher zurück.
    const trialEndsAt = new Date(Date.now() + 14 * 24 * 60 * 60 * 1000);
    const { tenantId, userId } = await prisma.$transaction(async (tx) => {
      const tenant = await tx.tenant.create({
        data: {
          slug,
          name: body.studioName,
          status: "active",
        },
      });
      const user = await tx.user.create({
        data: {
          tenantId: tenant.id,
          email: body.email,
          passwordHash: await hashPassword(body.password),
          name: body.name ?? null,
          role: "owner",
          status: "active",
        },
      });
      // Initiale Subscription-Row — Trial-Status. Plan-ID setzen
      // damit Limit-Checks ab Sekunde 1 funktionieren. Stripe-IDs
      // werden vom Webhook nachgereicht (customer.subscription.created).
      await tx.billingSubscription.create({
        data: {
          tenantId: tenant.id,
          planId: plan.id,
          status: "trialing",
          billingInterval: body.interval,
          trialEndsAt,
        },
      });
      return { tenantId: tenant.id, userId: user.id };
    });

    // Stripe-Customer + Checkout-Session erstellen. Wir tun das
    // AUSSERHALB der DB-Transaktion (Stripe-API-Calls in einer TX
    // wären lange Locks). Aber: wenn Stripe failed, müssen wir die
    // DB-Sachen rollbacken — sonst hängt ein Zombie-Tenant ohne
    // funktionierende Subscription, und der User kann sich nicht
    // mit derselben E-Mail neu anmelden.
    const stripe = getStripe();
    let customerId: string | null = null;
    let session: Stripe.Checkout.Session | null = null;
    try {
      const customer = await stripe.customers.create({
        email: body.email,
        name: body.studioName,
        metadata: {
          lumio_tenant_id: tenantId,
          lumio_tenant_slug: slug,
        },
        tax: { validate_location: "deferred" },
      });
      customerId = customer.id;
      await prisma.tenant.update({
        where: { id: tenantId },
        data: { stripeCustomerId: customer.id },
      });

      session = await stripe.checkout.sessions.create({
        mode: "subscription",
        customer: customer.id,
        // Damit Stripe Tax die Adresse zur MwSt-Berechnung verwenden kann,
        // brauchen wir entweder eine vorab gesetzte Adresse am Customer
        // (haben wir nicht — User füllt sie ja gerade aus) oder das hier:
        // customer_update.address='auto' kopiert die im Checkout eingegebene
        // Billing-Adresse zurück auf den Customer. Erforderlich für
        // automatic_tax + Reverse-Charge-Detection bei EU-B2B.
        customer_update: {
          address: "auto",
          name: "auto",
        },
        line_items: [{ price: priceId, quantity: 1 }],
        subscription_data: {
          trial_period_days: 14,
          metadata: {
            lumio_tenant_id: tenantId,
          },
        },
        // Karte zwingend erfordern auch bei Trial.
        payment_method_collection: "always",
        // Stripe Tax automatisch berechnen.
        automatic_tax: { enabled: true },
        // Tax-IDs erfassen (USt-IdNr für B2B-Reverse-Charge).
        tax_id_collection: { enabled: true },
      // Konsent zur Billing-Adresse für korrekte Tax-Berechnung.
      billing_address_collection: "required",
      // Erlaube Promotion-Codes — kein eigener Code nötig, aber Stripe-
      // erstellte Coupons funktionieren damit ohne Code-Anpassung im
      // Frontend.
      allow_promotion_codes: true,
      success_url: `${config.STRIPE_RETURN_URL_BASE}/welcome?session_id={CHECKOUT_SESSION_ID}`,
      cancel_url: `${config.STRIPE_RETURN_URL_BASE}/signup-cancelled`,
      metadata: {
        lumio_tenant_id: tenantId,
        lumio_signup: "true",
      },
    });
    } catch (err) {
      // Stripe-Fehler: DB-Sachen rollback machen damit der User
      // sich nicht von einem Zombie-Tenant blockieren lässt. Wir
      // löschen Tenant cascadiert (User, Subscription gehen mit).
      // Den Stripe-Customer (falls schon angelegt) löschen wir AUCH —
      // sonst hat Stripe einen Customer ohne Lumio-Anker.
      app.log.warn(
        {
          err: err instanceof Error ? err.message : String(err),
          tenantId,
          customerId,
        },
        "signup.stripe_failed_rolling_back"
      );
      if (customerId) {
        // Best-effort — wenn das Löschen scheitert, hängt der Customer
        // weiter in Stripe, aber der Lumio-Side ist sauber.
        await stripe.customers.del(customerId).catch(() => undefined);
      }
      await prisma.tenant.delete({ where: { id: tenantId } }).catch(() => undefined);

      // Stripe-Fehler durchreichen (mit Stripe-eigenem Status-Code wenn
      // möglich — z.B. customer_tax_location_invalid kommt mit 400).
      const status =
        err && typeof err === "object" && "statusCode" in err
          ? Number((err as { statusCode: number }).statusCode)
          : 500;
      const code =
        err && typeof err === "object" && "code" in err
          ? String((err as { code: string }).code)
          : "stripe_error";
      const message =
        err && typeof err === "object" && "message" in err
          ? String((err as { message: string }).message)
          : "Stripe-Fehler beim Sign-up.";
      return reply.status(status >= 400 && status < 600 ? status : 500).send({
        error: code,
        message,
      });
    }

    if (!session) {
      // Sollte unmöglich sein nach erfolgreichem try-Block, aber TS will's
      return reply.status(500).send({ error: "session_missing" });
    }

    // Session-Cookie schon mal setzen — User ist als Owner eingeloggt
    // egal ob er Checkout abbricht oder nicht. Bei Cancel wandert er
    // zurück auf lumio-cloud.de/signup-cancelled, kann sich aber
    // jederzeit in studio.lumio-cloud.de einloggen (read-only-Modus
    // greift erst nach Tag 14 wenn keine Karte hinterlegt).
    const { token } = await createSession({
      userId,
      ipAddress: req.ip,
      userAgent: req.headers["user-agent"] ?? null,
    });
    reply.setCookie(SESSION_COOKIE, token, cookieOpts(30));

    // Welcome-Mail fire-and-forget — Response soll nicht auf SMTP warten
    // (3-5s Latenz waeren UX-Killer beim Checkout-Redirect).
    void sendWelcomeMail({ userId, tenantId });

    // Super-Admins über den neuen Tenant informieren (fire-and-forget).
    void notifySuperAdminsNewTenant({
      tenantId,
      tenantName: body.studioName,
      slug,
      plan: body.plan,
      ownerEmail: body.email,
    });

    return {
      checkoutUrl: session.url,
      sessionId: session.id,
      tenantSlug: slug,
    };
  });

  // -------------------------------------------------------------------------
  // POST /signup/check-email
  // -------------------------------------------------------------------------
  // Light-weight Pre-Check für die Sign-up-Form — User tippt E-Mail
  // und Frontend kann sofort zeigen "diese E-Mail ist schon vergeben"
  // ohne den ganzen Submit. Anti-Enumeration: 200 mit { available:
  // boolean }, kein Detail-Leak.
  app.post<{ Body: { email?: string } }>(
    "/signup/check-email",
    {
      // Verrät, ob eine E-Mail registriert ist (User-Enumeration). Als
      // Live-Check in der Form gewollt, aber eng limitieren, damit nicht
      // ganze Mail-Listen durchprobiert werden können.
      config: {
        rateLimit: { max: 20, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const body = z
        .object({ email: z.string().email().toLowerCase().max(200) })
        .safeParse(req.body);
      if (!body.success) {
        return reply.status(400).send({ available: false });
      }
      const taken = await prisma.user.findFirst({
        where: { email: body.data.email },
        select: { id: true },
      });
      return { available: !taken };
    }
  );

  // -------------------------------------------------------------------------
  // POST /signup/check-slug
  // -------------------------------------------------------------------------
  // Slug-Live-Check für die Sign-up-Form: Format-Validation +
  // DB-Verfügbarkeit. Wir geben strukturierte Antwort zurück damit das
  // Frontend genau anzeigen kann, was kaputt ist (zu kurz, ungültige
  // Zeichen, reserviert, vergeben). Rate-Limit gegen Brute-Force-
  // Enumeration aller Slugs.
  app.post<{ Body: { slug?: string } }>(
    "/signup/check-slug",
    {
      config: {
        rateLimit: { max: 30, timeWindow: "1 minute" },
      },
    },
    async (req, reply) => {
      const body = z
        .object({ slug: z.string().min(1).max(50) })
        .safeParse(req.body);
      if (!body.success) {
        return reply
          .status(400)
          .send({ available: false, reason: "invalid_input" });
      }
      const slug = body.data.slug.toLowerCase().trim();
      const format = validateSlugFormat(slug);
      if (!format.ok) {
        return {
          available: false,
          reason: format.error,
          message: format.message,
        };
      }
      const taken = await prisma.tenant.findUnique({
        where: { slug },
        select: { id: true },
      });
      if (taken) {
        return {
          available: false,
          reason: "taken",
          message: "Dieser Studio-Name ist bereits vergeben.",
        };
      }
      return { available: true };
    }
  );
}
