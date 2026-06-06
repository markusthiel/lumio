[English](PRINT_SHOP.md) · **Deutsch**

# Print-Shop — Provider & Adapter

Stand: 2026-06-04

Dieses Dokument hält den realen Stand des Print-Shops fest sowie die bewusst
zurückgestellten Punkte. Es ersetzt die früher pauschale (und irreführende)
Notiz „12 Print-Provider sind NotImplemented".

## Architektur

Der Print-Shop trennt sauber zwischen Lumio-Logik und Lab-spezifischer
Anbindung:

- **Adapter-Interface** (`apps/api/src/services/print/adapters/base.ts`):
  Jeder Provider implementiert `validateCredentials`, `fetchCatalog`,
  `submitOrder`, `getOrderStatus`. Adapter sind **stateless** — sie bekommen
  Credentials + Order-Objekt übergeben und haben keinen eigenen DB-Zugriff.
  Der Service-Layer prüft Zugriff/Tenant, bevor ein Adapter aufgerufen wird.
- **Provider-Registry** (`apps/api/src/services/print/providers.ts`): zentrale
  Code-Definition aller Provider (Label, Markt, Credential-Felder, Stage,
  Adapter-Instanz). Ein Registry-Eintrag heißt **nicht**, dass der Provider
  aktiv ist — das entscheidet der Super-Admin.
- **Stages**: `production` (live), `beta` (API funktioniert, noch nicht für
  alle freigegeben), `planned` (Stub via `NotImplementedAdapter`),
  `self_print` (Sonderfall).
- **Service-/Order-Layer**: `shop.ts`, `orders.ts`, `payment.ts`,
  `stripe-connect.ts`, `credentials.ts`. Routen: `routes/print-shop.ts`
  (Studio) und `routes/print-shop-public.ts` (Kunde).

## Aktueller Stand der Provider

| Provider | Stage | Adapter | Status |
|---|---|---|---|
| Selbst drucken (`manual_self_print`) | self_print | `ManualSelfPrintAdapter` | **Voll funktional.** Bestellungen werden mit Lieferadresse an das Studio weitergeleitet. Immer verfügbar, keine Super-Admin-Aktivierung nötig. |
| Prodigi (`prodigi`) | beta | `ProdigiAdapter` | **Vollständig implementiert** gegen Print API v4.0 (Order anlegen, Status/Tracking, Sandbox-Toggle). Produktionsreif, aber noch nicht auf `production` geschaltet. |
| Gelato (`gelato`) | beta | `GelatoAdapter` | **Vollständig implementiert** gegen Order Flow API v4 (Order anlegen, Status/Tracking; keine separate Sandbox-URL). Produktionsreif, aber `beta`. |
| WhiteWall, Saal Digital, CEWE Pro, ProfiLab, myposter, Pixum, Posterlounge, Albelli, Lalalab, MPIX, Bonusprint | planned | `NotImplementedAdapter` | Stub. Siehe „Warum die planned-Labs blockiert sind". |

Gelato und Prodigi decken zusammen das relevante Sortiment ab (Prints, Poster,
Leinwand, Rahmen, Fotobücher) mit dichter EU-/DE-Produktion. Für ein
funktionierendes Print-Angebot reichen diese zwei plus Self-Print.

## Warum die `planned`-Labs blockiert sind

Die deutschen/EU-/US-Consumer-Labs (WhiteWall, Saal, CEWE, Pixum, myposter
usw.) haben fast alle **keine offene Self-Service-Bestell-API**. Eine echte
Anbindung erfordert:

1. Einen Partner-/B2B-Account beim jeweiligen Lab (Freischaltung, teils NDA).
2. Deren tatsächliche API-Doku (meist hinter Partner-Login/NDA).
3. Sandbox-Credentials zum Testen.

Das ist ein **Business-Onboarding-Schritt, kein reines Coding-Thema**. Ein
Adapter gegen geratene Endpoints zu bauen wäre wertloser Code, der in
Produktion bricht. Deshalb bleiben diese Provider bewusst als Stub, bis ein
konkreter Partner-Zugang inkl. Doku vorliegt.

## Einen neuen Provider hinzufügen

1. Eintrag in der Registry (`providers.ts`): `key`, `label`, `market`,
   `credentialFields`, `categories`, zunächst `stage: "planned"` mit
   `new NotImplementedAdapter("<key>")`.
2. Adapter unter `services/print/adapters/<key>.ts` implementieren (Vorlage:
   `prodigi.ts` / `gelato.ts`).
3. In der Registry den `NotImplementedAdapter` durch den echten Adapter
   ersetzen und Stage auf `beta` setzen.
4. Aktivierung erfolgt pro Plattform durch den Super-Admin
   (`/super/print-providers`); der Tenant hinterlegt seine Credentials im
   Studio.

## Zurückgestellt (TODO, bewusst nicht jetzt)

- **Gelato/Prodigi `beta` → `production`**: nach einem Test mit echten
  Sandbox-/Live-Keys die Stage hochsetzen. Reiner Registry-Edit.
- **Crop-Vorab-Rendering**: ein vom Kunden gesetzter freier Crop
  (`order.items[].crop`) wird derzeit nicht ans Lab übergeben (Gelato/Prodigi
  bekommen die volle Datei, Prodigi nutzt `sizing: "fillPrintArea"`). Sauberer
  wäre: Worker erzeugt aus dem Crop eine zugeschnittene High-Res-Rendition und
  der Adapter schickt deren signierte URL. Größter Qualitäts-Hebel.
- **Dynamischer Katalog-Import** (`fetchCatalog`): Gelato/Prodigi adressieren
  Produkte über SKUs/productUids, die der Fotograf aktuell manuell als
  `providerVariantRef` einträgt. Ein automatischer Import ist optional.
- **Weitere konkrete Labs**: erst wenn Partner-API-Zugang (Account + Doku +
  Sandbox-Key) für ein bestimmtes Lab vorliegt — dann gezielt diesen einen
  Adapter bauen.
