#!/usr/bin/env bash
# =============================================================================
# Lumio — Remote Deploy Script
# =============================================================================
# Läuft AUF dem Server. Zieht die in der CI gebauten Images aus der Forgejo-
# Registry und startet den Stack neu. Wird vom deploy-Job (CI über SSH)
# aufgerufen, kann aber auch manuell laufen:
#
#   cd /opt/docker/lumio/lumio && git pull && bash infra/deploy.sh
#
# Voraussetzung: Server ist in der Registry eingeloggt
#   docker login forgejo.thiel.tools
# (einmalig; Credentials landen in ~/.docker/config.json)

set -euo pipefail

# Ins Repo-Root wechseln (Script liegt in infra/)
cd "$(dirname "$0")/.."

COMPOSE="docker compose -f docker-compose.yml -f docker-compose.prod.yml -f docker-compose.ml.yml"

echo "→ Pulling service images from registry (api, frontend, worker)…"
$COMPOSE pull api frontend worker

echo "→ Building local-only images (caddy)…"
# caddy hat ein Custom-Build (acme-dns-Plugin), kommt nicht aus der Registry.
# build ist gecached wenn sich Caddyfile/Dockerfile nicht geändert haben.
$COMPOSE build caddy

echo "→ Restarting stack…"
$COMPOSE up -d

echo "→ Pruning dangling images…"
docker image prune -f >/dev/null 2>&1 || true

echo "✓ Deploy done — $($COMPOSE ps --services --filter status=running | wc -l) Services laufen."
