#!/usr/bin/env bash
#
# lumio-media-sync.sh — spiegelt den Bild/Video-Bucket (lumio-prod) per
# rclone zu Backblaze B2 (anderer Provider). Läuft wöchentlich per Cron.
#
# rclone-Remotes vorher mit `rclone config` anlegen:
#   - "hetzner" -> Lumio-Bucket (S3, Endpoint fsn1.your-objectstorage.com)
#   - "b2"      -> Backblaze B2
# Siehe docs/BACKUP.md.
#
# Konfiguration: /etc/lumio-backup.env  (teilt sich die Datei mit lumio-backup.sh)
#
set -euo pipefail

CONFIG="${LUMIO_BACKUP_CONFIG:-/etc/lumio-backup.env}"
# shellcheck disable=SC1090
[[ -r "$CONFIG" ]] && source "$CONFIG"

SRC="${RCLONE_SRC:-hetzner:lumio-prod}"
DST="${RCLONE_DST:-b2:lumio-media-backup}"
BWLIMIT="${RCLONE_BWLIMIT:-50M}"

HC_URL="${MEDIA_HEALTHCHECK_URL:-}"
ping_hc() { [[ -n "$HC_URL" ]] && curl -fsS -m 10 --retry 3 "${HC_URL}${1:-}" >/dev/null 2>&1 || true; }
trap 'echo "[$(date -u +%FT%TZ)] MEDIA-SYNC FEHLGESCHLAGEN" >&2; ping_hc /fail' ERR

ping_hc /start
echo "[$(date -u +%FT%TZ)] Media-Sync ${SRC} -> ${DST}"

# sync = exakte Spiegelung. Im DST gelöschte Dateien werden NICHT entfernt,
# wenn im SRC noch vorhanden; im SRC gelöschte Dateien WERDEN im DST gelöscht.
# Versioning/Lifecycle im DST-Bucket schützt vor versehentlichem Mitlöschen.
rclone sync "$SRC" "$DST" \
  --bwlimit "$BWLIMIT" \
  --transfers 4 \
  --fast-list \
  --stats-one-line

echo "[$(date -u +%FT%TZ)] Media-Sync fertig"
ping_hc
