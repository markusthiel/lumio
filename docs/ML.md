# KI-Auto-Tagging (CLIP)

Lumio kann Bilder beim Upload automatisch verschlagworten – z.B. erkennt es Strand, Hochzeit, Portrait, Studio-Setup, Sonnenuntergang. Die Tags werden den Foto-Records hinzugefügt und sind durchsuchbar.

Das ist **optional**. Wenn du Auto-Tagging nicht brauchst, ist nichts zu tun – der Standard-Worker hat die Funktion deaktiviert.

---

## Was es macht

Lumio nutzt **OpenAI CLIP** (Contrastive Language-Image Pretraining) lokal auf deinem Server. Kein externer API-Call, alles auf deiner Hardware. Modell ist offen, läuft offline, kostet keine API-Gebühren.

Bei jedem Bild-Upload:

1. Worker holt das Bild aus S3
2. CLIP rechnet ein Embedding (Vektor)
3. Embedding wird gegen eine Liste von Tag-Kandidaten verglichen
4. Tags mit Konfidenz über `LUMIO_CLIP_THRESHOLD` werden gespeichert

Die Tag-Kandidaten sind in einer Wörterliste konfigurierbar (`apps/worker/lumio/clip_labels.py` falls vorhanden – sonst hardcodiert).

---

## CPU vs GPU

| | CPU | GPU |
|---|---|---|
| **Pro Bild** | 1–3 Sekunden | 50–200 ms |
| **RAM-Bedarf** | ~3 GB | ~3 GB + ~2 GB VRAM |
| **Hardware** | jeder x86-Server | NVIDIA-GPU mit Compute Capability 5.0+ |
| **Setup** | nur `docker-compose.ml.yml` | zusätzlich `docker-compose.gpu.yml` + NVIDIA Container Toolkit |
| **Wann sinnvoll** | wenige Uploads, Background-Verarbeitung | hoher Durchsatz, mehrere User parallel |

Für ein Solo-Studio mit 100 Bildern pro Tag: CPU reicht locker. Für SaaS mit 1000+ Uploads pro Stunde: GPU sinnvoll.

---

## CPU-Setup (einfach)

Genügt `docker-compose.ml.yml` zum Stack hinzuzufügen:

```bash
cd /opt/docker/lumio/lumio
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  up -d --build worker
```

Das tauscht den Standard-Worker gegen einen mit PyTorch + open_clip_torch. Beim ersten Start lädt der Worker das CLIP-Modell von HuggingFace (~150 MB), das wird in `lumio_model_cache` gecached.

Status prüfen:

```bash
docker compose logs worker --tail=30 | grep -i clip
```

Sollte etwas zeigen wie `CLIP model loaded: ViT-B-32 (openai)` und bei Bildern `tagged image with N labels`.

### CPU-Performance optimieren

- **Worker-Skalierung:** mehrere parallele Worker erlauben mehrere gleichzeitige Inferences. Aber jeder Worker hält das CLIP-Modell im RAM (~2 GB), also nicht maßlos hochschrauben.
  ```bash
  docker compose up -d --scale worker=2
  ```
- **Threshold anpassen:** in `.env` `LUMIO_CLIP_THRESHOLD=0.15` (Default 0.08). Höher = weniger aber sicherere Tags.

---

## GPU-Setup (für hohen Durchsatz)

### Voraussetzungen

