# =============================================================================
# Lumio Worker — Dockerfile
# =============================================================================
# Bringt die nativen Dependencies mit, die rawpy, pyvips und ffmpeg brauchen.
#
# Baut auf amd64 UND arm64 (alle System-Libs sind in beiden Debian-Repos,
# rawpy/pyvips haben aarch64-Wheels, EXIF läuft über exiftool). Self-Hoster
# auf ARM (Ampere/Graviton/Apple-Silicon-Docker) bauen einfach nativ mit.
#
# Bookworm explizit gepinnt statt nur python:3.12-slim: der :slim-Alias ist
# auf Debian Trixie gewechselt; mit explizitem Suite-Pin baut der Container
# deterministisch — beim nächsten Debian-Major (Forky) bewusst umstellen.

FROM python:3.12-slim-bookworm AS base

ENV PYTHONUNBUFFERED=1 \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONPATH=/app \
    PIP_NO_CACHE_DIR=1 \
    PIP_DISABLE_PIP_VERSION_CHECK=1

# Native Dependencies:
#   libvips42      — Image-Processing-Bibliothek (pyvips)
#   libraw-bin     — RAW-Decoding-Tools
#   libheif1       — HEIF/HEIC-Support
#   ffmpeg         — Video-Verarbeitung
#   libmagic1      — Mime-Type-Detection (python-magic)
#   exiftool       — EXIF/Aufnahmezeit-Reading (ersetzt pyexiv2, Multi-Arch)
#   libpq5         — Postgres-Client (psycopg)
RUN apt-get update && apt-get install -y --no-install-recommends \
        libvips42 \
        libvips-tools \
        libraw-bin \
        libheif1 \
        ffmpeg \
        libmagic1 \
        exiftool \
        poppler-utils \
        libpq5 \
        tini \
        ca-certificates \
        curl \
        procps \
    && rm -rf /var/lib/apt/lists/*

WORKDIR /app

# Build-Dependencies separat installieren, damit das finale Image schlank bleibt
COPY requirements.txt ./
RUN apt-get update && apt-get install -y --no-install-recommends \
        build-essential \
        libvips-dev \
        libraw-dev \
        libheif-dev \
        libpq-dev \
    && pip install --no-cache-dir -r requirements.txt \
    && apt-get purge -y --auto-remove build-essential libvips-dev libraw-dev libheif-dev libpq-dev \
    && rm -rf /var/lib/apt/lists/*

COPY . .
RUN chmod +x entrypoint.sh

# Default-Queue + Heavy + IO bedient + Stream-Consumer
ENTRYPOINT ["/usr/bin/tini", "--"]
CMD ["./entrypoint.sh"]
