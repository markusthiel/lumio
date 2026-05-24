"""
Lumio Worker — Stream Consumer

Brücke zwischen dem API-Producer (Redis Streams) und Celery-Tasks.
Läuft als separater Prozess (siehe Dockerfile / docker-compose).

Lauschen auf drei Streams:
  lumio:jobs:file_processing   → tasks.process_file.generate_renditions
                                  oder tasks.process_raw.generate_raw_preview
  lumio:jobs:video_processing  → tasks.process_video.transcode
  lumio:jobs:zip_build         → tasks.build_zip.build

Wir verwenden Consumer-Groups, damit mehrere Worker parallel arbeiten
können und Messages bei Crashes automatisch wieder verteilt werden.
"""
from __future__ import annotations

import json
import os
import signal
import socket
import sys
import time

import redis
import structlog

from app import app


REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379")
CONSUMER_NAME = os.environ.get(
    "WORKER_CONSUMER_NAME", f"worker-{socket.gethostname()}-{os.getpid()}"
)
CONSUMER_GROUP = "lumio_workers"
BLOCK_MS = 5_000  # blockierendes Lesen in 5-Sekunden-Fenstern
CLAIM_MIN_IDLE_MS = 60_000  # nach 60s als hängend gelten

STREAMS = {
    "lumio:jobs:file_processing": "file",
    "lumio:jobs:video_processing": "video",
    "lumio:jobs:zip_build": "zip",
    "lumio:jobs:webhook_delivery": "webhook",
    # Stripe-Webhook-Verarbeitung läuft im selben Worker-Prozess,
    # aber als separater Stream. So können wir Backlog + Lag pro
    # Type beobachten und Stripe-Verarbeitung pausieren ohne die
    # File-Pipeline anzuhalten.
    "lumio:jobs:stripe_webhook": "stripe",
    # Background-Backfills (z.B. SHA-256). Eigener Stream, damit ein
    # langer Backfill nicht die Upload-Pipeline blockiert.
    "lumio:jobs:backfill": "backfill",
}

log = structlog.get_logger("lumio.consumer")
_stop = False


def _on_signal(signum, _frame):
    global _stop
    log.info("consumer.signal_received", signum=signum)
    _stop = True


def _ensure_group(r: redis.Redis, stream: str) -> None:
    """Consumer-Group anlegen, falls noch nicht da. Idempotent."""
    try:
        r.xgroup_create(name=stream, groupname=CONSUMER_GROUP,
                        id="0", mkstream=True)
        log.info("consumer.group_created", stream=stream)
    except redis.ResponseError as err:
        if "BUSYGROUP" not in str(err):
            raise


def _dispatch(stream: str, payload: dict) -> None:
    """Routet ein Job-Payload an den passenden Celery-Task."""
    job_type = payload.get("type")
    file_id = payload.get("fileId")

    if job_type == "process_file":
        app.send_task(
            "tasks.process_file.generate_renditions", args=[file_id]
        )
    elif job_type == "process_raw":
        app.send_task(
            "tasks.process_raw.generate_raw_preview", args=[file_id]
        )
    elif job_type == "process_video":
        app.send_task(
            "tasks.process_video.transcode", args=[file_id]
        )
    elif job_type == "process_watermark":
        app.send_task(
            "tasks.process_watermark.generate", args=[file_id]
        )
    elif job_type == "build_zip":
        app.send_task(
            "tasks.build_zip.build",
            args=[
                payload.get("zipDownloadId"),
                payload.get("tenantId"),
                payload.get("galleryId"),
                payload.get("fileIds"),
                payload.get("label", "all"),
                payload.get("variant", "original"),
            ],
        )
    elif job_type == "webhook_delivery":
        # Im Gegensatz zu den anderen Tasks reichen wir hier nur die
        # deliveryId weiter — alles weitere (URL, Secret, Payload, Attempts)
        # holt der Task aus der webhook_deliveries-Tabelle. Das hält den
        # Stream-Payload minimal und erleichtert Retries: der API-Code
        # bzw. der Retry-Scan re-queued mit derselben ID.
        app.send_task(
            "tasks.webhook_delivery.deliver",
            args=[payload.get("deliveryId")],
        )
    elif job_type == "stripe_webhook":
        # Wie bei webhook_delivery: nur die eventId — der Worker
        # lookups payload + status aus stripe_webhook_events.
        app.send_task(
            "tasks.billing.process_stripe_event",
            args=[payload.get("eventId")],
        )
    elif job_type == "backfill_sha256":
        # SHA-256 für alle noch-nicht-gehashten Files einer Galerie
        # berechnen. Läuft seriell durch — pro File ein S3-Download +
        # Streaming-Hash. Progress wird unter lumio:dup-scan:<galleryId>
        # in Redis veröffentlicht, das Studio-UI polled das.
        app.send_task(
            "tasks.backfill_sha256.run_for_gallery",
            args=[payload.get("galleryId")],
        )
    else:
        log.warning("consumer.unknown_job_type",
                    stream=stream, type=job_type)


