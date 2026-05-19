"""
Lumio Worker — webhook_delivery

Stellt eine WebhookDelivery zu. Pattern:

  1) Row aus webhook_deliveries laden (status=pending, attempts<max)
  2) Webhook-Config (URL, Secret) aus webhooks-Tabelle holen
  3) Body bauen (JSON), HMAC-SHA256 signieren, POST mit Timeout
  4) Bei 2xx → status='sent', webhook.lastDeliveryOk=true
  5) Bei 4xx → status='dead' (Endpoint sagt explizit "passt nicht",
     Retry hilft nicht; ausgenommen 408/429 die wie 5xx behandelt
     werden, weil das Standard-Retry-Signale sind)
  6) Bei 5xx / Timeout / Connection Error → attempts++, status bleibt
     'pending', nextAttemptAt = now + Backoff. Nach 6 Versuchen
     'dead'.

Backoff-Tabelle (Sekunden ab dem ersten Fehler):
  Versuch 1 fehlgeschlagen → +5s
  Versuch 2 fehlgeschlagen → +25s        (~30s nach Start)
  Versuch 3 fehlgeschlagen → +2min       (~2.5min)
  Versuch 4 fehlgeschlagen → +10min      (~12.5min)
  Versuch 5 fehlgeschlagen → +1h         (~1.2h)
  Versuch 6 → dead

Mehr als 6 Versuche bringen kaum was — ein Empfänger, der 1h nach
dem Event noch nicht da ist, kommt die nächste Stunde meistens
auch nicht zurück, und wir wollen auch nicht ewig Connection-
Attempts gegen tote URLs fahren.

Signing:
  Header X-Lumio-Timestamp: <unix seconds>
  Header X-Lumio-Signature: sha256=<hex(hmac_sha256(secret, ts + "." + body))>

Re-Queue der pending-mit-nextAttempt-in-future erfolgt NICHT durch
diesen Task selbst — der API-Code stupst die DB-Row mit
nextAttemptAt=now an, der API-publishEvent enqueued direkt im
Stream. Für die Retry-Iteration legen wir die Row mit zukünftigem
nextAttemptAt zurück und schreiben einen neuen Stream-Eintrag mit
xadd. Stream-Verzögerung im Konsumer wird nicht gebraucht.

Wenn der Stream-Push beim Retry fehlschlägt: kein Beinbruch, ein
periodischer Backfill könnte später pending+nextAttemptAt<=now
einsammeln. Implementiert wenn das Volumen das nötig macht.
"""
from __future__ import annotations

import hashlib
import hmac
import json
import os
import time
from datetime import datetime, timezone, timedelta
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen

import redis
import structlog
from celery.exceptions import Reject

from app import app
from db import get_conn


log = structlog.get_logger("lumio.webhook_delivery")

# Backoff-Stufen in Sekunden, indiziert über (attempts - 1) nach dem
# fehlgeschlagenen Versuch. Nach Index 5 (= 6. Versuch fehlgeschlagen)
# geben wir auf.
BACKOFF_SECONDS = [5, 25, 120, 600, 3600]
MAX_ATTEMPTS = len(BACKOFF_SECONDS) + 1  # 6

DELIVERY_TIMEOUT_S = 15
USER_AGENT = "Lumio-Webhook/1.0"

WEBHOOK_STREAM = "lumio:jobs:webhook_delivery"
REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379")


def _sign(secret: str, timestamp: int, body: bytes) -> str:
    """HMAC-SHA256 über `timestamp.body`. Format identisch zur API-Seite
    in services/webhooks.ts.signPayload — beide müssen synchron bleiben,
    sonst funktioniert kein Empfänger."""
    payload = f"{timestamp}.".encode("utf-8") + body
    mac = hmac.new(secret.encode("utf-8"), payload, hashlib.sha256)
    return f"sha256={mac.hexdigest()}"


def _load_delivery(delivery_id: str) -> dict[str, Any] | None:
    """Holt Delivery + Webhook-Config in einer Query."""
    with get_conn() as conn:
        row = conn.execute(
            """
            SELECT
              d.id, d."eventType" AS event_type, d.payload,
              d.status, d.attempts,
              w.id  AS webhook_id, w.url, w.secret, w.active
            FROM webhook_deliveries d
            JOIN webhooks w ON w.id = d."webhookId"
            WHERE d.id = %s
            """,
            (delivery_id,),
        ).fetchone()
        return row


