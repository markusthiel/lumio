"""
Lumio Worker — Real-time Events Publisher

Schickt File-Status-Updates (und andere Gallery-Events) per Redis-PubSub
an die API-Instanzen, die das dann an die WebSocket-Clients im Browser
durchreichen. Channel-Schema: ``lumio:events:gallery:<galleryId>``,
Payload ist JSON wie in apps/api/src/services/events.ts dokumentiert.

Wir nutzen denselben REDIS_URL wie die Job-Queue, halten einen einzigen
Redis-Client am Modul-Level und reconnecten bei Fehler still.

Failure-Mode: Wenn Redis kurz weg ist, geht das Event verloren — kein
Retry, kein Backlog. Genau das wollen wir hier: ein verlorenes
"file.status: ready"-Event ist nicht kritisch, weil der Browser bei
WebSocket-Reconnect ohnehin die Galerie neu lädt und so den echten
Zustand sieht. Wenn der WebSocket-Bus persistent sein müsste, würden
wir Redis-Streams nehmen statt Pub/Sub.
"""
from __future__ import annotations

import json
import os
from typing import Any

import redis as redis_lib  # type: ignore

import structlog

_REDIS_URL = os.environ.get("REDIS_URL", "redis://redis:6379/0")
_CHANNEL_PREFIX = "lumio:events:gallery:"

log = structlog.get_logger(__name__)

_client: redis_lib.Redis | None = None


def _get_client() -> redis_lib.Redis:
    global _client
    if _client is None:
        _client = redis_lib.from_url(_REDIS_URL, decode_responses=True)
    return _client


def publish(gallery_id: str, event: dict[str, Any]) -> None:
    """Veröffentlicht ein Gallery-Event. Stille Failures."""
    try:
        _get_client().publish(
            _CHANNEL_PREFIX + str(gallery_id),
            json.dumps(event),
        )
    except Exception as err:
        log.warn("events.publish_failed", gallery_id=gallery_id, err=str(err))


def file_status(
    gallery_id: str,
    file_id: str,
    status: str,
    width: int | None = None,
    height: int | None = None,
) -> None:
    """File-Status-Update — z.B. nach mark_file_ready/failed."""
    event: dict[str, Any] = {
        "type": "file.status",
        "fileId": str(file_id),
        "status": status,
    }
    if width is not None:
        event["width"] = width
    if height is not None:
        event["height"] = height
    publish(gallery_id, event)
