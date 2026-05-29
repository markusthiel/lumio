/**
 * Lumio API — Prodigi-Adapter (Print API v4.0)
 *
 * Prodigi ist ein Self-Service-Print-Lab (UK/EU) mit Fine-Art-Fokus.
 * API-Doku: https://www.prodigi.com/print-api/docs/reference/
 *
 * Auth: X-API-Key-Header. Zwei Umgebungen:
 *   - Sandbox: api.sandbox.prodigi.com  (kostenlos, druckt/berechnet NICHTS)
 *   - Live:    api.prodigi.com
 * Der Tenant wählt die Umgebung über das 'sandbox'-Credential-Feld.
 *
 * Implementiert:
 *   - validateCredentials → leichter authentifizierter GET auf /Orders
 *   - submitOrder         → POST /v4.0/Orders
 *   - getOrderStatus      → GET /v4.0/Orders/{id} + Shipment-Tracking
 *   - fetchCatalog        → leer (SKUs werden manuell eingetragen, s.u.)
 *
 * Katalog-Hinweis: Prodigi hat keinen "alle Produkte"-Endpoint — Produkte
 * werden per SKU adressiert (z.B. GLOBAL-FAP-16x24 für einen Fine-Art-
 * Print). Der Fotograf trägt die gewünschte SKU beim Produkt-Anlegen als
 * providerVariantRef ein (aus dem Prodigi-Dashboard/Katalog). Ein
 * dynamischer Katalog-Import ist als spätere Ausbaustufe vorgesehen.
 *
 * Crop-Hinweis: Wir senden sizing="fillPrintArea" — das Lab zentriert und
 * beschneidet aufs Druck-Seitenverhältnis. Ein vom Kunden gesetzter freier
 * Crop (order.items[].crop) wird hier NICHT ans Lab übergeben; falls ein
 * Crop vorliegt, sollte serverseitig vorab eine zugeschnittene Rendition
 * erzeugt und deren URL übergeben werden (spätere Ausbaustufe).
 */
import type {
  PrintAdapter,
  ProviderOrderRequest,
  ProviderOrderResponse,
  ProviderOrderStatus,
} from "./base.js";

interface ProdigiCredentials {
  apiKey: string;
  sandbox?: boolean;
}

function parseCredentials(credentials: unknown): ProdigiCredentials {
  const c = (credentials ?? {}) as Record<string, unknown>;
  const apiKey = typeof c.apiKey === "string" ? c.apiKey.trim() : "";
  if (!apiKey) {
    throw new Error("Prodigi: apiKey fehlt in den Credentials");
  }
  // sandbox kann als boolean oder als String "true"/"false" kommen (UI)
  const sandbox =
    c.sandbox === true || c.sandbox === "true" || c.sandbox === "1";
  return { apiKey, sandbox };
}

function baseUrl(creds: ProdigiCredentials): string {
  return creds.sandbox
    ? "https://api.sandbox.prodigi.com/v4.0"
    : "https://api.prodigi.com/v4.0";
}

type FetchInit = {
  method?: string;
  body?: string;
  headers?: Record<string, string>;
};

