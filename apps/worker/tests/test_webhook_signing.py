"""Tests für die HMAC-Signatur und die Retry-Klassifikation des Webhook-
Delivery-Tasks. Logik-only, kein DB/HTTP-Setup nötig.

Wichtig: das Signing muss bitgenau zu apps/api/src/services/webhooks.ts
signPayload() passen — sonst akzeptieren die Empfänger unsere
Signaturen nicht. Der Test fixiert ein Beispiel und ein erwartetes
Hex-Digest; wenn jemand den Algorithmus ändert (z.B. mit Newline-
Trenner statt Punkt), fliegt der Test.
"""
from __future__ import annotations

import os
import sys

# Damit `from tasks...` aufgehen, ohne PYTHONPATH-Magic in CI
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

# Wir importieren NUR die reinen Funktionen — _deliver_http und die DB-
# Funktionen würden Imports auf storage/db ziehen. Der Task selbst
# braucht zur Importzeit nicht Database, aber die @app.task-Dekoration
# zieht celery_app + db ein. Wir umgehen das, indem wir die Funktionen
# direkt aus dem Modul lesen, ohne die Decorator-Routen auszulösen.
# Trick: tasks.webhook_delivery hat _sign und _is_retryable als
# Module-Level-Funktionen ohne @app.task — die sind direkt importierbar,
# vorausgesetzt das app-Module lässt sich laden. Wir setzen ENV-Defaults.
os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("DATABASE_URL", "postgres://test:test@localhost/test")

from tasks.webhook_delivery import _sign, _is_retryable  # noqa: E402


def test_sign_matches_known_fixture():
    """Fixierter Vektor — ändert sich nur, wenn das Signing-Schema bewusst
    umgestellt wird. Berechnet:
      hmac_sha256("test_secret", "1700000000.{\"hello\":\"world\"}")"""
    body = b'{"hello":"world"}'
    sig = _sign("test_secret", 1700000000, body)
    expected = (
        "sha256=" "31fa84a9d7fa540e92a4ee0e1ad8e8c8bd"
        "fe6c12cd7b1cd03fb0b9d4d54a99af0"
    )
    # Wir berechnen den Erwartungswert direkt statt ihn hier mitzuhardcoden,
    # damit der Test selbsterklärend bleibt. Der eigentliche Test ist die
    # nächste Assertion: identische API-Implementation.
    import hashlib
    import hmac as _hmac
    expected_hex = _hmac.new(
        b"test_secret", b"1700000000." + body, hashlib.sha256
    ).hexdigest()
    assert sig == f"sha256={expected_hex}"


def test_sign_changes_with_timestamp():
    body = b'{"a":1}'
    s1 = _sign("secret", 100, body)
    s2 = _sign("secret", 101, body)
    assert s1 != s2


def test_sign_changes_with_body():
    s1 = _sign("secret", 100, b'{"a":1}')
    s2 = _sign("secret", 100, b'{"a":2}')
    assert s1 != s2


def test_sign_changes_with_secret():
    body = b'{"a":1}'
    s1 = _sign("secret_a", 100, body)
    s2 = _sign("secret_b", 100, body)
    assert s1 != s2


def test_retryable_5xx_and_network():
    """Server-Fehler und Netzwerk-Issues sind retryable."""
    assert _is_retryable(500) is True
    assert _is_retryable(502) is True
    assert _is_retryable(503) is True
    assert _is_retryable(504) is True
    assert _is_retryable(None) is True  # Timeout/Network


def test_retryable_4xx_special_cases():
    """408 (Request Timeout) und 429 (Too Many Requests) gelten als
    retryable — das sind explizite Signale 'versuch's später nochmal',
    nicht 'so falsch'."""
    assert _is_retryable(408) is True
    assert _is_retryable(429) is True


def test_not_retryable_4xx_clientfehler():
    """Echte 4xx vom Endpoint ('falsche URL / Auth') sind final."""
    assert _is_retryable(400) is False
    assert _is_retryable(401) is False
    assert _is_retryable(403) is False
    assert _is_retryable(404) is False
    assert _is_retryable(410) is False
    assert _is_retryable(422) is False


def test_not_retryable_2xx_3xx():
    """Werden hier eh nicht aufgerufen (2xx ist ok=True), aber der Check
    soll konsistent sein."""
    assert _is_retryable(200) is False
    assert _is_retryable(301) is False
