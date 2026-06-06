**English** · [Deutsch](ML.de.md)

# AI auto-tagging (CLIP)

Lumio can tag images automatically on upload – e.g. it recognizes beach, wedding, portrait, studio setup, sunset. The tags are added to the photo records and are searchable.

This is **optional**. If you don't need auto-tagging, there's nothing to do – the standard worker has the feature disabled.

---

## What it does

Lumio uses **OpenAI CLIP** (Contrastive Language-Image Pretraining) locally on your server. No external API call, everything on your hardware. The model is open, runs offline, costs no API fees.

On every image upload:

1. The worker fetches the image from S3
2. CLIP computes an embedding (vector)
3. The embedding is compared against a list of tag candidates
4. Tags with a confidence above `LUMIO_CLIP_THRESHOLD` are stored

The tag candidates are configurable in a word list (`apps/worker/lumio/clip_labels.py` if present – otherwise hardcoded).

---

## CPU vs GPU

| | CPU | GPU |
|---|---|---|
| **Per image** | 1–3 seconds | 50–200 ms |
| **RAM requirement** | ~3 GB | ~3 GB + ~2 GB VRAM |
| **Hardware** | any amd64 or arm64 server | NVIDIA GPU with Compute Capability 5.0+ (amd64 only) |
| **Setup** | only `docker-compose.ml.yml` | additionally `docker-compose.gpu.yml` + NVIDIA Container Toolkit |
| **When it makes sense** | few uploads, background processing | high throughput, several users in parallel |

For a solo studio with 100 images a day: CPU is plenty. For SaaS with 1000+ uploads per hour: GPU makes sense.

---

## CPU setup (simple)

It's enough to add `docker-compose.ml.yml` to the stack:

```bash
cd /opt/docker/lumio/lumio
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  up -d --build worker
```

This swaps the standard worker for one with PyTorch + open_clip_torch. On first start the worker downloads the CLIP model from HuggingFace (~150 MB), which is cached in `lumio_model_cache`.

Check status:

```bash
docker compose logs worker --tail=30 | grep -i clip
```

Should show something like `CLIP model loaded: ViT-B-32 (openai)` and, for images, `tagged image with N labels`.

### Optimizing CPU performance

- **Worker scaling:** several parallel workers allow several concurrent inferences. But each worker holds the CLIP model in RAM (~2 GB), so don't scale it up endlessly.
  ```bash
  docker compose up -d --scale worker=2
  ```
- **Adjust the threshold:** in `.env` `LUMIO_CLIP_THRESHOLD=0.15` (default 0.08). Higher = fewer but more confident tags.

---

## GPU setup (for high throughput)

### Requirements

1. NVIDIA GPU in the server (RTX 20/30/40 series or Tesla/A series)
2. NVIDIA driver installed (`nvidia-smi` must work)
3. NVIDIA Container Toolkit installed ([Installation Guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html))
4. Docker configured with the nvidia runtime (`docker info | grep -i nvidia`)

### Quick install of the Container Toolkit

```bash
# NVIDIA repo
curl -s -L https://nvidia.github.io/libnvidia-container/gpgkey | gpg --dearmor -o /usr/share/keyrings/nvidia-container-toolkit-keyring.gpg
curl -s -L https://nvidia.github.io/libnvidia-container/stable/deb/nvidia-container-toolkit.list | \
  sed 's#deb https://#deb [signed-by=/usr/share/keyrings/nvidia-container-toolkit-keyring.gpg] https://#g' | \
  tee /etc/apt/sources.list.d/nvidia-container-toolkit.list

apt update
apt install -y nvidia-container-toolkit
nvidia-ctk runtime configure --runtime=docker
systemctl restart docker

# Test
docker run --rm --gpus all nvidia/cuda:12.2-base-ubuntu22.04 nvidia-smi
```

If the test shows `nvidia-smi` output: the toolkit is good.

### Starting Lumio with GPU

```bash
cd /opt/docker/lumio/lumio
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  -f docker-compose.gpu.yml \
  up -d --build worker
```

In the worker logs:

```bash
docker compose logs worker | grep -i -E "cuda|gpu"
```

Should show `CUDA available: True, device=cuda:0`. If `CUDA available: False`: the container can't reach the GPU, check the toolkit setup or the compose flag.

### GPU for more than just CLIP

`docker-compose.gpu.yml` also enables **NVENC** in the worker – ffmpeg then uses the GPU for video transcoding instead of the CPU. That's huge for video galleries:

- CPU (libx264): 1080p ~1x real time, 4K ~0.1x real time
- GPU (NVENC): 1080p ~8x real time, 4K ~2x real time

So if you have lots of wedding videos, a GPU pays off even without AI tagging.

---

## Configuration

In `.env` (all optional):

```bash
# CLIP fully on/off (overrides what docker-compose.ml.yml sets)
LUMIO_CLIP_ENABLED=1

# Model choice. Default: ViT-B-32 (small, fast, OK quality).
# Alternatives: ViT-L-14 (better, much slower), ViT-B-16
LUMIO_CLIP_MODEL=ViT-B-32

# Pretraining dataset. Default: openai. Alternative: laion2b_s34b_b79k
# (often better for photo content)
LUMIO_CLIP_PRETRAINED=openai

# Threshold for tag suggestions (0..1). Default: 0.08.
# Higher = fewer but more confident tags. 0.15 is conservative, 0.05 generous.
LUMIO_CLIP_THRESHOLD=0.08
```

After a change, restart the worker:

```bash
docker compose restart worker
```

---

## Customizing the tag word list

The default word list covers typical photo scenarios (wedding, portrait, landscape, studio, ...). If you need domain-specific tags (e.g. "sports event", "industrial shoot"):

Adjust the word list in `apps/worker/lumio/clip_labels.py` (or equivalent), rebuild the worker.

CLIP understands **descriptions**, not just keywords. "A photo of a wedding celebration on the beach" works better than just "wedding".

---

## When auto-tagging is NOT worth it

- You already have your own workflow system with Lightroom keywords
- Privacy-sensitive content (nudity, confidential) – even though CLIP runs locally, an ML classification is an additional data flow
- The worker hardware is already at its limit

---

## Common errors

**Worker hangs on first start:** the CLIP model is being downloaded (~150 MB). Logs show `Downloading ...`. On the first image it may pull further model components. Be patient; on the second start it's in the cache.

**`CUDA available: False` despite a GPU:** the container has no GPU access. Checks:
1. Does `nvidia-smi` work on the host?
2. Does `docker info | grep -i nvidia` show `Runtimes: ... nvidia ...`?
3. Is `docker-compose.gpu.yml` included in the `up` command?
4. Was the worker rebuilt (`--build`)?

**Tags aren't shown:** frontend cache. `Ctrl+Shift+R` in the browser, or reopen the gallery. If it still doesn't appear: check the worker logs for `tagged image` lines.

**High CPU/RAM load:** normal for CPU inference. If the server is heavily loaded, lower the worker concurrency in `.env` (`WORKER_CONCURRENCY=2`) or use a GPU.