async function prodigiFetch(
  creds: ProdigiCredentials,
  path: string,
  init?: FetchInit
): Promise<{ status: number; body: any }> {
  const res = await fetch(`${baseUrl(creds)}${path}`, {
    ...init,
    headers: {
      "X-API-Key": creds.apiKey,
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

/** Mappt Prodigis Status-Stage auf den Lumio-Status. */
function mapStatus(stage: string | undefined): ProviderOrderStatus["status"] {
  switch ((stage ?? "").toLowerCase()) {
    case "complete":
      return "delivered";
    case "cancelled":
      return "cancelled";
    case "inprogress":
    default:
      return "in_production";
  }
}

export class ProdigiAdapter implements PrintAdapter {
  async validateCredentials(
    credentials: unknown
  ): Promise<{ ok: boolean; error?: string }> {
    let creds: ProdigiCredentials;
    try {
      creds = parseCredentials(credentials);
    } catch (e) {
      return { ok: false, error: (e as Error).message };
    }
    try {
      // Leichter authentifizierter Call: Orders-Liste (top=1). 200 → Key
      // gültig, 401/403 → Key falsch.
      const { status } = await prodigiFetch(creds, "/Orders?top=1");
      if (status === 200) return { ok: true };
      if (status === 401 || status === 403) {
        return { ok: false, error: "API-Key wurde von Prodigi abgelehnt." };
      }
      return {
        ok: false,
        error: `Unerwartete Antwort von Prodigi (HTTP ${status}).`,
      };
    } catch (e) {
      return {
        ok: false,
        error: `Verbindung zu Prodigi fehlgeschlagen: ${(e as Error).message}`,
      };
    }
  }

  async fetchCatalog(): ReturnType<PrintAdapter["fetchCatalog"]> {
    // Siehe Katalog-Hinweis im Datei-Header: SKUs werden manuell
    // eingetragen. Dynamischer Import folgt als spätere Ausbaustufe.
    return { products: [], shippingMethods: [] };
  }

  async submitOrder(
    credentials: unknown,
    order: ProviderOrderRequest
  ): Promise<ProviderOrderResponse> {
    const creds = parseCredentials(credentials);
    const a = order.shippingAddress;

    const payload = {
      merchantReference: order.externalOrderId,
      shippingMethod: order.shippingMethodRef ?? "Standard",
      recipient: {
        name: order.guest.name,
        email: order.guest.email,
        phoneNumber: order.guest.phone ?? a.phone,
        address: {
          line1: a.street,
          line2: a.street2,
          postalOrZipCode: a.postalCode,
          townOrCity: a.city,
          stateOrCounty: a.region,
          countryCode: a.countryCode,
        },
      },
      items: order.items.map((it, idx) => ({
        merchantReference: `${order.externalOrderId}-${idx + 1}`,
        sku: it.variantRef,
        copies: it.quantity,
        sizing: "fillPrintArea",
        assets: [{ printArea: "default", url: it.imageUrl }],
      })),
    };

    const { status, body } = await prodigiFetch(creds, "/Orders", {
      method: "POST",
      body: JSON.stringify(payload),
    });

    // Prodigi liefert outcome "Created"/"Ok" + order.id (ord_xxx).
    const outcome = body?.outcome ?? "";
    const prodigiId = body?.order?.id;
    if ((status === 200 || status === 201) && prodigiId) {
      return {
        providerOrderRef: prodigiId,
        message: `Prodigi-Order angelegt (${outcome})`,
      };
    }

    // Fehlerfall: Prodigi gibt detaillierte Validierungs-Hinweise zurück.
    const detail =
      body?.outcome ??
      body?.message ??
      (typeof body === "string" ? body : JSON.stringify(body));
    throw new Error(
      `Prodigi hat die Bestellung abgelehnt (HTTP ${status}): ${detail}`
    );
  }

  async getOrderStatus(
    credentials: unknown,
    providerOrderRef: string
  ): Promise<ProviderOrderStatus> {
    const creds = parseCredentials(credentials);
    const { status, body } = await prodigiFetch(
      creds,
      `/Orders/${encodeURIComponent(providerOrderRef)}`
    );
    if (status !== 200 || !body?.order) {
      throw new Error(
        `Prodigi-Status-Abfrage fehlgeschlagen (HTTP ${status}) für ${providerOrderRef}`
      );
    }

    const ord = body.order;
    const stage: string | undefined = ord?.status?.stage;
    // Versand-Info aus dem ersten Shipment mit Tracking ziehen.
    const shipment = Array.isArray(ord.shipments)
      ? ord.shipments.find((s: any) => s?.tracking?.number) ?? ord.shipments[0]
      : undefined;

    let mapped = mapStatus(stage);
    // Wenn ein Shipment versandt wurde, ist "shipped" aussagekräftiger als
    // der grobe Stage "Complete".
    if (shipment?.status && /ship|dispatch/i.test(shipment.status)) {
      mapped = mapped === "delivered" ? "delivered" : "shipped";
    }

    return {
      status: mapped,
      trackingNumber: shipment?.tracking?.number,
      trackingCarrier: shipment?.carrier?.name,
      trackingUrl: shipment?.tracking?.url,
      rawStatus: stage,
    };
  }
}
