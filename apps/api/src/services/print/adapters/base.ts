/**
 * Lumio API — Print-Adapter-Basisinterface
 *
 * Jeder Print-Provider implementiert dieses Interface. Self-Print
 * ('manual_self_print') ist voll funktional; externe Labs (WhiteWall,
 * Saal, CEWE, etc.) bleiben in Phase 1 als Stubs zurueck.
 *
 * Adapter sind STATELESS: bekommen die Credentials und das Order-Object
 * mit, halten keinen eigenen DB-Zugriff. Damit bleiben sie unit-testbar
 * und das Tenant-Auth-Modell klar (Service-Layer prueft Zugriff bevor
 * der Adapter ueberhaupt aufgerufen wird).
 */

export interface ProviderAddress {
  street: string;
  street2?: string;
  postalCode: string;
  city: string;
  region?: string;
  countryCode: string;
  phone?: string;
}

export interface ProviderOrderItem {
  /** Lab-spezifische SKU der Variante (providerVariantRef) */
  variantRef: string | null;
  /** URL zum High-Res-Original-File. Lab muss das selber runterladen
   *  bei Submit-Zeit (signed URL, ~6h Gueltigkeit). */
  imageUrl: string;
  /** Crop-Region in normalisierten Koordinaten [0..1] oder null */
  crop: { x: number; y: number; width: number; height: number } | null;
  quantity: number;
}

export interface ProviderOrderRequest {
  /** Lumio-Order-Number, an das Lab als externe Referenz */
  externalOrderId: string;
  guest: { name: string; email: string; phone?: string };
  shippingAddress: ProviderAddress;
  billingAddress?: ProviderAddress;
  items: ProviderOrderItem[];
  /** Lab-spezifische Shipping-Method-Referenz */
  shippingMethodRef: string | null;
  /** Optionaler Hinweis vom Endkunden ('Geschenk verpacken') */
  guestNote?: string;
}

export interface ProviderOrderResponse {
  /** Lab-eigene Bestell-Nummer (wird in PrintOrder.providerOrderRef gespeichert) */
  providerOrderRef: string;
  /** Optional: tracking-URL die das Lab schon kennt (selten) */
  trackingUrl?: string;
  /** Lab-Statusbeschreibung — informativ, nicht semantisch */
  message?: string;
}

export interface ProviderOrderStatus {
  /** Mapping auf Lumio-PrintOrder-Status. Falls Lab unbekannten Status
   *  liefert, mappt der Adapter auf 'in_production' als Fallback. */
  status: "in_production" | "shipped" | "delivered" | "cancelled" | "failed";
  trackingNumber?: string;
  trackingCarrier?: string;
  trackingUrl?: string;
  /** Lab-Original-Status fuer Logging */
  rawStatus?: string;
  /** Zeitpunkt der Statusaenderung beim Lab, falls bekannt */
  occurredAt?: Date;
}

export interface PrintAdapter {
  /** Validiert Credentials (Test-Call gegen die Lab-API). */
  validateCredentials(credentials: unknown): Promise<{
    ok: boolean;
    error?: string;
  }>;

  /** Holt aktuelle Produktliste vom Lab. Wird vom Studio zum Setup-
   *  Zeitpunkt aufgerufen, damit der Fotograf seinen Katalog aus den
   *  verfuegbaren Lab-Produkten zusammenklicken kann. */
  fetchCatalog(credentials: unknown): Promise<{
    products: Array<{
      providerProductRef: string;
      name: string;
      category: string;
      variants: Array<{
        providerVariantRef: string;
        name: string;
        widthMm: number;
        heightMm: number;
        aspectRatio?: number;
        finishType?: string;
        costCents: number;
      }>;
    }>;
    shippingMethods: Array<{
      providerShippingRef: string;
      name: string;
      countries: string[];
      priceCents: number;
      estimatedDaysMin?: number;
      estimatedDaysMax?: number;
    }>;
  }>;

  /** Reicht eine Bestellung an das Lab durch. Wirft bei Fehler. */
  submitOrder(
    credentials: unknown,
    order: ProviderOrderRequest
  ): Promise<ProviderOrderResponse>;

  /** Polled den Status einer existierenden Bestellung. Wird typisch
   *  vom Sweeper alle paar Stunden aufgerufen, plus on-demand vom
   *  Studio ('Status aktualisieren'-Button). */
  getOrderStatus(
    credentials: unknown,
    providerOrderRef: string
  ): Promise<ProviderOrderStatus>;
}

/**
 * Hilfs-Klasse fuer noch-nicht-implementierte Adapter. Wirft kontrolliert
 * mit klarer Fehlermeldung statt undefined-Calls.
 */
export class NotImplementedAdapter implements PrintAdapter {
  constructor(private providerKey: string) {}

  private err(): never {
    throw new Error(
      `Print-Adapter '${this.providerKey}' ist noch nicht implementiert. ` +
        `Aktuell wird dieser Provider nur als Stub gefuehrt — die API-Anbindung ` +
        `folgt in einer spaeteren Phase.`
    );
  }

  validateCredentials(): Promise<{ ok: boolean; error?: string }> {
    return Promise.resolve({
      ok: false,
      error: "Provider noch nicht aktiv",
    });
  }

  fetchCatalog(): never {
    return this.err();
  }

  submitOrder(): never {
    return this.err();
  }

  getOrderStatus(): never {
    return this.err();
  }
}
