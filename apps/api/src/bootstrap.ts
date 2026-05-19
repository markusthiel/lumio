/**
 * Lumio API — Bootstrap
 *
 * Wird beim Start ausgeführt. Stellt sicher, dass im single-Mode immer
 * genau ein Tenant existiert; seedet bei Bedarf Default-Billing-Pläne.
 */
import { prisma } from "./db.js";
import { config } from "./config.js";
import { logger } from "./logger.js";

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

  await prisma.billingPlan.createMany({
    data: [
      {
        slug: "free",
        name: "Free",
        description: "For trying things out.",
        storageGib: 5,
        galleriesMax: 3,
        usersMax: 1,
        customDomain: false,
        whiteLabel: false,
        watermarking: true,
        analytics: false,
        priceMonthlyCents: 0,
        priceYearlyCents: 0,
        currency: "EUR",
        sortOrder: 0,
      },
      {
        slug: "starter",
        name: "Starter",
        description: "For solo photographers getting started.",
        storageGib: 100,
        galleriesMax: 50,
        usersMax: 1,
        customDomain: false,
        whiteLabel: false,
        watermarking: true,
        analytics: false,
        priceMonthlyCents: 900,
        priceYearlyCents: 9000,
        currency: "EUR",
        sortOrder: 10,
      },
      {
        slug: "pro",
        name: "Pro",
        description: "Custom domain and full whitelabel.",
        storageGib: 500,
        galleriesMax: null,
        usersMax: 3,
        customDomain: true,
        whiteLabel: true,
        watermarking: true,
        analytics: true,
        priceMonthlyCents: 1900,
        priceYearlyCents: 19000,
        currency: "EUR",
        sortOrder: 20,
      },
      {
        slug: "studio",
        name: "Studio",
        description: "For teams and high-volume shoots.",
        storageGib: 2048,
        galleriesMax: null,
        usersMax: 10,
        customDomain: true,
        whiteLabel: true,
        watermarking: true,
        analytics: true,
        priceMonthlyCents: 4900,
        priceYearlyCents: 49000,
        currency: "EUR",
        sortOrder: 30,
      },
    ],
  });
  logger.info("bootstrap: seeded 4 default billing plans");
}
