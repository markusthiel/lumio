#!/bin/sh
# =============================================================================
# Lumio Caddy Entrypoint
# =============================================================================
# Das acmedns-Plugin liest seine Credentials-Datei bereits beim Caddy-START
# (Provision der TLS-Automation-Policy) — auch wenn der Wildcard-Block auf
# einer toten Adresse liegt und nie benutzt wird. Auf einem frischen Clone
# existiert infra/caddy/secrets/acmedns.json aber nicht (gitignored), und
# Caddy würde in einer Restart-Schleife hängen (ERR_CONNECTION_REFUSED).
#
# Deshalb: existiert die echte Datei, nutzen wir sie (Produktions-Setup mit
# Wildcard-TLS, unverändert). Fehlt sie, zeigen wir auf eine eingebackene
# Dummy-Datei — syntaktisch valide, inhaltlich unbenutzt, weil der
# Wildcard-Block ohne LUMIO_WILDCARD_HOST auf 127.0.0.2:9 tot ist. Wer die
# Wildcard aktiviert, ohne die echte Datei anzulegen, bekommt bei der
# DNS-Challenge eine klare Fehlermeldung statt eines Startabbruchs.
#
# ACMEDNS_CONFIG kann auch von außen gesetzt werden und gewinnt dann.
set -eu

if [ -z "${ACMEDNS_CONFIG:-}" ]; then
	if [ -f /etc/caddy/secrets/acmedns.json ]; then
		ACMEDNS_CONFIG=/etc/caddy/secrets/acmedns.json
	else
		ACMEDNS_CONFIG=/etc/caddy/acmedns-fallback.json
		echo "[lumio:caddy] Hinweis: keine secrets/acmedns.json gefunden — nutze Dummy-Fallback." \
			"Nur relevant, falls LUMIO_WILDCARD_HOST aktiviert werden soll (siehe docs/MULTI_TENANT.md)." >&2
	fi
fi
export ACMEDNS_CONFIG

if [ "$#" -eq 0 ]; then
	set -- caddy run --config /etc/caddy/Caddyfile --adapter caddyfile
fi
exec "$@"
