[English](REQUIREMENTS.md) · **Deutsch**

# Voraussetzungen / System Requirements

Was dein Server mitbringen muss, bevor du Lumio installierst. Für den
eigentlichen Installations-Ablauf siehe [SELFHOSTING.md](SELFHOSTING.de.md),
fürs Hochskalieren [SCALING.md](SCALING.md).

## Betriebssystem & Docker

- **Linux** (getestet auf Ubuntu 22.04/24.04 und Debian 12). Andere
  Distributionen funktionieren, solange Docker läuft.
- **Docker Engine ≥ 24** und **Docker Compose v2** (`docker compose`, nicht
  das alte `docker-compose`). Prüfen: `docker compose version`.
- Compose v2 nutzt standardmäßig BuildKit — wichtig fürs `--build`.

## CPU-Architektur — amd64 **und** arm64

Lumio läuft auf beiden gängigen Server-Architekturen. Du baust die Images
mit `--build` nativ auf deiner Maschine; die richtige Variante wird
automatisch gewählt, du musst nichts umstellen.

| Architektur | Beispiele | Status |
|---|---|---|
| **amd64** (x86-64) | Intel/AMD, die meisten Cloud-VMs (Hetzner CX/CPX, …) | Voll unterstützt, primär getestet |
| **arm64** (aarch64) | Ampere (Hetzner CAX), AWS Graviton, Apple Silicon via Docker, Raspberry Pi 5 | Voll unterstützt |

**Eine Einschränkung auf ARM:** Die GPU-Beschleunigung fürs KI-Auto-Tagging
([GPU.md](GPU.md)) setzt **NVIDIA/CUDA** voraus und gibt es daher nur auf
amd64. Auf ARM läuft das Tagging CPU-basiert — funktional identisch, nur
langsamer pro Bild. Alle anderen Features (Galerien, Upload, RAW/HEIC,
Video-Transcoding, Proofing, ZIP, Print-Shop) sind auf beiden
Architekturen vollständig gleich.

> Hinweis Apple Silicon: Docker Desktop auf einem M-Mac führt
> `linux/arm64`-Container aus — gut zum lokalen Testen. Für Produktion
> bleibt ein echter Linux-Server (amd64 oder arm64) die Empfehlung.

## Arbeitsspeicher & CPU

Richtwerte. Der größte Verbraucher ist Video-Transcoding (libx264 auf CPU);
reiner Foto-/RAW-Betrieb ist deutlich leichter.

| Setup | CPU | RAM | Notiz |
|---|---|---|---|
| **Single-Studio, nur Fotos** | 2 vCPU | 4 GB | Einstieg, kleine Galerien |
| **Single-Studio mit Video** | 4 vCPU | 8 GB | Transcoding braucht Luft |
| **+ KI-Auto-Tagging (ML-Worker)** | +2 vCPU | **+4 GB** | CLIP-Inferenz; Image ~2,5 GB statt ~1 GB |
| **Multi-Tenant / SaaS** | 8 vCPU | 16 GB | + ggf. separate [Worker-Nodes](SCALING.md) |

Den ML-Worker brauchst du nur, wenn du Auto-Tagging willst — ohne ihn fällt
der RAM-Aufschlag weg. Worker lassen sich auf eigene Nodes auslagern, sobald
ein Server nicht mehr reicht (siehe [SCALING.md](SCALING.md)).

## Festplatte

- **System + Images:** ~5 GB (mit ML-Worker ~7 GB).
- **Datenbank:** klein (Metadaten, keine Bilder) — wächst langsam.
- **Bilder/Videos:** der eigentliche Platzbedarf.
  - Mit **MinIO** (lokal) liegen die Dateien auf dem Server-Volume — Platte
    entsprechend dem erwarteten Foto-/Video-Volumen dimensionieren. Faustregel
    bis ~500 GB sinnvoll, darüber externes S3.
  - Mit **externem S3** (Hetzner Object Storage, R2, B2, Wasabi) braucht der
    Server selbst kaum Storage. Setup: [STORAGE.md](STORAGE.de.md).

## Netzwerk

- Öffentliche **IPv4** (und optional IPv6) mit offenen Ports **80** + **443**
  (Caddy holt darüber das Let's-Encrypt-Zertifikat).
- Eine **Domain**, die auf die Server-IP zeigt.
- Bei Multi-Tenant mit Wildcard-Subdomains zusätzlich
  [WILDCARD.md](WILDCARD.md) beachten.

## Kurz-Checkliste

- [ ] Linux-Server, amd64 **oder** arm64
- [ ] Docker ≥ 24 + Compose v2
- [ ] Domain + öffentliche IP, Ports 80/443 frei (OS- **und** Cloud-Firewall)
- [ ] RAM/CPU nach Tabelle (Video & ML-Tagging einplanen)
- [ ] Storage-Strategie entschieden (MinIO lokal vs. externes S3)
