**English** · [Deutsch](REQUIREMENTS.de.md)

# Requirements / System Requirements

What your server needs before you install Lumio. For the actual installation
flow see [SELFHOSTING.md](SELFHOSTING.md), for scaling up [SCALING.md](SCALING.md).

## Operating system & Docker

- **Linux** (tested on Ubuntu 22.04/24.04 and Debian 12). Other distributions
  work as long as Docker runs.
- **Docker Engine ≥ 24** and **Docker Compose v2** (`docker compose`, not the
  old `docker-compose`). Check: `docker compose version`.
- Compose v2 uses BuildKit by default — important for the `--build`.

## CPU architecture — amd64 **and** arm64

Lumio runs on both common server architectures. You build the images with
`--build` natively on your machine; the right variant is selected
automatically, nothing to configure.

| Architecture | Examples | Status |
|---|---|---|
| **amd64** (x86-64) | Intel/AMD, most cloud VMs (Hetzner CX/CPX, …) | Fully supported, primary test target |
| **arm64** (aarch64) | Ampere (Hetzner CAX), AWS Graviton, Apple Silicon via Docker, Raspberry Pi 5 | Fully supported |

**One limitation on ARM:** GPU acceleration for AI auto-tagging
([GPU.md](GPU.md)) requires **NVIDIA/CUDA** and is therefore amd64-only. On
ARM, tagging runs on the CPU — functionally identical, just slower per image.
All other features (galleries, upload, RAW/HEIC, video transcoding, proofing,
ZIP, print shop) are fully identical on both architectures.

> Note on Apple Silicon: Docker Desktop on an M-series Mac runs
> `linux/arm64` containers — good for local testing. For production a real
> Linux server (amd64 or arm64) remains the recommendation.

## Memory & CPU

Rough guidance. The biggest consumer is video transcoding (libx264 on CPU);
pure photo/RAW operation is much lighter.

| Setup | CPU | RAM | Note |
|---|---|---|---|
| **Single studio, photos only** | 2 vCPU | 4 GB | Entry level, small galleries |
| **Single studio with video** | 4 vCPU | 8 GB | Transcoding needs headroom |
| **+ AI auto-tagging (ML worker)** | +2 vCPU | **+4 GB** | CLIP inference; image ~2.5 GB instead of ~1 GB |
| **Multi-tenant / SaaS** | 8 vCPU | 16 GB | + separate [worker nodes](SCALING.md) if needed |

You only need the ML worker if you want auto-tagging — without it the RAM
surcharge does not apply. Workers can be moved to dedicated nodes once one
server is no longer enough (see [SCALING.md](SCALING.md)).

## Disk

- **System + images:** ~5 GB (with ML worker ~7 GB).
- **Database:** small (metadata, no images) — grows slowly.
- **Images/videos:** the actual space requirement.
  - With **MinIO** (local) the files live on the server volume — size the disk
    to the expected photo/video volume. Rule of thumb sensible up to ~500 GB,
    beyond that use external S3.
  - With **external S3** (Hetzner Object Storage, R2, B2, Wasabi) the server
    itself needs almost no storage. Setup: [STORAGE.md](STORAGE.md).

## Network

- A public **IPv4** (and optionally IPv6) with open ports **80** + **443**
  (Caddy fetches the Let's Encrypt certificate over them).
- **Port 9000** additionally open if you run WITHOUT an S3 subdomain
  (Quick Start / IP testing): the browser uploads and loads images
  directly from MinIO on that port. With `S3_PUBLIC_URL` set (domain
  setup per SELFHOSTING.md), 9000 stays internal.
- A **domain** pointing to the server IP.
- For multi-tenant with wildcard subdomains also see [WILDCARD.md](WILDCARD.md).

## Quick checklist

- [ ] Linux server, amd64 **or** arm64
- [ ] Docker ≥ 24 + Compose v2
- [ ] Domain + public IP, ports 80/443 open (OS **and** cloud firewall); without S3 subdomain also 9000
- [ ] RAM/CPU per the table (account for video & ML tagging)
- [ ] Storage strategy decided (local MinIO vs. external S3)
