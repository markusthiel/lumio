/**
 * Lumio API — CLI: stripe-bootstrap
 *
 * Legt die Stripe-Products und -Prices an, die für Subscriptions gebraucht
 * werden. Setzt stable lookup_keys (plan_solo_monthly, storage_pack_yearly,
 * ...) und schreibt die generierten Price-IDs in die billing_plans-Tabelle.
 *
 * IDEMPOTENT: bei wiederholtem Lauf werden bestehende Products + Prices
 * über `lookup_key` gefunden und nur Updates gemacht wenn Werte sich
 * geändert haben. Falsch gewordene Plans im Stripe-Dashboard musst du
 * manuell aufräumen — wir erstellen nur, löschen nicht.
 *
 * Aufruf:
 *   docker compose ... exec api npm run stripe-bootstrap
 *
 * Vorbedingungen:
 *   STRIPE_SECRET_KEY in der ENV (sk_test_xxx oder sk_live_xxx)
 *
 * Was passiert:
 *   1) 3 Products: Lumio Solo, Lumio Studio, Lumio Pro (+1 Storage Pack)
 *   2) Pro Product: 2 Prices (monthly + yearly) mit lookup_keys
 *   3) billing_plans.stripePriceIdMonthly/Yearly werden aktualisiert
 *
 * Was NICHT passiert:
 *   - Trial wird nicht in Stripe als Product angelegt (kein Charge nötig)
 *   - Existing Subscriptions werden NICHT migriert (nur neue Sign-ups
 *     nutzen die neuen Prices)
 */
import { exit } from "node:process";
import Stripe from "stripe";
import { prisma } from "../db.js";
import { config } from "../config.js";
import {
  PLANS,
  STORAGE_ADDON,
  planLookupKey,
  storagePackLookupKey,
  type PlanSlug,
} from "../services/plans.js";

interface PlanDef {
  slug: Exclude<PlanSlug, "trial">;
  name: string;
  description: string;
  priceMonthlyCents: number;
  priceYearlyCents: number;
}

const PLAN_DEFS: PlanDef[] = (["start", "solo", "studio", "pro"] as const).map(
  (slug) => ({
    slug,
    name: `Lumio ${PLANS[slug].name}`,
    description: PLANS[slug].description,
    priceMonthlyCents: PLANS[slug].priceMonthlyCents,
    priceYearlyCents: PLANS[slug].priceYearlyCents,
  })
);

const STORAGE_PACK_DEF = {
  name: "Lumio Storage Pack",
  description: `Zusätzliche ${STORAGE_ADDON.gibPerUnit} GB Speicher`,
  priceMonthlyCents: STORAGE_ADDON.priceMonthlyCents,
  priceYearlyCents: STORAGE_ADDON.priceYearlyCents,
};

/** Findet ein bestehendes Stripe-Product anhand seiner Metadata-
 *  Markierung. Wir setzen metadata.lumio_kind=<slug> beim Anlegen
 *  damit wir die Suche stabil halten — Name-basierte Lookups würden
 *  bei Umbenennungen brechen. */
async function findProductByLumioKind(
  stripe: Stripe,
  kind: string
): Promise<Stripe.Product | null> {
  // Stripe Search-API ist robuster als list-pagination, aber braucht
  // einen Index-Aufbau (1-2 Min nach product.create). Für Bootstrap
  // ist list+filter genug — wir haben < 10 Lumio-Products.
  const list = await stripe.products.list({ limit: 100, active: true });
  return (
    list.data.find((p) => p.metadata.lumio_kind === kind) ?? null
  );
}

/** Stellt sicher dass es ein Product für den gegebenen kind gibt.
 *  Returnt die Product-ID. Idempotent. */
async function ensureProduct(
  stripe: Stripe,
  kind: string,
  name: string,
  description: string
): Promise<string> {
  const existing = await findProductByLumioKind(stripe, kind);
  if (existing) {
    // Optional: name/description abgleichen + updaten wenn anders
    if (existing.name !== name || existing.description !== description) {
      await stripe.products.update(existing.id, { name, description });
      console.log(`  · updated product ${existing.id} (${kind})`);
    }
    return existing.id;
  }
  const created = await stripe.products.create({
    name,
    description,
    metadata: { lumio_kind: kind },
  });
  console.log(`  · created product ${created.id} (${kind})`);
  return created.id;
}

/** Stellt sicher dass es einen Price mit dem gegebenen lookup_key gibt.
 *  Wenn ja → wiederverwenden. Wenn nein → neu anlegen.
 *  ACHTUNG: Stripe-Prices sind IMMUTABLE — Preis-Änderung erfordert
 *  einen neuen Price und neuen lookup_key (oder existing deaktivieren
 *  und neuen Price + selben lookup_key reusen). Wir handeln das hier
 *  per "wenn Preis abweicht: alten deaktivieren, neuen anlegen". */
