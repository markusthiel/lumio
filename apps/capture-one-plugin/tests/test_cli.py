"""
Smoke-Tests für lumio-c1-sync.py — die Pfade ohne Netzwerk.

Wir testen, was wir ohne erreichbare Lumio-Instanz testen können:
Argument-Parsing, Konfig-Loader-Fehler, defensive Exit-Codes. Die
eigentlichen API-Pfade (test / list-galleries / selection mit gültiger
Server-Antwort) sind nicht abgedeckt — das wäre integration testing
gegen einen laufenden Server.

Lauf:
    python3 -m pytest apps/capture-one-plugin/tests/

oder direkt:
    python3 apps/capture-one-plugin/tests/test_cli.py
"""
from __future__ import annotations

import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path

# Pfad zum CLI relativ zu dieser Datei: ../lumio-c1-sync.py
SCRIPT = Path(__file__).resolve().parent.parent / "lumio-c1-sync.py"


def run(*args: str, env: dict[str, str] | None = None) -> subprocess.CompletedProcess[str]:
    """CLI in einem isolierten ENV starten."""
    full_env = {**os.environ, **(env or {})}
    return subprocess.run(
        ["python3", str(SCRIPT), *args],
        env=full_env,
        capture_output=True,
        text=True,
        timeout=20,
    )


def test_help_lists_subcommands() -> None:
    r = run("--help")
    assert r.returncode == 0, r.stderr
    assert "list-galleries" in r.stdout
    assert "selection" in r.stdout
    assert "test" in r.stdout


def test_no_config_exits_2() -> None:
    """Wenn ~/.lumio-c1.json nicht existiert: Exit 2 + Hinweis."""
    with tempfile.TemporaryDirectory() as d:
        r = run("test", env={"HOME": d})
        assert r.returncode == 2
        assert "Konfigurationsdatei fehlt" in r.stderr


def test_broken_json_exits_2() -> None:
    """Kaputte Konfig: Exit 2, kein Crash."""
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / ".lumio-c1.json").write_text("not json at all")
        r = run("test", env={"HOME": d})
        assert r.returncode == 2


def test_empty_config_exits_2() -> None:
    """Leere Konfig (host/token fehlen): Exit 2."""
    with tempfile.TemporaryDirectory() as d:
        (Path(d) / ".lumio-c1.json").write_text("{}")
        r = run("test", env={"HOME": d})
        assert r.returncode == 2
        assert "host" in r.stderr or "token" in r.stderr


def test_unreachable_host_exits_5() -> None:
    """Host unauflösbar: Exit 5 (URLError-Pfad)."""
    with tempfile.TemporaryDirectory() as d:
        cfg = {"host": "https://localhost.invalid.tld", "token": "lum_x"}
        (Path(d) / ".lumio-c1.json").write_text(json.dumps(cfg))
        r = run("test", env={"HOME": d})
        assert r.returncode == 5, f"expected 5, got {r.returncode}, stderr: {r.stderr}"
        assert "Verbindung fehlgeschlagen" in r.stderr


if __name__ == "__main__":
    # Manueller Lauf ohne pytest
    failures = 0
    tests = [
        test_help_lists_subcommands,
        test_no_config_exits_2,
        test_broken_json_exits_2,
        test_empty_config_exits_2,
        test_unreachable_host_exits_5,
    ]
    for t in tests:
        try:
            t()
            print(f"ok  {t.__name__}")
        except AssertionError as e:
            print(f"FAIL {t.__name__}: {e}")
            failures += 1
    sys.exit(1 if failures else 0)
