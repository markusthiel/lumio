**English** · [Deutsch](GPU.de.md)

# GPU acceleration (NVIDIA NVENC)

For video processing (HLS transcoding of several quality levels) Lumio can use NVIDIA's NVENC encoder. This cuts the transcoding time of a 1-hour 1080p video from **2-3 hours in software** to **10-20 minutes on a consumer RTX**.

## Requirements

This list must be satisfied on the host server before you enable GPU:

1. **NVIDIA driver installed**

   ```bash
   nvidia-smi
   ```

   should list the GPU plus a driver version.

2. **NVIDIA Container Toolkit installed**

   Guide: [NVIDIA Docs](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html)

   Short version for Ubuntu/Debian:

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

   If this prints `nvidia-smi` output from inside the container → the toolkit works.

## Starting Lumio with GPU

Once the requirements are met, you load the GPU overlay on top:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.gpu.yml \
  up -d
```

On worker start the log should show:

```
encoder.detected available=['nvenc', 'software']
encoder.selected name=nvenc
```

If you get `name=software` instead, that's a sign NVENC wasn't reachable — usually a toolkit setup problem. Check `docker compose logs worker` for the exact cause.

## GPU sharing with Jellyfin / Immich / others

A consumer GPU (RTX 20/30/40 series) officially has a limit of **5 concurrent NVENC sessions**. If you run Jellyfin and Immich in parallel on the same GPU and also attach Lumio, the limit can get tight.

Workaround: [nvidia-patch](https://github.com/keylase/nvidia-patch) is an open-source driver modification that removes the limit. Widely used in Jellyfin/Plex setups and stable. Set it up on the host (not in the container) — Lumio doesn't notice.

What you can expect:

- One Lumio worker does **up to 3 concurrent NVENC sessions** per video (one per HLS quality level: 480p/720p/1080p)
- With several videos in the queue the worker processes them sequentially, not in parallel — so 3 sessions occupied, not more
- With WORKER_CONCURRENCY > 1 you could enter the limit zone; the default is 1 for video jobs

## Running without a GPU

Simply leave out the `-f docker-compose.gpu.yml`:

```bash
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  up -d
```

Lumio's encoder logic (apps/worker/encoder_profile.py) probes at runtime what's available and automatically falls back to libx264 (CPU). There's no crash and no config change needed — the same Compose stack works on servers with and without a GPU.

## Controlling the encoder explicitly

Set the env variable `LUMIO_HW_ENCODER` in the worker container:

- `auto` (default) — NVENC → QSV → VAAPI → libx264, in that order
- `nvenc` — NVENC only, falls back to software if the GPU is gone
- `qsv` — Intel QuickSync (not relevant without an Intel GPU)
- `vaapi` — VA-API (AMD or Intel)
- `software` — explicitly libx264, even if a GPU is present (e.g. to keep the GPU free for other containers)

The overlay sets `nvenc` by default — if you sometimes want to run your worker CPU-only (e.g. because other containers need the GPU), you can override this in your `.env`.
