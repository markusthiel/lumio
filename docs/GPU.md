# GPU-Beschleunigung (NVIDIA NVENC)

Für die Video-Verarbeitung (HLS-Transcoding mehrerer Qualitätsstufen)
kann Lumio NVIDIAs NVENC-Encoder nutzen. Das reduziert die
Transcoding-Zeit eines 1-Stunden-1080p-Videos von **2-3 Stunden auf
Software** auf **10-20 Minuten auf einer Consumer-RTX**.

## Voraussetzungen

Diese Liste muss am Host-Server erfüllt sein, bevor du GPU
aktivierst:

1. **NVIDIA-Treiber installiert**

   ```bash
   nvidia-smi
   ```

   sollte die GPU listen, plus eine Treiber-Version.

2. **NVIDIA Container Toolkit installiert**

   Anleitung: [NVIDIA Docs](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)

   Kurzform für Ubuntu/Debian:

   ```bash
   distribution=$(. /etc/os-release; echo $ID$VERSION_ID)
   curl -fsSL https://nvidia.github.io/libnvidia-container/gpgkey | \
     sudo gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
   curl -s -L https://nvidia.github.io/libnvidia-container/$distribution/libnvidia-container.list | \
     sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
     sudo tee /etc/apt/sources.list.d/nvidia-container-toolkit.list
   sudo apt update
   sudo apt install -y nvidia-container-toolkit
   sudo nvidia-ctk runtime configure --runtime=docker
   sudo systemctl restart docker
   ```

3. **Test**

   ```bash
   docker run --rm --gpus all nvidia/cuda:12.3.1-base-ubuntu22.04 nvidia-smi
   ```

   Wenn das `nvidia-smi` aus dem Container ausgibt → Toolkit
   funktioniert.

## Lumio mit GPU starten

Wenn die Voraussetzungen erfüllt sind, lädst du das GPU-Overlay
zusätzlich mit auf:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  up -d
```

Beim Worker-Start sollte im Log auftauchen:

```
encoder.detected available=['nvenc', 'software']
encoder.selected name=nvenc
```

Wenn stattdessen `name=software` kommt, ist das ein Hinweis dass
NVENC nicht erreichbar war — meist Toolkit-Setup-Problem. Schau
`docker compose logs worker` für die genaue Ursache.

## GPU-Sharing mit Jellyfin / Immich / anderen

Eine Consumer-GPU (RTX 20-/30-/40-Serie) hat offiziell ein Limit
von **5 gleichzeitigen NVENC-Sessions**. Wenn du Jellyfin und
Immich parallel auf derselben GPU laufen hast und auch noch
Lumio dranhängst, kann das Limit eng werden.

Workaround: [nvidia-patch](https://github.com/keylase/nvidia-patch)
ist eine Open-Source-Modifikation des Treibers, die das Limit
entfernt. Wird breit genutzt in Jellyfin/Plex-Setups und ist
stabil. Setup am Host (nicht im Container) — Lumio merkt davon
nichts.

Was du erwarten kannst:

- Ein Lumio-Worker macht **bis zu 3 parallele NVENC-Sessions**
  pro Video (eine je HLS-Qualitätsstufe: 480p/720p/1080p)
- Bei mehreren Videos in der Queue arbeitet der Worker
  sequenziell durch, nicht parallel — also 3 Sessions belegt,
  nicht mehr
- Mit WORKER_CONCURRENCY > 1 könntest du in den Limit-Bereich
  kommen; default ist 1 für Video-Jobs

## Ohne GPU laufen lassen

Einfach das `-f docker-compose.gpu.yml` weglassen:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d
```

Lumios Encoder-Logik (apps/worker/encoder_profile.py) probt zur
Laufzeit was verfügbar ist und fällt automatisch auf libx264
(CPU) zurück. Es gibt keinen Crash und keine Konfigurations-
Änderung nötig — derselbe Compose-Stack funktioniert auf
Server mit und ohne GPU.

## Encoder explizit steuern

Im Worker-Container die Env-Variable `LUMIO_HW_ENCODER` setzen:

- `auto` (Default) — NVENC → QSV → VAAPI → libx264, in der
  Reihenfolge
- `nvenc` — nur NVENC, fällt auf Software zurück wenn GPU weg
- `qsv` — Intel QuickSync (nicht relevant ohne Intel-GPU)
- `vaapi` — VA-API (AMD oder Intel)
- `software` — explizit libx264, auch wenn GPU da ist
  (z.B. um die GPU für andere Container freizuhalten)

Das Overlay setzt `nvenc` standardmäßig — wenn du deinen Worker
manchmal CPU-only laufen lassen willst (z.B. weil andere
Container die GPU brauchen), kannst du das in deiner `.env`
überschreiben.