1. NVIDIA-GPU im Server (RTX 20/30/40-Serie oder Tesla/A-Serie)
2. NVIDIA-Treiber installiert (`nvidia-smi` muss funktionieren)
3. NVIDIA Container Toolkit installiert ([Installation Guide](https://docs.nvidia.com/datacenter/cloud-native/container-toolkit/install-guide.html))
4. Docker mit nvidia-Runtime konfiguriert (`docker info | grep -i nvidia`)

### Quick-Install Container Toolkit

```bash
# NVIDIA-Repo
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

Wenn der Test `nvidia-smi`-Output zeigt: Toolkit ist gut.

### Lumio mit GPU starten

```bash
cd /opt/docker/lumio/lumio
docker compose \
  -f docker-compose.yml \
  -f docker-compose.prod.yml \
  -f docker-compose.ml.yml \
  -f docker-compose.gpu.yml \
  up -d --build worker
```

In den Worker-Logs:

```bash
docker compose logs worker | grep -i -E "cuda|gpu"
```

Sollte `CUDA available: True, device=cuda:0` zeigen. Wenn `CUDA available: False`: Container kommt nicht an die GPU, Toolkit-Setup oder Compose-Flag prüfen.

### GPU für mehr als nur CLIP

Die `docker-compose.gpu.yml` aktiviert auch **NVENC** im Worker – ffmpeg nutzt dann die GPU für Video-Transcoding statt CPU. Das ist riesig bei Video-Galerien:

- CPU (libx264): 1080p ~1x Echtzeit, 4K ~0.1x Echtzeit
- GPU (NVENC): 1080p ~8x Echtzeit, 4K ~2x Echtzeit

Wenn du also viele Hochzeits-Videos hast, lohnt sich GPU sogar ohne KI-Tagging.

---

## Konfiguration

In `.env` (alle optional):

```bash
# CLIP komplett an/aus (überschreibt was docker-compose.ml.yml setzt)
LUMIO_CLIP_ENABLED=1

# Modell-Wahl. Default: ViT-B-32 (klein, schnell, OK-Qualität).
# Alternativen: ViT-L-14 (besser, deutlich langsamer), ViT-B-16
LUMIO_CLIP_MODEL=ViT-B-32

# Pretrain-Datensatz. Default: openai. Alternative: laion2b_s34b_b79k
# (oft besser für Foto-Inhalte)
LUMIO_CLIP_PRETRAINED=openai

# Threshold für Tag-Vorschläge (0..1). Default: 0.08.
# Höher = weniger aber sicherere Tags. 0.15 ist konservativ, 0.05 großzügig.
LUMIO_CLIP_THRESHOLD=0.08
```

Nach Änderung Worker neu starten:

```bash
docker compose restart worker
```

---

## Tag-Wörterliste anpassen

Die Standard-Wörterliste deckt typische Foto-Szenarien ab (Hochzeit, Portrait, Landschaft, Studio, ...). Falls du domain-spezifische Tags brauchst (z.B. "Sportveranstaltung", "Industrie-Shoot"):

Wörterliste in `apps/worker/lumio/clip_labels.py` (oder analog) anpassen, Worker rebuilden.

CLIP versteht **Beschreibungen**, nicht nur Stichworte. "Ein Foto einer Hochzeitsfeier am Strand" funktioniert besser als nur "Hochzeit".

---

## Wann Auto-Tagging NICHT lohnt

- Du hast eh ein eigenes Workflow-System mit Lightroom-Keywords
- Datenschutz-sensible Inhalte (Akt, vertraulich) – auch wenn CLIP lokal läuft, ist eine ML-Klassifikation ein zusätzlicher Datenfluss
- Worker-Hardware ist eh am Limit

---

## Häufige Fehler

**Worker hängt beim ersten Start:** das CLIP-Modell wird gerade gedownloadet (~150 MB). Logs zeigen `Downloading ...`. Beim ersten Bild kann es weitere Modell-Komponenten ziehen. Geduld, beim zweiten Start ist es im Cache.

**`CUDA available: False` trotz GPU:** Container hat keinen GPU-Zugriff. Checks:
1. `nvidia-smi` auf dem Host funktioniert?
2. `docker info | grep -i nvidia` zeigt `Runtimes: ... nvidia ...`?
3. `docker-compose.gpu.yml` mit drin im `up`-Befehl?
4. Worker neu gebaut (`--build`)?

**Tags werden nicht angezeigt:** Frontend-Cache. `Strg+Shift+R` im Browser, oder Galerie neu öffnen. Falls weiterhin nicht: in Worker-Logs prüfen ob `tagged image` Zeilen kommen.

**Hohe CPU/RAM-Last:** normal bei CPU-Inferenz. Wenn der Server stark belastet wird, Worker-Concurrency in `.env` runtersetzen (`WORKER_CONCURRENCY=2`) oder GPU einsetzen.