async function ensurePrice(
  stripe: Stripe,
  productId: string,
  lookupKey: string,
  unitAmount: number,
  interval: "month" | "year"
): Promise<string> {
  const existingByLookup = await stripe.prices.list({
    lookup_keys: [lookupKey],
    active: true,
    limit: 1,
  });
  const existing = existingByLookup.data[0];

  if (existing) {
    // Wenn Preis identisch: nichts tun
    if (existing.unit_amount === unitAmount) {
      return existing.id;
    }
    // Preis hat sich geändert — alten deaktivieren, neuen anlegen
    // mit demselben lookup_key (geht weil Stripe lookup_keys nur
    // auf aktive Prices unique-checked).
    console.log(
      `  · price ${existing.id} (${lookupKey}) hat alten Preis ` +
        `${existing.unit_amount}, deactivate + recreate`
    );
    await stripe.prices.update(existing.id, { active: false });
  }

  const created = await stripe.prices.create({
    product: productId,
    unit_amount: unitAmount,
    currency: "eur",
    recurring: { interval },
    lookup_key: lookupKey,
    // tax_behavior: Stripe Tax rechnet die MwSt obendrauf. "exclusive"
    // = unsere Preise sind NETTO, Stripe addiert MwSt im Checkout.
    // "inclusive" wäre Brutto. EU/DE B2B-üblich ist exclusive.
    tax_behavior: "exclusive",
  });
  console.log(`  · created price ${created.id} (${lookupKey})`);
  return created.id;
}

async function bootstrapPlan(stripe: Stripe, def: PlanDef): Promise<void> {
  console.log(`\n[${def.slug}] ${def.name}`);
  const productId = await ensureProduct(
    stripe,
    `plan_${def.slug}`,
    def.name,
    def.description
  );
  const priceMonthlyId = await ensurePrice(
    stripe,
    productId,
    planLookupKey(def.slug, "monthly"),
    def.priceMonthlyCents,
    "month"
  );
  const priceYearlyId = await ensurePrice(
    stripe,
    productId,
    planLookupKey(def.slug, "yearly"),
    def.priceYearlyCents,
    "year"
  );

  // Plan in der DB upserten — slug als unique-Key
  await prisma.billingPlan.upsert({
    where: { slug: def.slug },
    create: {
      slug: def.slug,
      name: def.name,
      description: def.description,
      stripePriceIdMonthly: priceMonthlyId,
      stripePriceIdYearly: priceYearlyId,
      priceMonthlyCents: def.priceMonthlyCents,
      priceYearlyCents: def.priceYearlyCents,
      currency: "EUR",
      storageGib: PLANS[def.slug].storageGib,
      galleriesMax:
        PLANS[def.slug].activeGalleries === Number.POSITIVE_INFINITY
          ? null
          : PLANS[def.slug].activeGalleries,
      customDomain: PLANS[def.slug].customDomains > 0,
      watermarking: PLANS[def.slug].watermarkAllowed,
    },
    update: {
      name: def.name,
      description: def.description,
      stripePriceIdMonthly: priceMonthlyId,
      stripePriceIdYearly: priceYearlyId,
      priceMonthlyCents: def.priceMonthlyCents,
      priceYearlyCents: def.priceYearlyCents,
    },
  });
  console.log(`  · upserted billing_plans row (${def.slug})`);
}

async function bootstrapStoragePack(stripe: Stripe): Promise<void> {
  console.log(`\n[storage_pack] ${STORAGE_PACK_DEF.name}`);
  const productId = await ensureProduct(
    stripe,
    "storage_pack",
    STORAGE_PACK_DEF.name,
    STORAGE_PACK_DEF.description
  );
  await ensurePrice(
    stripe,
    productId,
    storagePackLookupKey("monthly"),
    STORAGE_PACK_DEF.priceMonthlyCents,
    "month"
  );
  await ensurePrice(
    stripe,
    productId,
    storagePackLookupKey("yearly"),
    STORAGE_PACK_DEF.priceYearlyCents,
    "year"
  );
  // Storage-Pack hat keinen eigenen billing_plans-Row — er ist eine
  // separate Add-on-Subscription, gefunden via lookup_key direkt.
  console.log(`  · storage_pack ready (no billing_plans row needed)`);
}

async function main(): Promise<void> {
  if (!config.STRIPE_SECRET_KEY) {
    console.error("STRIPE_SECRET_KEY not configured");
    exit(1);
  }
  const stripe = new Stripe(config.STRIPE_SECRET_KEY, {
    apiVersion: "2025-08-27.basil",
  });
  const mode = config.STRIPE_SECRET_KEY.startsWith("sk_live_")
    ? "LIVE"
    : "TEST";
  console.log(`\nLumio Stripe Bootstrap (mode: ${mode})`);

  for (const def of PLAN_DEFS) {
    await bootstrapPlan(stripe, def);
  }
  await bootstrapStoragePack(stripe);

  console.log("\n✓ Bootstrap complete\n");
}

main()
  .then(() => exit(0))
  .catch((err) => {
    console.error("Bootstrap failed:", err);
    exit(1);
  });
