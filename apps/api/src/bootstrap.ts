/**
 * Lumio API — Bootstrap
 *
 * Wird beim Start ausgeführt. Stellt sicher, dass im single-Mode immer
 * genau ein Tenant existiert; synchronisiert die Default-Billing-Pläne
 * (Limits/Preise) bei jedem Start aus services/plans.ts in die DB.
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
  // Die Plan-Limits + Preise sind in services/plans.ts die kanonische
  // Quelle (wird auch von Stripe-Bootstrap, Billing, Signup und Usage
  // genutzt). Wir synchronisieren sie bei JEDEM Start per Upsert in die
  // DB, damit die DB-Zeilen nie von PLANS abweichen — sonst zeigt z.B.
  // die Super-Admin-Area (liest billing_plans.storageGib) stale Limits,
  // während die Tenant-Sicht (rechnet über PLANS) korrekt ist.
  // Bewusst NICHT angefasst, weil pro Umgebung/Admin gepflegt:
  // stripePriceIdMonthly/Yearly (Stripe-Bootstrap-Script),
  // printApplicationFeeBps und isActive.
  const sortOrder: Record<PlanSlug, number> = {
    trial: 0,
    start: 5,
    solo: 10,
    studio: 20,
    pro: 30,
  };
  // plans.ts kennt kein analytics-Flag — wir leiten es ab: ab Studio
  // aufwärts (und im Vollzugriffs-Trial) verfügbar, in Start/Solo nicht.
  const analyticsAllowed: Record<PlanSlug, boolean> = {
    trial: true,
    start: false,
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

  // Upsert pro Slug: anlegen falls neu, sonst die PLANS-abgeleiteten
  // Felder aktualisieren. slug ist der unique Key. Stripe-Price-IDs /
  // printApplicationFeeBps / isActive sind NICHT Teil von `data` und
  // bleiben dadurch unverändert erhalten.
  for (const d of data) {
    const { slug, ...fields } = d;
    await prisma.billingPlan.upsert({
      where: { slug },
      create: d,
      update: fields,
    });
  }
  logger.info(`bootstrap: synced ${data.length} billing plans from PLANS`);
}
