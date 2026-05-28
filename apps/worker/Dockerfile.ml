# =============================================================================
# Lumio Worker — ML-Variante mit CLIP-Auto-Tagging
# =============================================================================
#
# Erbt vom regulaeren Worker-Dockerfile und installiert zusaetzlich
# PyTorch + open_clip_torch. Bietet einen Container der CLIP-basiertes
# KI-Auto-Tagging machen kann.
#
# Build:
#   docker build -f apps/worker/Dockerfile.ml -t lumio-worker:ml .
#
# Oder via Compose-Override:
#   docker compose -f docker-compose.yml \
#                  -f docker-compose.prod.yml \
#                  -f docker-compose.ml.yml \
#                  build worker
#
# Image-Groesse: Standard-Worker ~1 GB, mit ML ~2.5 GB.
# Modell wird beim ERSTEN Job runtergeladen (~150 MB CLIP-ViT-B/32) und
# in /tmp/lumio_models/clip gecacht. Bei Container-Neustart erneuter
# Download — fuer Persistenz Volume mounten auf /tmp/lumio_models.

FROM python:3.12-slim-bookworm

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1 \
    LUMIO_CLIP_ENABLED=1 \
    LUMIO_MODEL_CACHE=/tmp/lumio_models

# Native Dependencies — identisch zum Standard-Worker
RUN apt-get update && apt-get install -y --no-install-recommends \
        libvips42 \
        libvips-tools \
        libraw-bin \
        libheif1 \
        ffmpeg \
        libmagic1 \
        exiftool \
        libpq5 \
        tini \
        ca-certificates \
        curl \
        procps \
    && (apt-get install -y --no-install-recommends libexiv2-27 \
        || apt-get install -y --no-install-recommends libexiv2-28) \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Standard-Requirements + ML-Requirements (PyTorch CPU-only)
COPY apps/worker/requirements.txt apps/worker/requirements-ml.txt ./
RUN pip install --upgrade pip \
    && pip install -r requirements.txt \
    && pip install \
        --extra-index-url https://download.pytorch.org/whl/cpu \
        -r requirements-ml.txt

# Modell-Cache-Verzeichnis. Wird beim ersten Job befuellt; via Volume
# mountbar fuer Persistenz ueber Container-Restarts.
RUN mkdir -p /tmp/lumio_models

COPY apps/worker /app

# Health-Check identisch zum Standard-Worker
HEALTHCHECK --interval=30s --timeout=5s --start-period=10s --retries=3 \
    CMD ps aux | grep -v grep | grep -q "celery worker" || exit 1

# WICHTIG: gleicher Entrypoint wie das Standard-Worker-Image. Der
# entrypoint.sh startet Celery UND den Stream-Consumer parallel.
# Wenn wir hier nur 'celery worker' starten wuerden, kaemen Stream-Jobs
# (z.B. Re-Tag-Galerie aus dem Studio) nie an — die Tasks waeren zwar
# registriert, aber kein Prozess wuerde sie aus Redis lesen.
RUN chmod +x /app/entrypoint.sh
ENTRYPOINT ["tini", "--"]
CMD ["/app/entrypoint.sh"]
