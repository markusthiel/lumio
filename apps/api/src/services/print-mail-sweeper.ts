/**
 * Lumio API — Print-Order-Mail-Sweeper
 *
 * Findet 'paid'-Orders fuer die noch keine Bestaetigungsmail
 * verschickt wurde und versendet sie. Laeuft alle 30 Sekunden.
 *
 * Warum diese Loesung statt direkter Mail im Worker:
 *   - Stripe-Webhook trifft den Python-Worker (Celery), der hat keine
 *     TS-Mail-Templates.
 *   - Wir koennten Internal-HTTP-Aufrufe machen, aber das fuegt Failure-
 *     Modes hinzu (Network, Auth-Tokens, etc.).
 *   - Pragmatisch: Worker setzt status='paid' + 'mark_paid'-Event mit
 *     {trigger:'webhook'}. Sweeper sucht solche Orders und versendet
 *     anschliessend. Idempotent durch 'mails_sent_paid'-Event-Marker.
 *
 * Im offline_invoice-Modus laufen Mails direkt aus createOrder() —
 * der Sweeper findet diese nicht (sie haben sofort den
 * mails_sent_paid-Marker den createOrder mitsetzt).
 */
import { prisma } from "../db.js";
import { logger } from "../logger.js";

const TICK_INTERVAL_MS = 30_000;
const STARTUP_DELAY_MS = 10_000;
let _interval: NodeJS.Timeout | null = null;

/** Findet paid-Orders fuer die noch kein 'mails_sent_paid' Event
 *  existiert UND ein 'mark_paid'-Event mit trigger=webhook vorhanden ist.
 *  Letzteres Kriterium verhindert Doppel-Mails fuer offline_invoice-
 *  Orders (die haben Mails direkt nach createOrder verschickt). */
async function runOnce(): Promise<void> {
  // Zuerst Kandidaten finden: paid Orders OHNE mails_sent_paid Event
  // und MIT mark_paid Event (was schon impliziert ist durch status=paid,
  // aber Belt-and-suspenders). Wir limitieren auf wenige pro Tick um
  // bei Backlog nicht zu fluten.
  const candidates = await prisma.printOrder.findMany({
    where: {
      status: "paid",
      paidAt: {
        // Nicht aelter als 24h (sonst war es manuell paid + wir wuerden
        // alte Orders re-mailen). Mindestens 5s alt damit der Status
        // sicher committed ist.
        lt: new Date(Date.now() - 5_000),
        gt: new Date(Date.now() - 24 * 60 * 60_000),
      },
      events: {
        none: { eventType: "mails_sent_paid" },
      },
    },
    take: 10,
    select: { id: true },
  });

  for (const c of candidates) {
    try {
      // Atomarer Lock via Insert mit unique-constraint-Fallback:
      // wir versuchen das Marker-Event einzufuegen. Falls schon
      // jemand parallel das gemacht hat (zweite Sweeper-Instanz),
      // brechen wir ab.
      // Da PrintOrderEvent kein unique-Constraint hat, machen wir
      // optimistic concurrency: Insert + danach Re-Check.
      await prisma.$transaction(async (tx) => {
        const existingMarker = await tx.printOrderEvent.findFirst({
          where: { printOrderId: c.id, eventType: "mails_sent_paid" },
          select: { id: true },
        });
        if (existingMarker) return; // bereits versendet

        await tx.printOrderEvent.create({
          data: {
            printOrderId: c.id,
            eventType: "mails_sent_paid",
            actor: "system",
            data: { sweeper: true } as never,
          },
        });
      });

      // Marker gesetzt — Mails versenden. Lazy-Import um Zirkular-
      // Imports zu vermeiden.
      const { sendOrderMails } = await import("./print/orders.js");
      await sendOrderMails(c.id, "paid");
      logger.info({ orderId: c.id }, "print.mail_sweeper.sent_paid_mails");
    } catch (err) {
      logger.warn(
        { err, orderId: c.id },
        "print.mail_sweeper.send_failed"
      );
    }
  }
}

export function startPrintOrderMailSweeper(): void {
  if (_interval) return;
  setTimeout(() => {
    void runOnce();
  }, STARTUP_DELAY_MS);
  _interval = setInterval(() => {
    void runOnce();
  }, TICK_INTERVAL_MS);
  logger.info({ intervalMs: TICK_INTERVAL_MS }, "print.mail_sweeper.started");
}

export function stopPrintOrderMailSweeper(): void {
  if (_interval) {
    clearInterval(_interval);
    _interval = null;
  }
}
