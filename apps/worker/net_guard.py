"""
Lumio Worker — SSRF-Guard für ausgehende Webhook-Requests.

Pendant zu apps/api/src/lib/ssrf-guard.ts. Der Worker liefert die
eigentlichen (wiederholten) Webhook-POSTs aus und läuft u.U. auf
Worker-Nodes IM privaten Netz (10.0.0.0/16) mit Zugriff auf Redis/
Postgres. Ohne Schutz könnte ein Tenant-Owner über eine Webhook-URL
den Worker gegen interne Ziele schicken.

Schutz:
  1) Nur https.
  2) Host auflösen, jede IP gegen private/loopback/link-local/metadata
     prüfen — vor dem Connect.
  3) Keine Redirects folgen (No-Redirect-Opener); 3xx gilt als Fehler.

Restrisiko: DNS-Rebinding zwischen Check und Connect. Für das
Bedrohungsmodell (blind, authentifizierter Owner, https-only) eine
deutliche Härtung.
"""
from __future__ import annotations

import ipaddress
import socket
from urllib.parse import urlsplit
from urllib.request import HTTPRedirectHandler, build_opener


class BlockedTargetError(Exception):
    """Ziel-URL ist nicht erlaubt (kein https oder interne/private IP)."""


def _ip_is_blocked(ip_str: str) -> bool:
    try:
        ip = ipaddress.ip_address(ip_str)
    except ValueError:
        return True
    # IPv4-mapped IPv6 (::ffff:a.b.c.d) auf die eingebettete v4 reduzieren
    if isinstance(ip, ipaddress.IPv6Address) and ip.ipv4_mapped is not None:
        ip = ip.ipv4_mapped
    return (
        ip.is_private
        or ip.is_loopback
        or ip.is_link_local       # 169.254.0.0/16 inkl. Metadata
        or ip.is_reserved
        or ip.is_multicast
        or ip.is_unspecified
    )


def assert_public_https_url(raw_url: str) -> None:
    """Wirft BlockedTargetError, wenn die URL nicht https ist oder der
    Host auf eine gesperrte IP auflöst."""
    parts = urlsplit(raw_url)
    if parts.scheme != "https":
        raise BlockedTargetError("only https urls are allowed")
    host = parts.hostname
    if not host:
        raise BlockedTargetError("missing host")
    if host == "localhost" or host.endswith(".localhost"):
        raise BlockedTargetError("target host is not allowed")

    # Alle A/AAAA-Records prüfen (nicht nur den ersten).
    try:
        infos = socket.getaddrinfo(host, parts.port or 443, proto=socket.IPPROTO_TCP)
    except socket.gaierror as err:
        raise BlockedTargetError(f"host did not resolve: {err}") from err
    if not infos:
        raise BlockedTargetError("host did not resolve")
    for info in infos:
        ip_str = info[4][0]
        if _ip_is_blocked(ip_str):
            raise BlockedTargetError("target host resolves to a blocked ip")


class _NoRedirect(HTTPRedirectHandler):
    """Folgt keinen Redirects — gibt die 3xx-Antwort unverändert zurück.
    Der Aufrufer behandelt 3xx als Fehlschlag."""

    def redirect_request(self, req, fp, code, msg, headers, newurl):  # noqa: D401
        return None


def build_no_redirect_opener():
    """urllib-Opener, der Redirects NICHT folgt."""
    return build_opener(_NoRedirect())
