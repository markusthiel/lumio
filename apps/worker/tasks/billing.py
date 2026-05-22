"""
Lumio Worker — Stripe Webhook Processor

Verarbeitet Stripe-Webhook-Events asynchron. Der API-Endpoint
POST /billing/webhook:
  1. validiert die Stripe-Signatur (sync)
  2. legt einen stripe_webhook_events-Row an
  3. enqueued einen Job in lumio:jobs:stripe_webhook
  4. antwortet sofort 200 OK

Dieser Worker holt die Jobs aus dem Stream, lookups den Row in der DB,
und verarbeitet je nach Event-Type:

  - customer.subscription.created/updated/deleted
      -> billing_subscriptions upsert (Mirror von stripe-service.ts
         syncSubscriptionFromStripe)
  - invoice.paid
      -> Subscription auf 'active', readOnlySince=null
  - invoice.payment_failed
      -> Subscription auf 'past_due'
  - checkout.session.completed
      -> Initial-Sign-up: Tenant <-> Customer mapping persisten

Bei Fehlern: stripe_webhook_events.status = 'failed' + errorMessage.
Kein automatisches Retry — Operator kann manuell wieder triggern.
"""
from __future__ import annotations

import json
import os
from datetime import datetime, timezone
from typing import Any

import psycopg
import structlog

from app import app
from db import get_conn

log = structlog.get_logger(__name__)


# =============================================================================
# Helpers
# =============================================================================
def _find_plan_by_stripe_price(
    conn: psycopg.Connection, price_id: str
) -> dict[str, Any] | None:
    row = conn.execute(
        'SELECT id, slug, "stripePriceIdMonthly", "stripePriceIdYearly" '
        'FROM billing_plans '
        'WHERE "stripePriceIdMonthly" = %s OR "stripePriceIdYearly" = %s '
        'LIMIT 1',
        (price_id, price_id),
    ).fetchone()
    return dict(row) if row else None


def _find_tenant_by_customer(
    conn: psycopg.Connection, customer_id: str
) -> str | None:
    row = conn.execute(
        'SELECT id FROM tenants WHERE "stripeCustomerId" = %s LIMIT 1',
        (customer_id,),
    ).fetchone()
    return str(row["id"]) if row else None


def _sync_subscription(
    conn: psycopg.Connection,
    tenant_id: str,
    sub: dict[str, Any],
) -> None:
    """Aus einem Stripe-Subscription-Object den billing_subscriptions-Row
    upserten. Items werden via price.lookup_key in Plan-Item vs Storage-
    Pack-Item aufgedröselt."""
    items = sub.get("items", {}).get("data", [])
    plan_item = None
    storage_item = None
    for item in items:
        lookup_key = (item.get("price") or {}).get("lookup_key") or ""
        if lookup_key.startswith("plan_"):
            plan_item = item
        elif lookup_key.startswith("storage_pack_"):
            storage_item = item

    if not plan_item:
        keys = [(i.get("price") or {}).get("lookup_key") or "?" for i in items]
        raise RuntimeError(
            f"Subscription {sub['id']} hat kein Plan-Item — lookup_keys: {keys}"
        )

    price_id = plan_item["price"]["id"]
    plan = _find_plan_by_stripe_price(conn, price_id)
    if not plan:
        raise RuntimeError(
            f"Plan für Stripe-Price {price_id} nicht in DB — "
            f"Bootstrap-Script gelaufen?"
        )

    storage_addon_gib = 0
    if storage_item:
        storage_addon_gib = (storage_item.get("quantity") or 0) * 50

    billing_interval = (
        "yearly" if price_id == plan["stripePriceIdYearly"] else "monthly"
    )

    period_start = datetime.fromtimestamp(
        sub["current_period_start"], tz=timezone.utc
    )
    period_end = datetime.fromtimestamp(
        sub["current_period_end"], tz=timezone.utc
    )
    trial_end = (
        datetime.fromtimestamp(sub["trial_end"], tz=timezone.utc)
        if sub.get("trial_end")
        else None
    )

    storage_item_id = storage_item["id"] if storage_item else None
    cancel_at_period_end = bool(sub.get("cancel_at_period_end"))
    status = sub["status"]
    reset_readonly = status in ("active", "trialing")

    conn.execute(
        '''
        INSERT INTO billing_subscriptions (
          "tenantId", "planId", status, "billingInterval",
          "stripeSubscriptionId", "stripePlanItemId",
          "stripeStorageAddonItemId", "storageAddonGib",
          "currentPeriodStart", "currentPeriodEnd",
          "cancelAtPeriodEnd", "trialEndsAt", "readOnlySince",
          "createdAt", "updatedAt"
        ) VALUES (
          %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s, NULL, NOW(), NOW()
        )
        ON CONFLICT ("tenantId") DO UPDATE SET
          "planId" = EXCLUDED."planId",
          status = EXCLUDED.status,
          "billingInterval" = EXCLUDED."billingInterval",
          "stripeSubscriptionId" = EXCLUDED."stripeSubscriptionId",
          "stripePlanItemId" = EXCLUDED."stripePlanItemId",
          "stripeStorageAddonItemId" = EXCLUDED."stripeStorageAddonItemId",
          "storageAddonGib" = EXCLUDED."storageAddonGib",
          "currentPeriodStart" = EXCLUDED."currentPeriodStart",
          "currentPeriodEnd" = EXCLUDED."currentPeriodEnd",
          "cancelAtPeriodEnd" = EXCLUDED."cancelAtPeriodEnd",
          "trialEndsAt" = EXCLUDED."trialEndsAt",
          "readOnlySince" = CASE WHEN %s THEN NULL ELSE billing_subscriptions."readOnlySince" END,
          "updatedAt" = NOW()
        ''',
        (
            tenant_id, plan["id"], status, billing_interval,
            sub["id"], plan_item["id"], storage_item_id,
            storage_addon_gib, period_start, period_end,
            cancel_at_period_end, trial_end,
            reset_readonly,
        ),
    )

    log.info(
        "stripe.subscription_synced",
        tenant_id=tenant_id,
        subscription_id=sub["id"],
        status=status,
        plan_slug=plan["slug"],
        billing_interval=billing_interval,
        storage_addon_gib=storage_addon_gib,
    )