def run() -> None:
    log.info("consumer.start", consumer=CONSUMER_NAME, streams=list(STREAMS))
    r = redis.from_url(REDIS_URL, decode_responses=True)

    # Auf SIGTERM/SIGINT sauber stoppen
    signal.signal(signal.SIGTERM, _on_signal)
    signal.signal(signal.SIGINT, _on_signal)

    for stream in STREAMS:
        _ensure_group(r, stream)

    last_webhook_sweep = 0.0
    # billing.enforce_limits läuft alle 10 Minuten — Trial-Expiry,
    # read-only-Escalation, Suspend-Lifecycle. Wir machen das eigent-
    # lich nur einmal pro Stunde nötig, aber 10-Min-Cadence gibt
    # schnelleren Recovery bei z.B. einem späten Webhook-Eintrag.
    last_billing_enforce = 0.0
    while not _stop:
        try:
            streams_arg = {s: ">" for s in STREAMS}
            resp = r.xreadgroup(
                groupname=CONSUMER_GROUP,
                consumername=CONSUMER_NAME,
                streams=streams_arg,
                count=10,
                block=BLOCK_MS,
            )

            now = time.time()
            if now - last_webhook_sweep >= 60:
                _trigger_webhook_sweep()
                last_webhook_sweep = now
            if now - last_billing_enforce >= 600:
                _trigger_billing_enforce()
                last_billing_enforce = now

            if not resp:
                # Idle: auch hängende Messages anderer Consumer claimen
                _claim_idle_messages(r)
                continue

            for stream_name, messages in resp:
                for msg_id, fields in messages:
                    _handle(r, stream_name, msg_id, fields)

        except redis.ConnectionError as err:
            log.warning("consumer.redis_disconnected", err=str(err))
            time.sleep(2)
        except Exception:
            log.exception("consumer.loop_error")
            time.sleep(1)

    log.info("consumer.stopped")


def _trigger_webhook_sweep() -> None:
    """Schickt den Webhook-Retry-Sweep an Celery. Eine async send_task
    ist günstig, blockiert den Read-Cycle nicht."""
    try:
        app.send_task("tasks.webhook_delivery.sweep")
    except Exception:
        log.exception("consumer.webhook_sweep_send_failed")


def _trigger_billing_enforce() -> None:
    """Schickt den Trial-Lifecycle + Limit-Enforcement-Job an Celery.
    Nur wenn BILLING_ENABLED — sonst skippen wir, um leere Worker-
    Logs zu vermeiden."""
    if os.environ.get("BILLING_ENABLED", "false").lower() != "true":
        return
    try:
        app.send_task("tasks.billing.enforce_limits")
    except Exception:
        log.exception("consumer.billing_enforce_send_failed")


def _handle(r: redis.Redis, stream: str, msg_id: str, fields: dict) -> None:
    payload_raw = fields.get("payload")
    if not payload_raw:
        log.warning("consumer.empty_payload", stream=stream, id=msg_id)
        r.xack(stream, CONSUMER_GROUP, msg_id)
        return
    try:
        payload = json.loads(payload_raw)
    except json.JSONDecodeError:
        log.warning("consumer.bad_json", stream=stream, id=msg_id)
        r.xack(stream, CONSUMER_GROUP, msg_id)
        return

    log.info("consumer.dispatch",
             stream=stream, id=msg_id, type=payload.get("type"))
    try:
        _dispatch(stream, payload)
        r.xack(stream, CONSUMER_GROUP, msg_id)
    except Exception:
        # Nicht acknowledgen, damit ein anderer Consumer es übernehmen kann
        log.exception("consumer.dispatch_failed",
                      stream=stream, id=msg_id)


def _claim_idle_messages(r: redis.Redis) -> None:
    """Hole hängende Messages, deren letzter Consumer abgestorben ist."""
    for stream in STREAMS:
        try:
            claimed = r.xautoclaim(
                name=stream,
                groupname=CONSUMER_GROUP,
                consumername=CONSUMER_NAME,
                min_idle_time=CLAIM_MIN_IDLE_MS,
                start_id="0-0",
                count=10,
            )
            # xautoclaim → (next_id, claimed_messages, deleted_ids)
            if not claimed:
                continue
            _, messages, *_ = claimed
            for msg_id, fields in messages:
                log.info("consumer.claimed_stale", stream=stream, id=msg_id)
                _handle(r, stream, msg_id, fields)
        except redis.ResponseError as err:
            # Stream existiert noch nicht, harmlos
            if "NOGROUP" in str(err):
                continue
            log.warning("consumer.claim_error",
                        stream=stream, err=str(err))


if __name__ == "__main__":
    try:
        run()
    except KeyboardInterrupt:
        sys.exit(0)