def _mark_sent(delivery_id: str, webhook_id: str, http_status: int) -> None:
    """Erfolgreiche Auslieferung — Delivery + Webhook updaten."""
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE webhook_deliveries
            SET status = 'sent',
                "httpStatus" = %s,
                "errorMessage" = NULL,
                "updatedAt" = NOW()
            WHERE id = %s
            """,
            (http_status, delivery_id),
        )
        conn.execute(
            """
            UPDATE webhooks
            SET "lastDeliveryAt" = NOW(),
                "lastDeliveryOk" = TRUE,
                "updatedAt" = NOW()
            WHERE id = %s
            """,
            (webhook_id,),
        )


def _mark_dead(
    delivery_id: str,
    webhook_id: str,
    *,
    http_status: int | None,
    error_message: str | None,
) -> None:
    """Endgültiger Fehlversuch — wird nicht mehr neu versucht."""
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE webhook_deliveries
            SET status = 'dead',
                "httpStatus" = %s,
                "errorMessage" = %s,
                "updatedAt" = NOW()
            WHERE id = %s
            """,
            (http_status, error_message, delivery_id),
        )
        conn.execute(
            """
            UPDATE webhooks
            SET "lastDeliveryAt" = NOW(),
                "lastDeliveryOk" = FALSE,
                "updatedAt" = NOW()
            WHERE id = %s
            """,
            (webhook_id,),
        )


