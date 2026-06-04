"""
Lumio — Produkt-Version (Worker).

Single Source of Truth ist die Datei /VERSION im Repo-Root.
Diese Datei wird von scripts/bump-version.sh synchron gehalten —
NICHT von Hand editieren, sondern den Bump-Script benutzen.

Eine gesetzte ENV LUMIO_VERSION uebersteuert den eingebauten Wert.
"""
from __future__ import annotations

import os

_BUILTIN_VERSION = "0.27.1"

__version__ = os.environ.get("LUMIO_VERSION", "").strip() or _BUILTIN_VERSION
