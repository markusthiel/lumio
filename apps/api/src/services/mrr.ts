/**
 * Lumio API — MRR (Monthly Recurring Revenue) Service
 *
 * MRR ist die wichtigste Kennzahl fuer ein SaaS-Geschaeft.
 *
 * Definition fuer Lumio:
 *  - Subscriptions in Status 'active' oder 'past_due' zaehlen voll mit
 *    (past_due weil noch nicht offiziell gekuendigt, der Umsatz steht
 *    bis zum Eskalations-Ende ein)
 *  - 'trialing' geht in trialingMrrCents (Forecast)
 *  - 'unpaid' und 'canceled' werden nicht gezaehlt
 *  - Yearly-Subscriptions werden durch 12 geteilt (also als 1/12 MRR
 *    pro Monat)
 *  - Currency: wir haben aktuell nur EUR, daher kein FX-Handling. Wenn
 *    spaeter andere Currencies dazukommen, hier ergaenzen oder
 *    separater Konverter
 *
 * Snapshot-Strategie:
 *  - Tagessnapshot (date UNIQUE) in mrr_snapshots-Tabelle
 *  - Cron taeglich um 02:00 UTC → idempotent dank UNIQUE-Index
 *  - Live-Berechnung jederzeit fuer 'aktuell'
 *  - Trend = letzte N Snapshots geliefert vom service
 *
 * Storage-Pack-Add-Ons sind NICHT in MRR enthalten (separat im
 * Stripe-Statement). Wenn das relevant wird: BillingSubscription.
 * storageAddonGib * Preis-pro-Pack.
 */
import { prisma } from "../db.js";
import { logger } from "../logger.js";

export interface MrrSnapshot {
  date: string; // YYYY-MM-DD UTC
  mrrCents: number;
  trialingMrrCents: number;
  activeSubs: number;
  trialingSubs: number;
  perPlan: Record<string, { mrrCents: number; count: number; name: string }>;
}

/** Berechnet die MRR auf Basis der aktuellen DB-Werte. */
export async function computeCurrentMrr(): Promise<MrrSnapshot> {
  const subs = await prisma.billingSubscription.findMany({
    where: {
      status: { in: ["active", "past_due", "trialing"] },
      // Manuell zugewiesene Gratis-Abos (Partner/Goodwill) erzeugen keinen
      // Umsatz und dürfen die MRR nicht aufblähen.
      comped: false,
    },
    select: {
      status: true,
      billingInterval: true,
      plan: {
        select: {
          slug: true,
          name: true,
          priceMonthlyCents: true,
          priceYearlyCents: true,
        },
      },
    },
  });

  let mrrCents = 0;
  let trialingMrrCents = 0;
  let activeSubs = 0;
  let trialingSubs = 0;
  const perPlan: MrrSnapshot["perPlan"] = {};

  for (const sub of subs) {
    const monthlyContribution = (() => {
      if (sub.billingInterval === "yearly") {
        return sub.plan.priceYearlyCents
          ? Math.round(sub.plan.priceYearlyCents / 12)
          : 0;
      }
      return sub.plan.priceMonthlyCents ?? 0;
    })();

    if (sub.status === "trialing") {
      trialingMrrCents += monthlyContribution;
      trialingSubs += 1;
    } else {
      mrrCents += monthlyContribution;
      activeSubs += 1;
      // perPlan aggregiert nur paid-MRR (active+past_due). Trialing
      // wird separat im Topline gezeigt.
      const existing = perPlan[sub.plan.slug] ?? {
        mrrCents: 0,
        count: 0,
        name: sub.plan.name,
      };
      existing.mrrCents += monthlyContribution;
      existing.count += 1;
      perPlan[sub.plan.slug] = existing;
    }
  }

  return {
    date: new Date().toISOString().slice(0, 10),
    mrrCents,
    trialingMrrCents,
    activeSubs,
    trialingSubs,
    perPlan,
  };
}

/** Persistiert die aktuelle MRR als Tagessnapshot. Idempotent: bei
 *  bestehendem Snapshot fuer den Tag wird upsert gemacht. */
export async function writeMrrSnapshot(): Promise<void> {
  try {
    const snap = await computeCurrentMrr();
    const date = new Date(snap.date + "T00:00:00Z");
    await prisma.mrrSnapshot.upsert({
      where: { date },
      update: {
        mrrCents: snap.mrrCents,
        trialingMrrCents: snap.trialingMrrCents,
        activeSubs: snap.activeSubs,
        trialingSubs: snap.trialingSubs,
        perPlan: snap.perPlan as never,
      },
      create: {
        date,
        mrrCents: snap.mrrCents,
        trialingMrrCents: snap.trialingMrrCents,
        activeSubs: snap.activeSubs,
        trialingSubs: snap.trialingSubs,
        perPlan: snap.perPlan as never,
      },
    });
    logger.info({ mrrCents: snap.mrrCents }, "mrr snapshot written");
  } catch (err) {
    logger.warn({ err }, "mrr snapshot failed");
  }
}

/** Liefert die letzten N Snapshots, aelteste zuerst. */
export async function listRecentSnapshots(days = 90): Promise<
  Array<{
    date: string;
    mrrCents: number;
    trialingMrrCents: number;
    activeSubs: number;
    trialingSubs: number;
  }>
> {
  const horizon = new Date(Date.now() - days * 24 * 60 * 60 * 1000);
  const rows = await prisma.mrrSnapshot.findMany({
    where: { date: { gte: horizon } },
    orderBy: { date: "asc" },
    select: {
      date: true,
      mrrCents: true,
      trialingMrrCents: true,
      activeSubs: true,
      trialingSubs: true,
    },
  });
  return rows.map((r) => ({
    date: r.date.toISOString().slice(0, 10),
    mrrCents: r.mrrCents,
    trialingMrrCents: r.trialingMrrCents,
    activeSubs: r.activeSubs,
    trialingSubs: r.trialingSubs,
  }));
}
