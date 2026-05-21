#!/usr/bin/env python3
"""
lumio-c1-sync.py — CLI-Brücke zwischen Lumio und Capture One.

Sprechen tut hier nur die Lumio-Plugin-API. AppleScript ruft uns mit
Subkommandos auf:

  list-galleries          → JSON-Liste { galleries: [...] } auf stdout
  selection <galleryId>   → JSON { files: [...] } auf stdout

Config liegt unter ~/.lumio-c1.json:

  { "host": "https://studio.lumio-cloud.de", "token": "lum_xxx..." }

Dies separat von AppleScript zu halten hat zwei Vorteile:

  1) HTTP, JSON, TLS in Python ist 5 Zeilen — in AppleScript hieße das
     curl-shell-out und manuelles Argument-Quoting. Mit nativem `do
     shell script` würden Secrets ggf. im Prozess-Listing landen.

  2) Wir können den CLI direkt aus dem Terminal testen, ohne Capture
     One zu starten.

Abhängigkeiten: keine. Nur stdlib (urllib + json).
"""
from __future__ import annotations

import argparse
import json
import os
import sys
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.request import Request, urlopen


CONFIG_PATH = Path.home() / ".lumio-c1.json"
USER_AGENT = "Lumio-C1-Sync/1.0"
TIMEOUT = 30


def load_config() -> dict[str, str]:
    if not CONFIG_PATH.exists():
        sys.stderr.write(
            f"Konfigurationsdatei fehlt: {CONFIG_PATH}\n"
            f"Beispiel-Inhalt:\n"
            f'  {{ "host": "https://studio.lumio-cloud.de", "token": "lum_xxx..." }}\n'
        )
        sys.exit(2)
    try:
        data = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    except (json.JSONDecodeError, OSError) as e:
        sys.stderr.write(f"Konfig nicht lesbar: {e}\n")
        sys.exit(2)
    host = (data.get("host") or "").rstrip("/")
    token = data.get("token") or ""
    if not host or not token:
        sys.stderr.write(
            f"host und token müssen in {CONFIG_PATH} gesetzt sein.\n"
        )
        sys.exit(2)
    return {"host": host, "token": token}


def api(method: str, path: str) -> Any:
    cfg = load_config()
    url = cfg["host"] + "/api/v1" + path
    req = Request(
        url,
        method=method,
        headers={
            "Authorization": f"Bearer {cfg['token']}",
            "Accept": "application/json",
            "User-Agent": USER_AGENT,
        },
    )
    try:
        with urlopen(req, timeout=TIMEOUT) as resp:
            body = resp.read().decode("utf-8")
            return json.loads(body) if body else None
    except HTTPError as e:
        # 401 wird häufig — wir geben dem User einen Hinweis statt
        # der rohen HTTPError-Repräsentation.
        if e.code == 401:
            sys.stderr.write(
                "Lumio: API-Token ungültig oder abgelaufen.\n"
                "Im Studio einen neuen Token erzeugen "
                "(Einstellungen → API-Tokens) und in "
                f"{CONFIG_PATH} eintragen.\n"
            )
            sys.exit(3)
        body = e.read().decode("utf-8", errors="replace")[:200]
        sys.stderr.write(f"Lumio: HTTP {e.code} — {body}\n")
        sys.exit(4)
    except URLError as e:
        sys.stderr.write(f"Lumio: Verbindung fehlgeschlagen — {e.reason}\n")
        sys.exit(5)


def cmd_test() -> int:
    res = api("GET", "/plugin/version")
    # Schreibt {"ok":true,"apiVersion":"1"} oder ähnlich
    json.dump(res, sys.stdout)
    sys.stdout.write("\n")
    return 0


def cmd_list_galleries() -> int:
    res = api("GET", "/plugin/galleries")
    # Output: ein Objekt mit "galleries" — gleiche Form wie API
    json.dump(res, sys.stdout)
    sys.stdout.write("\n")
    return 0


def cmd_selection(gallery_id: str) -> int:
    res = api("GET", f"/plugin/galleries/{gallery_id}/selection")
    json.dump(res, sys.stdout)
    sys.stdout.write("\n")
    return 0


def main(argv: list[str]) -> int:
    parser = argparse.ArgumentParser(prog="lumio-c1-sync")
    sub = parser.add_subparsers(dest="cmd", required=True)

    sub.add_parser("test", help="API-Verbindung testen")
    sub.add_parser("list-galleries", help="Galerien des Tenants auflisten")

    sel = sub.add_parser("selection", help="Auswahl einer Galerie holen")
    sel.add_argument("gallery_id", help="UUID der Galerie")

    args = parser.parse_args(argv)

    if args.cmd == "test":
        return cmd_test()
    if args.cmd == "list-galleries":
        return cmd_list_galleries()
    if args.cmd == "selection":
        return cmd_selection(args.gallery_id)
    parser.print_help()
    return 1


if __name__ == "__main__":
    sys.exit(main(sys.argv[1:]))
