"""
Lumio Worker — billing

Periodische Jobs für das Billing-Modul (nur aktiv mit BILLING_ENABLED=true):

  - update_tenant_usage:   Speicher- und Bandbreiten-Nutzung pro Tenant aggregieren
  - enforce_limits:        Tenants pausieren/warnen, deren Limits überschritten sind
  - report_usage_to_stripe: Usage-Records an Stripe für Usage-based Billing senden
"""
from __future__ import annotations

import structlog
from app import app

log = structlog.get_logger(__name__)


@app.task(name="tasks.billing.update_tenant_usage")
def update_tenant_usage(tenant_id: str | None = None) -> dict:
    """Aggregiert Speicher-Bytes aus files + renditions pro Tenant und schreibt
    den Wert in billing_subscriptions.storage_bytes_used.

    Wenn tenant_id=None: für alle aktiven Tenants.
    """
    log.info("billing.update_tenant_usage", tenant_id=tenant_id)
    # TODO: SQL — SELECT t.id, SUM(f.size_bytes) + SUM(r.size_bytes) FROM ...
    return {"status": "stub", "tenant_id": tenant_id}


@app.task(name="tasks.billing.enforce_limits")
def enforce_limits() -> dict:
    """Vergleicht Nutzung mit Plan-Limits. Bei Überschreitung:
      - Storage: neue Uploads blockieren (Flag im Tenant)
      - Bandwidth: Warnung an Owner per E-Mail
      - Wenn >7 Tage past_due: Tenant suspendieren
    """
    log.info("billing.enforce_limits")
    return {"status": "stub"}


@app.task(name="tasks.billing.reset_monthly_bandwidth")
def reset_monthly_bandwidth() -> dict:
    """Setzt bandwidth_bytes_used zurück (am 1. des Monats per Celery Beat)."""
    log.info("billing.reset_monthly_bandwidth")
    return {"status": "stub"}