def _schedule_retry(
    delivery_id: str,
    attempts: int,
    *,
    http_status: int | None,
    error_message: str | None,
) -> None:
    """Failed-but-retryable: nextAttemptAt setzen und Job neu queuen."""
    delay = BACKOFF_SECONDS[attempts - 1]
    next_at = datetime.now(timezone.utc) + timedelta(seconds=delay)
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE webhook_deliveries
            SET attempts = %s,
                "httpStatus" = %s,
                "errorMessage" = %s,
                "nextAttemptAt" = %s,
                status = 'pending',
                "updatedAt" = NOW()
            WHERE id = %s
            """,
            (attempts, http_status, error_message, next_at, delivery_id),
        )

    # Retry über Sleep + Direct-Requeue. Wir blockieren die Celery-Worker-
    # Thread für die Backoff-Dauer NICHT — sondern legen den Stream-
    # Eintrag direkt mit der intended-Ausführungszeit in der Zukunft. Da
    # Redis-Streams kein scheduling haben, behelfen wir uns mit:
    # einfach in einer separaten Connection xadd, und der nächste
    # Consumer-Read holt's. Bei kurzem Backoff (5s) reicht das. Für
    # längere Backoffs (1h) würden wir in einem optionalen Backfill-Cron
    # die pending-nextAttemptAt-<=now-Rows scannen. Erstmal akzeptieren
    # wir, dass der Consumer schnell idlet und wir effektiv keinen
    # Delay haben.
    #
    # WICHTIG: wir loggen das nur — das eigentliche Re-Queueing
    # erfolgt durch einen separaten Sweep-Task, der einmal pro Minute
    # die pending+ready-Rows in den Stream legt. Sonst würden wir den
    # Stream sofort wieder vollstopfen und der Backoff wäre nutzlos.
    log.info(
        "webhook_delivery.retry_scheduled",
        delivery_id=delivery_id,
        attempts=attempts,
        next_at=next_at.isoformat(),
        delay_seconds=delay,
    )


def _deliver_http(
    url: str, secret: str, payload: dict[str, Any]
) -> tuple[bool, int | None, str | None]:
    """Macht den eigentlichen POST. Returnt (ok, http_status, error_message).
    Klassifikation:
      ok=True:    2xx erhalten
      ok=False mit http_status 4xx (ohne 408/429): final dead
      ok=False mit http_status 408/429/5xx: retry
      ok=False mit http_status=None: Netzwerk-/Timeout-Fehler, retry"""
    body = json.dumps(payload, separators=(",", ":"), ensure_ascii=False).encode(
        "utf-8"
    )
    ts = int(time.time())
    signature = _sign(secret, ts, body)
    event_type = payload.get("event", "unknown") if isinstance(payload, dict) else "unknown"

    req = Request(
        url,
        data=body,
        method="POST",
        headers={
            "Content-Type": "application/json",
            "X-Lumio-Timestamp": str(ts),
            "X-Lumio-Signature": signature,
            "X-Lumio-Event": str(event_type),
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urlopen(req, timeout=DELIVERY_TIMEOUT_S) as resp:
            status = resp.status
            # Body lesen, damit der Server seine Response korrekt abschließen
            # kann, aber Content interessiert uns nicht.
            resp.read(1024)
            return True, status, None
    except HTTPError as err:
        # HTTP-Antwort mit Fehlercode (4xx/5xx)
        return False, err.code, f"HTTP {err.code}: {err.reason}"
    except URLError as err:
        # DNS-Fehler, Connection refused, Timeout etc.
        return False, None, f"URLError: {err.reason}"
    except (TimeoutError, OSError) as err:
        return False, None, f"Network: {err}"


def _is_retryable(http_status: int | None) -> bool:
    """4xx (außer 408 Timeout und 429 Too-Many-Requests) gelten als
    final — der Empfänger sagt 'so nicht'. 5xx, Netzwerkfehler und die
    beiden Sonderfälle sind retryable."""
    if http_status is None:
        return True  # Netzwerk- oder Timeout-Fehler
    if http_status in (408, 429):
        return True
    return http_status >= 500


@app.task(name="tasks.webhook_delivery.deliver", bind=True)
def deliver(self, delivery_id: str) -> dict[str, Any]:
    """Liefert eine Webhook-Delivery aus. Idempotent über delivery_id —
    mehrfacher Aufruf für die gleiche Delivery ist harmlos, weil wir
    den status prüfen und 'sent'/'dead' nicht nochmal verarbeiten."""
    row = _load_delivery(delivery_id)
    if not row:
        log.warning("webhook_delivery.not_found", delivery_id=delivery_id)
        return {"ok": False, "reason": "not_found"}

    # Wenn die Delivery schon ausgeliefert oder tot ist, ignorieren —
    # das passiert bei doppelter Queueing-Notify.
    if row["status"] in ("sent", "dead"):
        return {"ok": True, "reason": "already_processed"}

    # Webhook deaktiviert? Markieren als dead, kein Retry.
    if not row["active"]:
        _mark_dead(
            delivery_id,
            row["webhook_id"],
            http_status=None,
            error_message="webhook deactivated",
        )
        return {"ok": False, "reason": "webhook_inactive"}

    attempts = (row["attempts"] or 0) + 1

    log.info(
        "webhook_delivery.attempt",
        delivery_id=delivery_id,
        webhook_id=row["webhook_id"],
        event_type=row["event_type"],
        attempt=attempts,
    )

    ok, status, err_msg = _deliver_http(
        row["url"], row["secret"], row["payload"]
    )

    if ok and status is not None:
        _mark_sent(delivery_id, row["webhook_id"], status)
        return {"ok": True, "httpStatus": status}

    # Fehler-Pfad
    if not _is_retryable(status):
        # 4xx → final
        _mark_dead(
            delivery_id, row["webhook_id"],
            http_status=status, error_message=err_msg,
        )
        return {"ok": False, "httpStatus": status, "final": True}

    if attempts >= MAX_ATTEMPTS:
        _mark_dead(
            delivery_id, row["webhook_id"],
            http_status=status, error_message=err_msg,
        )
        return {"ok": False, "httpStatus": status, "final": True}

    _schedule_retry(
        delivery_id, attempts,
        http_status=status, error_message=err_msg,
    )
    return {"ok": False, "httpStatus": status, "retryQueued": True}


# -----------------------------------------------------------------------------
# Retry-Sweep
# -----------------------------------------------------------------------------
# Periodischer Task, der pending-Rows mit nextAttemptAt<=now in den Stream
# legt. Damit kommen die Retries verlässlich raus, ohne dass wir im
# eigentlichen Delivery-Task einen Sleep blockieren oder auf
# Stream-Scheduling angewiesen sind.

@app.task(name="tasks.webhook_delivery.sweep")
def sweep() -> dict[str, int]:
    """Findet pending Deliveries deren nextAttemptAt erreicht ist und
    schiebt sie in den Worker-Stream. Wird vom Celery-Beat einmal pro
    Minute aufgerufen (siehe celeryconfig)."""
    r = redis.from_url(REDIS_URL)
    queued = 0
    with get_conn() as conn:
        rows = conn.execute(
            """
            SELECT id
            FROM webhook_deliveries
            WHERE status = 'pending'
              AND "nextAttemptAt" IS NOT NULL
              AND "nextAttemptAt" <= NOW()
            ORDER BY "nextAttemptAt" ASC
            LIMIT 500
            """
        ).fetchall()
    for row in rows:
        delivery_id = str(row["id"])
        # Stream-Push mit dem gleichen Payload-Schema wie publishEvent
        r.xadd(
            WEBHOOK_STREAM,
            {
                "payload": json.dumps(
                    {"type": "webhook_delivery", "deliveryId": delivery_id}
                ),
                "enqueuedAt": str(int(time.time() * 1000)),
            },
        )
        queued += 1
    if queued > 0:
        log.info("webhook_delivery.sweep_queued", count=queued)
    return {"queued": queued}