# =============================================================================
# Event-Handler
# =============================================================================
def _handle_subscription_event(
    conn: psycopg.Connection, event: dict[str, Any]
) -> str | None:
    sub = event["data"]["object"]
    customer_id = sub["customer"]
    tenant_id = _find_tenant_by_customer(conn, customer_id)
    if not tenant_id:
        log.warning(
            "stripe.subscription.no_tenant_for_customer",
            customer_id=customer_id,
            subscription_id=sub["id"],
        )
        return None

    if event["type"] == "customer.subscription.deleted":
        conn.execute(
            'UPDATE billing_subscriptions '
            'SET status = %s, "updatedAt" = NOW() '
            'WHERE "tenantId" = %s',
            ("canceled", tenant_id),
        )
        log.info(
            "stripe.subscription_deleted",
            tenant_id=tenant_id,
            subscription_id=sub["id"],
        )
    else:
        _sync_subscription(conn, tenant_id, sub)

    return tenant_id


def _handle_invoice_paid(
    conn: psycopg.Connection, event: dict[str, Any]
) -> str | None:
    invoice = event["data"]["object"]
    customer_id = invoice.get("customer")
    if not customer_id:
        return None
    tenant_id = _find_tenant_by_customer(conn, customer_id)
    if not tenant_id:
        return None

    conn.execute(
        'UPDATE billing_subscriptions '
        'SET "readOnlySince" = NULL, "updatedAt" = NOW() '
        'WHERE "tenantId" = %s AND status IN (%s, %s)',
        (tenant_id, "past_due", "unpaid"),
    )
    log.info(
        "stripe.invoice_paid",
        tenant_id=tenant_id,
        invoice_id=invoice["id"],
        amount_paid=invoice.get("amount_paid"),
    )
    return tenant_id


def _handle_invoice_payment_failed(
    conn: psycopg.Connection, event: dict[str, Any]
) -> str | None:
    invoice = event["data"]["object"]
    customer_id = invoice.get("customer")
    if not customer_id:
        return None
    tenant_id = _find_tenant_by_customer(conn, customer_id)
    if not tenant_id:
        return None

    conn.execute(
        'UPDATE billing_subscriptions '
        'SET status = %s, "updatedAt" = NOW() '
        'WHERE "tenantId" = %s',
        ("past_due", tenant_id),
    )
    log.warning(
        "stripe.invoice_payment_failed",
        tenant_id=tenant_id,
        invoice_id=invoice["id"],
        amount_due=invoice.get("amount_due"),
    )
    # TODO E-Mail an Owner via mail-service (Sprint 2 Phase 2)
    return tenant_id


