/**
 * Lumio API — Read-Only-Mode-Enforcement
 *
 * Wenn ein Tenant trial-expired ist (readOnlySince != null in der
 * BillingSubscription), darf er nur noch lesen. Schreibvorgänge (POST/
 * PUT/PATCH/DELETE) werden mit 409 read_only abgewiesen.
 *
 * Pattern: preHandler-Hook im /api/v1-Scope. Wir greifen nur wenn:
 *   - BILLING_ENABLED ist true (Self-Host ohne Billing nutzt das nicht)
 *   - Request hat ein tenantId (= authenticated Studio-User)
 *   - Method ist nicht GET/HEAD/OPTIONS
 *   - URL ist nicht in der Allowlist (Billing-Endpoints müssen erreichbar
 *     bleiben damit der User upgraden kann; Auth/Logout auch)
 *
 * Caching: Wir lesen die Subscription PRO Request. Bei hoher Last
 * lohnt sich ein Memory-Cache (5-Sek-TTL pro Tenant) — aber heute ist
 * der DB-Call billig und Korrektheit > Performance. Reaktivierung
 * nach Karten-Hinterlegung muss sofort wirken.
 */
import type { FastifyInstance, FastifyRequest } from "fastify";
import { prisma } from "../db.js";
import { config } from "../config.js";

/** URLs die auch im read-only-Zustand schreiben dürfen.
 * Pfad-Prefixe ohne /api/v1. Match per startsWith. */
const READ_ONLY_ALLOWLIST = [
  "/billing/", // Billing-Endpoints für Upgrade + Portal
  "/auth/", // Login/Logout/2FA
  "/signup", // Bestehende Tenants nutzen es nicht, aber harmlos
  "/super/", // Plattform-Admin kann immer
];

function isWritableMethod(method: string): boolean {
  return !["GET", "HEAD", "OPTIONS"].includes(method.toUpperCase());
}

function isAllowlisted(url: string): boolean {
  // url kommt mit oder ohne /api/v1-Prefix je nach Hook-Registration.
  // Wir normalisieren auf den /-Prefix nach /api/v1.
  const path = url.replace(/^\/api\/v1/, "").split("?")[0];
  return READ_ONLY_ALLOWLIST.some((prefix) => path.startsWith(prefix));
}

export function registerReadOnlyEnforcement(app: FastifyInstance) {
  if (!config.BILLING_ENABLED) return;

  app.addHook("preHandler", async (req, reply) => {
    // Nur Schreibmethoden
    if (!isWritableMethod(req.method)) return;
    // Nur authentifizierte Studio-User (req.tenantId wird vom auth-
    // plugin gesetzt). Public-Endpoints wie /u/<token>, /g/<id> haben
    // kein tenantId-Hook und laufen ohnehin durch.
    if (!req.tenantId) return;
    // Allowlist: Billing + Auth dürfen immer schreiben
    if (isAllowlisted(req.url)) return;

    const sub = await prisma.billingSubscription.findUnique({
      where: { tenantId: req.tenantId },
      select: { readOnlySince: true, status: true },
    });
    // Keine Subscription = Self-Host-Tenant ohne Billing-Setup — durchlassen.
    // Subscription aktiv/trialing/past_due = ok solange readOnlySince null.
    if (!sub || sub.readOnlySince === null) return;

    // Read-only — Schreibvorgang ablehnen
    return reply.status(409).send({
      error: "read_only",
      message:
        "Dieser Account ist im Read-only-Modus. Bitte abonniere einen Plan, um wieder Änderungen vorzunehmen.",
      readOnlySince: sub.readOnlySince.toISOString(),
      // UI nutzt diesen Code um den Upgrade-Banner anzuzeigen.
      readOnlyReason:
        sub.status === "trialing" ? "trial_expired" : "subscription_inactive",
    });
  });
}

/** Helper für Routen die explizit den read-only-State prüfen wollen
 * (z.B. eine eigene Fehler-Message). Returnt `true` wenn der Request
 * blockiert werden sollte. */
export async function isTenantReadOnly(
  req: FastifyRequest
): Promise<boolean> {
  if (!config.BILLING_ENABLED || !req.tenantId) return false;
  const sub = await prisma.billingSubscription.findUnique({
    where: { tenantId: req.tenantId },
    select: { readOnlySince: true },
  });
  return Boolean(sub?.readOnlySince);
}
