"""
Lumio Worker — Storage Cleanup

Räumt S3-Objekte auf, nachdem eine Galerie oder ein Tenant in der DB
gelöscht wurde. Die DB-Cascade entfernt File-/Rendition-Rows, aber die
zugehörigen S3-Objekte bleiben sonst als Müll liegen.

Wird via Stream lumio:jobs:cleanup vom Backend angestossen:
  - Galerie-Delete  → cleanup_gallery (tenantId, galleryId)
  - Tenant-Delete   → cleanup_tenant  (tenantId)

Pfad-Schema (siehe apps/api/src/services/storage.ts):
  t/<tenantId>/g/<galleryId>/orig/<fileId>/...       Originale
  t/<tenantId>/g/<galleryId>/r/<fileId>/<kind>.<ext> Renditions
  t/<tenantId>/downloads/<galleryId>/...             ZIP-Cache
  t/<tenantId>/branding/...                          Branding-Assets
  t/<tenantId>/watermark/...                         Watermark-Source

Idempotent: ein zweiter Run löscht keine zusätzlichen Objekte, weil
der Prefix beim ersten Run schon leer war. ListObjects liefert dann
einfach 0 Keys.

Failure-Modes:
  - S3 partial fail: deleted_count und error_count werden geloggt,
    Task gilt trotzdem als 'success'. Bei wiederholten Errors muss
    manuell nachgesehen werden (Audit-Log + Worker-Logs).
  - Network-Timeout: boto3 hat retries=adaptive konfiguriert, plus
    Celery retries den ganzen Task bei nicht-gefangenen Exceptions.
"""
from __future__ import annotations

import structlog

from app import app
from storage import delete_prefix


log = structlog.get_logger(__name__)


@app.task(
    name="tasks.cleanup_storage.cleanup_gallery",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def cleanup_gallery(self, tenant_id: str, gallery_id: str) -> dict:
    """Räumt alle S3-Objekte einer gelöschten Galerie.

    Zwei Prefixes:
      - t/<tenantId>/g/<galleryId>/        (Originale + Renditions)
      - t/<tenantId>/downloads/<galleryId>/ (ZIP-Cache)

    Idempotent. Wird automatisch enqueued vom DELETE /galleries/:id-
    Endpoint nach erfolgreichem DB-Delete.
    """
    log.info("cleanup_gallery.start",
             tenant_id=tenant_id, gallery_id=gallery_id)

    g_prefix = f"t/{tenant_id}/g/{gallery_id}/"
    d_prefix = f"t/{tenant_id}/downloads/{gallery_id}/"

    try:
        g_result = delete_prefix(g_prefix)
        d_result = delete_prefix(d_prefix)
    except Exception as err:
        log.exception("cleanup_gallery.failed",
                      tenant_id=tenant_id, gallery_id=gallery_id,
                      err=str(err))
        raise self.retry(exc=err)

    total_deleted = g_result["deleted"] + d_result["deleted"]
    total_errors = g_result["errors"] + d_result["errors"]
    log.info("cleanup_gallery.complete",
             tenant_id=tenant_id, gallery_id=gallery_id,
             deleted=total_deleted, errors=total_errors)
    return {
        "tenant_id": tenant_id,
        "gallery_id": gallery_id,
        "deleted": total_deleted,
        "errors": total_errors,
    }


@app.task(
    name="tasks.cleanup_storage.cleanup_tenant",
    bind=True,
    max_retries=3,
    default_retry_delay=60,
)
def cleanup_tenant(self, tenant_id: str) -> dict:
    """Räumt alle S3-Objekte eines gelöschten Tenants.

    Ein einziger Prefix t/<tenantId>/ deckt alle Untergebiete ab:
    Galerien, Downloads, Branding-Assets, Watermark-Source.

    Wird vom Super-Admin Tenant-Delete-Endpoint enqueued. Bei
    grossen Tenants (z.B. 50k Files) kann der Task länger laufen
    — pro Page 1000 Keys, also bei 50k Files etwa 50 Round-Trips.
    Auf MinIO im selben Compose-Network typischerweise < 30 s.
    """
    log.info("cleanup_tenant.start", tenant_id=tenant_id)
    prefix = f"t/{tenant_id}/"
    try:
        result = delete_prefix(prefix)
    except Exception as err:
        log.exception("cleanup_tenant.failed",
                      tenant_id=tenant_id, err=str(err))
        raise self.retry(exc=err)
    log.info("cleanup_tenant.complete",
             tenant_id=tenant_id,
             deleted=result["deleted"], errors=result["errors"])
    return {
        "tenant_id": tenant_id,
        "deleted": result["deleted"],
        "errors": result["errors"],
    }