def _handle_checkout_completed(
    conn: psycopg.Connection, event: dict[str, Any]
) -> str | None:
    session = event["data"]["object"]
    customer_id = session.get("customer")
    tenant_id = (session.get("metadata") or {}).get("lumio_tenant_id")

    if not customer_id or not tenant_id:
        log.warning(
            "stripe.checkout.missing_metadata",
            customer_id=customer_id,
            tenant_id=tenant_id,
        )
        return None

    conn.execute(
        'UPDATE tenants SET "stripeCustomerId" = %s '
        'WHERE id = %s AND "stripeCustomerId" IS NULL',
        (customer_id, tenant_id),
    )
    log.info(
        "stripe.checkout_completed",
        tenant_id=tenant_id,
        customer_id=customer_id,
        session_id=session["id"],
    )
    return tenant_id


# =============================================================================
# Main Task
# =============================================================================
@app.task(name="tasks.billing.process_stripe_event")
def process_stripe_event(event_id: str) -> dict:
    """Verarbeitet einen Stripe-Webhook-Event. event_id ist die Stripe-
    Event-ID. Wir lookups die zugehörige Row in stripe_webhook_events,
    schalten je nach event.type um, und setzen den Status am Ende auf
    'processed' oder 'failed'."""
    log.info("stripe.webhook.processing", event_id=event_id)

    with get_conn() as conn:
        row = conn.execute(
            'SELECT id, type, payload, status '
            'FROM stripe_webhook_events '
            'WHERE "stripeEventId" = %s',
            (event_id,),
        ).fetchone()

        if not row:
            log.error("stripe.webhook.event_not_found", event_id=event_id)
            return {"status": "missing", "event_id": event_id}

        if row["status"] != "received":
            log.info(
                "stripe.webhook.already_processed",
                event_id=event_id,
                status=row["status"],
            )
            return {"status": "skipped", "event_id": event_id}

        payload = row["payload"]
        if isinstance(payload, str):
            payload = json.loads(payload)

        event_type = row["type"]
        tenant_id: str | None = None
        try:
            if event_type.startswith("customer.subscription."):
                tenant_id = _handle_subscription_event(conn, payload)
            elif event_type == "invoice.paid":
                tenant_id = _handle_invoice_paid(conn, payload)
            elif event_type == "invoice.payment_failed":
                tenant_id = _handle_invoice_payment_failed(conn, payload)
            elif event_type == "checkout.session.completed":
                tenant_id = _handle_checkout_completed(conn, payload)
            else:
                # Ignorable: payment_method.attached etc. Trotzdem
                # auf processed setzen damit der Row nicht hängt.
                log.info(
                    "stripe.webhook.ignored_event_type",
                    event_id=event_id,
                    type=event_type,
                )

            conn.execute(
                'UPDATE stripe_webhook_events '
                'SET status = %s, "tenantId" = %s, "processedAt" = NOW() '
                'WHERE id = %s',
                ("processed", tenant_id, row["id"]),
            )
            return {
                "status": "processed",
                "event_id": event_id,
                "type": event_type,
                "tenant_id": tenant_id,
            }

        except Exception as e:
            err_msg = f"{type(e).__name__}: {e}"
            log.error(
                "stripe.webhook.processing_failed",
                event_id=event_id,
                type=event_type,
                error=err_msg,
            )
            conn.execute(
                'UPDATE stripe_webhook_events '
                'SET status = %s, "errorMessage" = %s, "processedAt" = NOW() '
                'WHERE id = %s',
                ("failed", err_msg[:1000], row["id"]),
            )
            return {
                "status": "failed",
                "event_id": event_id,
                "type": event_type,
                "error": err_msg,
            }


# =============================================================================
# Periodische Stubs (Sprint 2 Phase 2)
# =============================================================================
@app.task(name="tasks.billing.update_tenant_usage")
def update_tenant_usage(tenant_id: str | None = None) -> dict:
    """Aggregiert Speicher-Bytes pro Tenant in billing_subscriptions."""
    log.info("billing.update_tenant_usage", tenant_id=tenant_id)
    return {"status": "stub", "tenant_id": tenant_id}


@app.task(name="tasks.billing.enforce_limits")
def enforce_limits() -> dict:
    """Trial-Lifecycle + Storage-Limit-Enforcement. Read-only nach 14 Tagen
    ohne Subscription, archiviert nach 44."""
    log.info("billing.enforce_limits")
    return {"status": "stub"}


@app.task(name="tasks.billing.reset_monthly_bandwidth")
def reset_monthly_bandwidth() -> dict:
    log.info("billing.reset_monthly_bandwidth")
    return {"status": "stub"}
