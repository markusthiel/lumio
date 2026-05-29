/**
 * Lumio API — Gelato-Adapter (Order Flow API v4)
 *
 * Gelato ist ein globales Print-on-Demand-Netz mit sehr dichter EU-
 * Produktion (u.a. Deutschland) — kurze Lieferwege.
 * API-Doku: https://dashboard.gelato.com/docs/
 *
 * Auth: X-API-KEY-Header. Gelato hat KEINE separate Sandbox-Base-URL —
 * Tests laufen über das API-Portal bzw. echte Keys. Daher nur ein
 * apiKey-Credential-Feld (kein Sandbox-Toggle wie bei Prodigi).
 *
 * Endpoints:
 *   - Order Flow:  https://order.gelatoapis.com/v4
 *
 * Implementiert:
 *   - validateCredentials → leichter GET auf /orders
 *   - submitOrder         → POST /v4/orders
 *   - getOrderStatus      → GET /v4/orders/{id} + Shipment-Tracking
 *   - fetchCatalog        → leer (productUids werden manuell eingetragen)
 *
 * Katalog-Hinweis: Gelato adressiert Produkte über lange productUids
 * (z.B. "wall_hanger_…"/"flat_…"). Der Fotograf trägt die gewünschte
 * productUid beim Produkt-Anlegen als providerVariantRef ein (aus dem
 * Gelato-Dashboard). Dynamischer Katalog-Import: spätere Ausbaustufe.
 *
 * Crop-Hinweis: Gelato erwartet druckfertige Dateien. Ein vom Kunden
 * gesetzter freier Crop wird hier nicht angewendet — falls vorhanden,
 * sollte serverseitig vorab eine zugeschnittene Rendition erzeugt und
 * deren URL übergeben werden (spätere Ausbaustufe).
 */
import type {
  PrintAdapter,
  ProviderOrderRequest,
  ProviderOrderResponse,
  ProviderOrderStatus,
  ProviderAddress,
} from "./base.js";

const ORDER_BASE = "https://order.gelatoapis.com/v4";

interface GelatoCredentials {
  apiKey: string;
  /** Default-Währung für Orders, falls nicht anders gesetzt. */
  currency?: string;
}

function parseCredentials(credentials: unknown): GelatoCredentials {
  const c = (credentials ?? {}) as Record<string, unknown>;
  const apiKey = typeof c.apiKey === "string" ? c.apiKey.trim() : "";
  if (!apiKey) {
    throw new Error("Gelato: apiKey fehlt in den Credentials");
  }
  const currency =
    typeof c.currency === "string" && c.currency.trim()
      ? c.currency.trim().toUpperCase()
      : "EUR";
  return { apiKey, currency };
}

type FetchInit = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

async function gelatoFetch(
  creds: GelatoCredentials,
  url: string,
  init?: FetchInit
): Promise<{ status: number; body: any }> {
  const res = await fetch(url, {
    ...init,
    headers: {
      "X-API-KEY": creds.apiKey,
      "Content-Type": "application/json",
      ...(init?.headers ?? {}),
    },
  });
  let body: any = null;
  const text = await res.text();
  if (text) {
    try {
      body = JSON.parse(text);
    } catch {
      body = text;
    }
  }
  return { status: res.status, body };
}

/** Splittet "Vorname Nachname" pragmatisch am letzten Leerzeichen. */
function splitName(full: string): { firstName: string; lastName: string } {
  const trimmed = full.trim();
  const idx = trimmed.lastIndexOf(" ");
  if (idx === -1) return { firstName: trimmed, lastName: trimmed };
  return {
    firstName: trimmed.slice(0, idx),
    lastName: trimmed.slice(idx + 1),
  };
}

function toGelatoAddress(
  a: ProviderAddress,
  guest: ProviderOrderRequest["guest"]
) {
  const { firstName, lastName } = splitName(guest.name);
  return {
    firstName,
    lastName,
    addressLine1: a.street,
    addressLine2: a.street2,
    city: a.city,
    postCode: a.postalCode,
    state: a.region,
    country: a.countryCode,
    email: guest.email,
    phone: guest.phone ?? a.phone,
  };
}

