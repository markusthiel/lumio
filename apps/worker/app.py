"""
Lumio Worker — Celery Application

Verarbeitet asynchron alle CPU-intensiven Jobs:
  - process_file:     Thumbnail/Preview/Web/Watermark-Renditions
  - process_raw:      RAW → JPEG-Preview via LibRaw
  - process_video:    Poster, HLS-Transcoding, Scrubbing-Sprites
  - build_zip:        Streaming-ZIP-Erstellung
  - update_usage:     Storage/Bandwidth-Nutzung pro Tenant aktualisieren (Billing)

Konfiguration kommt vollständig aus Environment-Variablen.
"""
from __future__ import annotations

import os
import structlog
from celery import Celery
from dotenv import load_dotenv

load_dotenv()

REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379")
CONCURRENCY = int(os.environ.get("WORKER_CONCURRENCY", "4"))
LOG_LEVEL = os.environ.get("LOG_LEVEL", "info").upper()

structlog.configure(
    processors=[
        structlog.processors.add_log_level,
        structlog.processors.TimeStamper(fmt="iso"),
        structlog.processors.JSONRenderer(),
    ],
    wrapper_class=structlog.make_filtering_bound_logger(
        getattr(__import__("logging"), LOG_LEVEL, 20)
    ),
)
log = structlog.get_logger("lumio.worker")

app = Celery(
    "lumio",
    broker=REDIS_URL,
    backend=REDIS_URL,
    include=[
        "tasks.process_file",
        "tasks.process_raw",
        "tasks.process_video",
        "tasks.process_watermark",
        "tasks.build_zip",
        "tasks.backfill_web_jpeg",
        "tasks.backfill_video_mp4",
        "tasks.billing",
        "tasks.webhook_delivery",
    ],
)

app.conf.update(
    task_serializer="json",
    accept_content=["json"],
    result_serializer="json",
    timezone="UTC",
    enable_utc=True,
    task_acks_late=True,
    task_reject_on_worker_lost=True,
    worker_prefetch_multiplier=1,   # CPU-intensive Jobs nicht prefetchen
    worker_max_tasks_per_child=100, # gegen Memory-Leaks von rawpy/ffmpeg
    task_routes={
        "tasks.process_raw.*": {"queue": "heavy"},
        "tasks.process_video.*": {"queue": "heavy"},
        "tasks.build_zip.*": {"queue": "io"},
        "tasks.billing.*": {"queue": "default"},
        "tasks.webhook_delivery.*": {"queue": "io"},
    },
    task_default_queue="default",
)

if __name__ == "__main__":
    log.info("starting_worker", concurrency=CONCURRENCY)
    app.start(["worker", "-l", LOG_LEVEL.lower(), "-c", str(CONCURRENCY)])
