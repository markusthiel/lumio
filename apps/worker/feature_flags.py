"""
Lumio Worker — Tenant-Feature-Flag-Lookup

Schlanke Helper-Funktion um in Worker-Tasks zu pruefen ob ein Tenant
ein optionales Feature aktiviert hat (z.B. 4K-Video, KI-Tagging,
Advanced Analytics). Wird vom Super-Admin pro Tenant in der UI
geschaltet — siehe apps/api/src/routes/super-tenants.ts Feature-Flag-
Sektion.

Cache:
  - Per-Process-Cache mit 60s-TTL. Worker-Prozesse leben lang, ein
    Feature-Toggle muss sich nicht millisekundengenau ausbreiten.
    Bei kuerzerem TTL koennten wir die DB mit Flag-Checks fluten
    (jedes Video-Transcoding macht u.U. 3-4 Lookups).
  - Im Test-/Dev-Setup mit DISABLE_FEATURE_CACHE=1 kann der Cache
    komplett ausgeschaltet werden — sonst muss man 60s warten bis
    Tenant-Flag-Aenderungen greifen.
"""
from __future__ import annotations

import os
import time
from typing import Optional

from db import get_conn

_TTL_SECONDS = 60
_cache: dict[tuple[str, str], tuple[float, bool]] = {}


def is_feature_enabled(tenant_id: str, flag_key: str) -> bool:
    """Prueft ob der Tenant das Feature aktiviert hat.

    Returns False auch wenn:
      - der Tenant keinen Eintrag in tenant_feature_flags hat (Default off)
      - die DB nicht erreichbar ist (Fail-safe: lieber Feature aus)
    """
    if not tenant_id or not flag_key:
        return False

    cache_disabled = os.environ.get("DISABLE_FEATURE_CACHE") == "1"
    key = (tenant_id, flag_key)

    if not cache_disabled:
        cached = _cache.get(key)
        if cached is not None:
            stored_at, value = cached
            if time.monotonic() - stored_at < _TTL_SECONDS:
                return value

    try:
        with get_conn() as conn:
            row = conn.execute(
                'SELECT enabled FROM tenant_feature_flags '
                'WHERE "tenantId" = %s AND "flagKey" = %s',
                (tenant_id, flag_key),
            ).fetchone()
        enabled = bool(row and row["enabled"])
    except Exception:
        # Fail-safe: bei DB-Fehlern lieber Feature aus
        enabled = False

    if not cache_disabled:
        _cache[key] = (time.monotonic(), enabled)
    return enabled


def invalidate_cache(tenant_id: Optional[str] = None) -> None:
    """Wenn ein anderer Prozess uns sagt 'der Flag X hat sich geaendert'.
    Aktuell noch nicht von der API gerufen — wir warten den 60s-TTL ab.
    """
    if tenant_id is None:
        _cache.clear()
    else:
        for k in list(_cache.keys()):
            if k[0] == tenant_id:
                del _cache[k]