/** Mappt Gelatos fulfillmentStatus auf den Lumio-Status. */
function mapStatus(s: string | undefined): ProviderOrderStatus["status"] {
  switch ((s ?? "").toLowerCase()) {
    case "shipped":
      return "shipped";
    case "delivered":
      return "delivered";
    case "canceled":
    case "cancelled":
      return "cancelled";
    case "failed":
      return "failed";
    case "created":
    case "passed":
    case "printed":
    case "in_production":
    case "production":
    default:
      return "in_production";
  }
}

export class GelatoAdapter implements PrintAdapter {
  async validateCredentials(
    credentials: unknown
  ): Promise<{ ok: boolean; error?: string }> {
    let creds: GelatoCredentials;
    try {
      creds = parseCredentials(credentials);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    try {
      // Leichter Call: Orders-Liste. 2xx → Key gültig, 401/403 → falsch.
      const { status } = await gelatoFetch(
        creds,
        `${ORDER_BASE}/orders?limit=1`
      );
      if (status >= 200 && status < 300) return { ok: true };
      if (status === 401 || status === 403) {
        return { ok: false, error: "API-Key wurde von Gelato abgelehnt." };
      }
      return {
        ok: false,
        error: `Unerwartete Antwort von Gelato (HTTP ${status}).`,
      };
    } catch (e) {
      return {
        ok: false,
        error: `Verbindung zu Gelato fehlgeschlagen: ${(e as Error).message}`,
      };
    }
  }

  async fetchCatalog(): ReturnType<PrintAdapter["fetchCatalog"]> {
    // Siehe Katalog-Hinweis im Datei-Header.
    return { products: [], shippingMethods: [] };
  }

  async submitOrder(
    credentials: unknown,
    order: ProviderOrderRequest
  ): Promise<ProviderOrderResponse> {
    const creds = parseCredentials(credentials);

    const payload = {
      orderType: "order",
      orderReferenceId: order.externalOrderId,
      customerReferenceId: order.guest.email || order.guest.name,
      currency: creds.currency,
      items: order.items.map((it, idx) => ({
        itemReferenceId: `${order.externalOrderId}-${idx + 1}`,
        productUid: it.variantRef,
        files: [{ type: "default", url: it.imageUrl }],
        quantity: it.quantity,
      })),
      shipmentMethodUid: order.shippingMethodRef ?? "normal",
      shippingAddress: toGelatoAddress(order.shippingAddress, order.guest),
    };

    const { status, body } = await gelatoFetch(creds, `${ORDER_BASE}/orders`, {
      method: "POST",
      body: JSON.stringify(payload),
    });

    const gelatoId = body?.id;
    if (status >= 200 && status < 300 && gelatoId) {
      return {
        providerOrderRef: gelatoId,
        message: "Gelato-Order angelegt",
      };
    }

    const detail =
      body?.message ??
      body?.error ??
      (typeof body === "string" ? body : JSON.stringify(body));
    throw new Error(
      `Gelato hat die Bestellung abgelehnt (HTTP ${status}): ${detail}`
    );
  }

  async getOrderStatus(
    credentials: unknown,
    providerOrderRef: string
  ): Promise<ProviderOrderStatus> {
    const creds = parseCredentials(credentials);
    const { status, body } = await gelatoFetch(
      creds,
      `${ORDER_BASE}/orders/${encodeURIComponent(providerOrderRef)}`
    );
    if (status !== 200 || !body) {
      throw new Error(
        `Gelato-Status-Abfrage fehlgeschlagen (HTTP ${status}) für ${providerOrderRef}`
      );
    }

    const fulfillment: string | undefined = body.fulfillmentStatus;
    // Tracking steckt in shipments[].
    const shipment = Array.isArray(body.shipments)
      ? body.shipments.find((s: any) => s?.trackingCode) ?? body.shipments[0]
      : undefined;

    return {
      status: mapStatus(fulfillment),
      trackingNumber: shipment?.trackingCode,
      trackingCarrier: shipment?.shipmentMethodName ?? shipment?.fulfillmentCountry,
      trackingUrl: shipment?.trackingUrl,
      rawStatus: fulfillment,
    };
  }
}
