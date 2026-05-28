/**
 * Lumio API — Manual-Self-Print-Adapter
 *
 * Der Fotograf druckt SELBST (eigener Drucker im Studio, lokales Lab um
 * die Ecke, Eigenfertigung). Lumio routet die Bestellung an den
 * Fotograf statt an ein externes Lab.
 *
 * Mechanismus:
 *   - submitOrder() schickt eine Mail an den Fotograf mit Order-Details,
 *     Liefer-Adresse und Download-Links der High-Res-Files.
 *   - Es gibt keine externe API — alle Status-Updates kommen vom Studio
 *     manuell ('in Produktion', 'versendet' mit Tracking).
 *   - getOrderStatus() liefert immer den letzten lokal-gesetzten Status
 *     zurueck (kein externer Lookup moeglich).
 *
 * Credentials sind nicht noetig — der Self-Print 'arbeitet' ohne Lab-
 * Authentifizierung.
 *
 * Mail-Versand passiert NICHT hier. Der Adapter ist stateless. Der
 * Service-Layer (services/print/orders.ts) ruft nach erfolgreichem
 * submitOrder() den Mail-Trigger an.
 */
import type {
  PrintAdapter,
  ProviderOrderRequest,
  ProviderOrderResponse,
  ProviderOrderStatus,
} from "./base.js";

export class ManualSelfPrintAdapter implements PrintAdapter {
  async validateCredentials(): Promise<{ ok: boolean }> {
    // Keine externen Credentials — immer ok.
    return { ok: true };
  }

  async fetchCatalog(): ReturnType<PrintAdapter["fetchCatalog"]> {
    // Self-Print hat keinen vom-Lab-vorgegebenen Katalog — der
    // Fotograf legt seine Produkte selbst an. Wir liefern leere
    // Listen zurueck; die Studio-UI sollte erkennen dass dies
    // ein Self-Print-Provider ist und entsprechend nicht die
    // 'Katalog importieren'-Funktion anbieten.
    return { products: [], shippingMethods: [] };
  }

  async submitOrder(
    _credentials: unknown,
    order: ProviderOrderRequest
  ): Promise<ProviderOrderResponse> {
    // Kein externer Call. Wir 'submitten' indem wir die Order-Number
    // als provider-ref durchreichen. Der Service-Layer feuert
    // anschliessend die Studio-Mail.
    return {
      providerOrderRef: `SELF-${order.externalOrderId}`,
      message: "Self-Print: Bestellung an Fotograf weitergeleitet",
    };
  }

  async getOrderStatus(): Promise<ProviderOrderStatus> {
    // Self-Print pollen ist nicht moeglich — Status wird manuell
    // vom Studio gepflegt. Wir geben 'in_production' als sicheren
    // Default zurueck; der Sweeper sollte fuer Self-Print-Orders
    // gar nicht erst pollen.
    return { status: "in_production", rawStatus: "self-print/manual" };
  }
}
