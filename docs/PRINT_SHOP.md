**English** · [Deutsch](PRINT_SHOP.de.md)

# Print shop — providers & adapters

As of: 2026-06-04

This document records the real state of the print shop as well as the deliberately deferred points. It replaces the earlier blanket (and misleading) note "12 print providers are NotImplemented".

## Architecture

The print shop cleanly separates Lumio logic from lab-specific integration:

- **Adapter interface** (`apps/api/src/services/print/adapters/base.ts`): every provider implements `validateCredentials`, `fetchCatalog`, `submitOrder`, `getOrderStatus`. Adapters are **stateless** — they get credentials + an order object passed in and have no DB access of their own. The service layer checks access/tenant before an adapter is called.
- **Provider registry** (`apps/api/src/services/print/providers.ts`): the central code definition of all providers (label, market, credential fields, stage, adapter instance). A registry entry does **not** mean the provider is active — that's decided by the super admin.
- **Stages**: `production` (live), `beta` (the API works, not yet released to everyone), `planned` (stub via `NotImplementedAdapter`), `self_print` (special case).
- **Service/order layer**: `shop.ts`, `orders.ts`, `payment.ts`, `stripe-connect.ts`, `credentials.ts`. Routes: `routes/print-shop.ts` (studio) and `routes/print-shop-public.ts` (customer).

## Current provider status

| Provider | Stage | Adapter | Status |
|---|---|---|---|
| Self print (`manual_self_print`) | self_print | `ManualSelfPrintAdapter` | **Fully functional.** Orders are forwarded to the studio with the delivery address. Always available, no super-admin activation needed. |
| Prodigi (`prodigi`) | beta | `ProdigiAdapter` | **Fully implemented** against Print API v4.0 (create order, status/tracking, sandbox toggle). Production-ready, but not yet switched to `production`. |
| Gelato (`gelato`) | beta | `GelatoAdapter` | **Fully implemented** against Order Flow API v4 (create order, status/tracking; no separate sandbox URL). Production-ready, but `beta`. |
| WhiteWall, Saal Digital, CEWE Pro, ProfiLab, myposter, Pixum, Posterlounge, Albelli, Lalalab, MPIX, Bonusprint | planned | `NotImplementedAdapter` | Stub. See "Why the planned labs are blocked". |

Together, Gelato and Prodigi cover the relevant range (prints, posters, canvas, frames, photo books) with dense EU/DE production. For a working print offering these two plus self print are enough.

## Why the `planned` labs are blocked

The German/EU/US consumer labs (WhiteWall, Saal, CEWE, Pixum, myposter, etc.) almost all have **no open self-service ordering API**. A real integration requires:

1. A partner/B2B account at the respective lab (activation, sometimes an NDA).
2. Their actual API docs (usually behind a partner login/NDA).
3. Sandbox credentials for testing.

That's a **business onboarding step, not a pure coding matter**. Building an adapter against guessed endpoints would be worthless code that breaks in production. These providers therefore deliberately stay as stubs until concrete partner access incl. docs is available.

## Adding a new provider

1. An entry in the registry (`providers.ts`): `key`, `label`, `market`, `credentialFields`, `categories`, initially `stage: "planned"` with `new NotImplementedAdapter("<key>")`.
2. Implement the adapter under `services/print/adapters/<key>.ts` (template: `prodigi.ts` / `gelato.ts`).
3. In the registry, replace the `NotImplementedAdapter` with the real adapter and set the stage to `beta`.
4. Activation happens per platform via the super admin (`/super/print-providers`); the tenant enters its credentials in the studio.

## Deferred (TODO, deliberately not now)

- **Gelato/Prodigi `beta` → `production`**: after a test with real sandbox/live keys, bump the stage. A pure registry edit.
- **Crop pre-rendering**: a free crop set by the customer (`order.items[].crop`) is currently not passed to the lab (Gelato/Prodigi get the full file, Prodigi uses `sizing: "fillPrintArea"`). Cleaner would be: the worker creates a cropped high-res rendition from the crop and the adapter sends its signed URL. The biggest quality lever.
- **Dynamic catalog import** (`fetchCatalog`): Gelato/Prodigi address products via SKUs/productUids that the photographer currently enters manually as `providerVariantRef`. An automatic import is optional.
- **Further concrete labs**: only once partner API access (account + docs + sandbox key) for a specific lab is available — then build that one adapter specifically.
