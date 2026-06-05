#!/usr/bin/env bash
#
# lumio-backup.sh — Postgres-Backup für Lumio (Weg A: restic, Dual-Repo).
#
# Läuft auf dem HAUPTSERVER per Cron. Sichert die Postgres-DB + .env
# verschlüsselt in ZWEI restic-Repos:
#   1) Hetzner Object Storage (zweiter Bucket)
#   2) Backblaze B2 (anderer Provider → echtes 3-2-1, überlebt Hetzner-Ausfall)
#
# Schreibt nach jedem Erfolg eine Status-Datei (Timestamp + Größe), die die
# Super-Admin-Backup-Ampel über BACKUP_STATUS_PATH liest, und pingt optional
# einen Dead-Man's-Switch (healthchecks.io).
#
# Konfiguration: /etc/lumio-backup.env  (NICHT im Repo — siehe *.env.example)
# Doku:          docs/BACKUP.md
#
set -euo pipefail

CONFIG="${LUMIO_BACKUP_CONFIG:-/etc/lumio-backup.env}"
if [[ ! -r "$CONFIG" ]]; then
  echo "FEHLER: Config $CONFIG nicht lesbar." >&2
  exit 1
fi
# shellcheck disable=SC1090
source "$CONFIG"

: "${LUMIO_DIR:?LUMIO_DIR fehlt in der Config}"
: "${RESTIC_PASSWORD_FILE:?RESTIC_PASSWORD_FILE fehlt in der Config}"
: "${HETZNER_RESTIC_REPO:?HETZNER_RESTIC_REPO fehlt}"
: "${B2_RESTIC_REPO:?B2_RESTIC_REPO fehlt}"

STATUS_FILE="${STATUS_FILE:-/backup/lumio/status.txt}"
PG_SERVICE="${PG_SERVICE:-postgres}"
PG_USER="${PG_USER:-lumio}"
PG_DB="${PG_DB:-lumio}"
RETENTION=(--keep-daily "${KEEP_DAILY:-7}" --keep-weekly "${KEEP_WEEKLY:-4}" --keep-monthly "${KEEP_MONTHLY:-6}")

HC_URL="${HEALTHCHECK_URL:-}"
ping_hc() {  # $1 = "" (Erfolg) | "/start" | "/fail"
  [[ -n "$HC_URL" ]] && curl -fsS -m 10 --retry 3 "${HC_URL}${1:-}" >/dev/null 2>&1 || true
}

WORKDIR="$(mktemp -d /tmp/lumio-dump.XXXXXX)"
cleanup() { rm -rf "$WORKDIR"; }
on_err() { echo "[$(date -u +%FT%TZ)] BACKUP FEHLGESCHLAGEN (Zeile $1)" >&2; ping_hc /fail; }
trap cleanup EXIT
trap 'on_err $LINENO' ERR

ping_hc /start
echo "[$(date -u +%FT%TZ)] Lumio-Backup startet"

# 1) Postgres-Dump (custom format, komprimiert)
cd "$LUMIO_DIR"
docker compose exec -T "$PG_SERVICE" pg_dump -U "$PG_USER" "$PG_DB" -Fc -Z 9 > "$WORKDIR/lumio.dump"
DUMP_SIZE="$(stat -c%s "$WORKDIR/lumio.dump")"
echo "  Dump: ${DUMP_SIZE} Bytes"

# 2) .env mitsichern (Secrets + S3-Creds — für Restore unverzichtbar)
if [[ -r "$LUMIO_DIR/.env" ]]; then
  cp "$LUMIO_DIR/.env" "$WORKDIR/env.backup"
fi

# 3) In beide restic-Repos sichern. RESTIC_REPOSITORY + Credentials werden
#    vor jedem Aufruf gesetzt; das Passwort ist für beide Repos gleich.
export RESTIC_PASSWORD_FILE

backup_to() {  # $1 = Anzeigename
  echo "  -> restic backup ($1)"
  restic backup "$WORKDIR" --tag scheduled --host lumio-prod --quiet
  restic forget "${RETENTION[@]}" --prune --quiet
  # Wöchentliche Integritätsprüfung (montags, 5% der Daten lesen)
  if [[ "$(date +%u)" == "1" ]]; then
    restic check --read-data-subset=5% --quiet || \
      echo "  WARNUNG: restic check ($1) meldete Probleme — manuell prüfen!" >&2
  fi
}

# 3a) Hetzner Object Storage (S3-Backend)
export AWS_ACCESS_KEY_ID="${HETZNER_S3_KEY:?HETZNER_S3_KEY fehlt}"
export AWS_SECRET_ACCESS_KEY="${HETZNER_S3_SECRET:?HETZNER_S3_SECRET fehlt}"
export RESTIC_REPOSITORY="$HETZNER_RESTIC_REPO"
backup_to "Hetzner"

# 3b) Backblaze B2 (B2-Backend)
unset AWS_ACCESS_KEY_ID AWS_SECRET_ACCESS_KEY
export B2_ACCOUNT_ID="${B2_KEY_ID:?B2_KEY_ID fehlt}"
export B2_ACCOUNT_KEY="${B2_APP_KEY:?B2_APP_KEY fehlt}"
export RESTIC_REPOSITORY="$B2_RESTIC_REPO"
backup_to "Backblaze B2"

# 4) Status-Datei für die Super-Admin-Ampel (Zeile 1: ISO-Timestamp, Zeile 2: Bytes)
mkdir -p "$(dirname "$STATUS_FILE")"
printf '%s\n%s\n' "$(date -u +%FT%TZ)" "$DUMP_SIZE" > "$STATUS_FILE"

echo "[$(date -u +%FT%TZ)] Lumio-Backup fertig"
ping_hc
