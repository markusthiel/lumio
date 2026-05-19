#!/bin/sh
# Lumio Worker — Entrypoint
#
# Startet zwei Prozesse parallel:
#   1) Celery-Worker, der die eigentlichen Tasks ausführt
#   2) Stream-Consumer, der API-Jobs aus Redis pollt und an Celery weiterreicht
#
# Beide Prozesse teilen sich den Container. Stirbt einer, soll der Container
# stoppen (Docker startet ihn neu). Wir lösen das mit einem simplen wait + trap.

set -e

LOG_LEVEL="${LOG_LEVEL:-info}"
CONCURRENCY="${WORKER_CONCURRENCY:-4}"

echo "[lumio-worker] starting celery (concurrency=$CONCURRENCY) and stream consumer"

# Celery im Hintergrund
celery -A app worker \
    -l "$LOG_LEVEL" \
    -c "$CONCURRENCY" \
    -Q default,heavy,io &
CELERY_PID=$!

# Stream-Consumer im Hintergrund
python consumer.py &
CONSUMER_PID=$!

# Wenn einer der Prozesse stirbt, beenden wir den anderen, damit Docker
# den Container neu startet.
shutdown() {
    echo "[lumio-worker] shutting down"
    kill -TERM "$CELERY_PID" 2>/dev/null || true
    kill -TERM "$CONSUMER_PID" 2>/dev/null || true
    wait
}
trap shutdown TERM INT

# wait gibt zurück, sobald einer von beiden stirbt
wait -n
echo "[lumio-worker] one of the processes died — exiting"
shutdown
exit 1
