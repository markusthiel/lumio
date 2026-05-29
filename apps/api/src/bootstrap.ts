/**
 * Lumio API — Bootstrap
 *
 * Wird beim Start ausgeführt. Stellt sicher, dass im single-Mode immer
 * genau ein Tenant existiert; seedet bei Bedarf Default-Billing-Pläne.
 */
import { prisma } from "./db.js";
import { config } from "./config.js";
import { logger } from "./logger.js";
import { PLANS, type PlanSlug } from "./services/plans.js";

export async function bootstrap(): Promise<void> {
  await ensureTenant();
  if (config.BILLING_ENABLED) {
    await seedDefaultPlans();
  }
}

async function ensureTenant(): Promise<void> {
  const count = await prisma.tenant.count();

  if (config.DEPLOYMENT_MODE === "single") {
    if (count === 0) {
      const tenant = await prisma.tenant.create({
        data: {
          slug: "default",
          name: "My Studio",
          status: "active",
        },
      });
      logger.info(
        { tenantId: tenant.id, slug: tenant.slug },
        "bootstrap: created default tenant"
      );
    } else if (count > 1) {
      logger.warn(
        { count },
        "bootstrap: deployment_mode=single but multiple tenants exist — using the first"
      );
    }
    return;
  }

  // multi-mode
  if (count === 0) {
    logger.info(
      "bootstrap: deployment_mode=multi, no tenants yet — use the admin tools to create one"
    );
  } else {
    logger.info({ count }, "bootstrap: multi-mode, tenants found");
  }
}

/**
 * Im single-Mode (oder generell für Self-Hosting ohne Billing-Logik) wird
 * der Default-Tenant zurückgegeben. Im multi-Mode liefert die Funktion
 * NULL, wenn keine Auflösung möglich ist — der Caller muss dann explizit
 * über Subdomain/Custom-Domain/Slug auflösen.
 */
export async function getDefaultTenantId(): Promise<string | null> {
  if (config.DEPLOYMENT_MODE !== "single") return null;
  const t = await prisma.tenant.findFirst({ orderBy: { createdAt: "asc" } });
  return t?.id ?? null;
}

async function seedDefaultPlans(): Promise<void> {
  const existing = await prisma.billingPlan.count();
  if (existing > 0) return;

  // Die Plan-Limits + Preise sind in services/plans.ts die kanonische
  // Quelle (wird auch von Stripe-Bootstrap, Billing, Signup und Usage
  // genutzt). Wir leiten den Seed daraus ab, damit bootstrap nie wieder
  // davon abweichen kann. Stripe-Price-IDs werden hier NICHT gesetzt —
  // die kommen pro Umgebung aus dem Stripe-Bootstrap-Script.
  const sortOrder: Record<PlanSlug, number> = {
    trial: 0,
    solo: 10,
    studio: 20,
    pro: 30,
  };
  // plans.ts kennt kein analytics-Flag — wir leiten es ab: ab Studio
  // aufwärts (und im Vollzugriffs-Trial) verfügbar, im Solo-Plan nicht.
  const analyticsAllowed: Record<PlanSlug, boolean> = {
    trial: true,
    solo: false,
    studio: true,
    pro: true,
  };

  const data = (Object.keys(PLANS) as PlanSlug[]).map((slug) => {
    const p = PLANS[slug];
    return {
      slug,
      name: p.name,
      description: p.description,
      storageGib: p.storageGib,
      // Infinity (unbegrenzte Galerien) → null im DB-Modell.
      galleriesMax: Number.isFinite(p.activeGalleries)
        ? p.activeGalleries
        : null,
      usersMax: p.teamMembers,
      customDomain: p.customDomains > 0,
      whiteLabel: p.brandings > 0,
      watermarking: p.watermarkAllowed,
      analytics: analyticsAllowed[slug],
      priceMonthlyCents: p.priceMonthlyCents,
      priceYearlyCents: p.priceYearlyCents,
      currency: "EUR",
      sortOrder: sortOrder[slug],
    };
  });

  await prisma.billingPlan.createMany({ data });
  logger.info(`bootstrap: seeded ${data.length} default billing plans`);
}
