# =============================================================================
# Lumio Worker — Dockerfile
# =============================================================================
# Bringt die nativen Dependencies mit, die rawpy, pyvips und ffmpeg brauchen.

FROM python:3.12-slim AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Native Dependencies:
#   libvips42      — Image-Processing-Bibliothek (pyvips)
#   libraw-bin     — RAW-Decoding-Tools
#   libheif1       — HEIF/HEIC-Support
#   ffmpeg         — Video-Verarbeitung
#   libmagic1      — Mime-Type-Detection (python-magic)
#   libexiv2       — EXIF/XMP-Reading
#   exiftool       — Fallback für ungewöhnliche Metadaten
#   libpq5         — Postgres-Client (psycopg)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libvips42 \
        libvips-tools \
        libraw-bin \
        libheif1 \
        ffmpeg \
        libmagic1 \
        libexiv2-27 \
        exiftool \
        libpq5 \
        tini \
        ca-certificates \
        curl \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Build-Dependencies separat installieren, damit das finale Image schlank bleibt
COPY requirements.txt ./
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libvips-dev \
        libraw-dev \
        libheif-dev \
        libexiv2-dev \
        libpq-dev \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y --auto-remove build-essential libvips-dev libraw-dev libheif-dev libexiv2-dev libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN chmod +x entrypoint.sh

# Default-Queue + Heavy + IO bedient + Stream-Consumer
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./entrypoint.sh"]
