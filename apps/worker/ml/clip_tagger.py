"""
Lumio Worker — CLIP-basiertes Auto-Tagging (KI-Etappe 2)

Nutzt OpenAI CLIP via open_clip_torch fuer Zero-Shot-Klassifikation.

Workflow:
  1. Tag-Vokabular wird einmalig in Text-Embeddings encodiert.
  2. Pro Bild: Image-Embedding berechnen, Cosine-Similarity zu allen
     Tag-Embeddings. Ein Tag wird nur vorgeschlagen, wenn er sowohl den
     relativen Softmax-Threshold als auch einen absoluten Cosine-Gate
     erreicht (_MIN_SIMILARITY) — Letzterer verhindert, dass bei
     fremdem Bildinhalt das 'am wenigsten unpassende' Label durchrutscht.
     Vokabular deckt Hochzeit, Business/Corporate und generische Motive ab.

Performance (ViT-B/32):
  - CPU: ~1-3s pro Bild (Inference) + Tokenizer-Aufwand
  - GPU: ~50-200ms pro Bild

Optional/Conditional-Loading:
  - Wenn torch+open_clip_torch nicht installiert sind: Modul exportiert
    available=False, classify_image() ist no-op. Bestehender rule-based
    Tagger laeuft weiter ohne Aenderungen.
  - Aktiviert via Umgebungsvariable LUMIO_CLIP_ENABLED=1
  - Modell-Cache: $LUMIO_MODEL_CACHE/clip oder /tmp/lumio_models/clip

Modell:
  - Default: ViT-B-32 mit OpenAI-Pretrain (~150MB)
  - Per Env LUMIO_CLIP_MODEL ueberschreibbar fuer Experimente
"""
from __future__ import annotations

import os
import threading
from typing import Optional

import structlog

log = structlog.get_logger(__name__)


# Modul-Verfügbarkeit:
#   available=True nur wenn ALLE folgenden gegeben sind:
#     - LUMIO_CLIP_ENABLED=1 in der Env
#     - torch + open_clip_torch lassen sich importieren
#     - PIL ist da (das hat der Worker eh)
# Bei Fehlern beim Import oder beim ersten Modell-Load: available bleibt
# False, der rule-based-Tagger laeuft trotzdem.
available = False
_load_err: Optional[str] = None

_ENABLED = os.environ.get("LUMIO_CLIP_ENABLED") == "1"

if _ENABLED:
    try:
        import torch  # noqa: F401
        import open_clip  # noqa: F401
        from PIL import Image  # noqa: F401
        available = True
    except Exception as err:  # ImportError, OSError bei missing libs, ...
        _load_err = f"import failed: {err}"
        log.warning("clip_tagger.import_failed", err=str(err))


# Modell-Cache-Verzeichnis
_MODEL_CACHE = os.environ.get("LUMIO_MODEL_CACHE", "/tmp/lumio_models")
_CLIP_MODEL_NAME = os.environ.get("LUMIO_CLIP_MODEL", "ViT-B-32")
_CLIP_PRETRAINED = os.environ.get("LUMIO_CLIP_PRETRAINED", "openai")
# Confidence-Threshold — Vorschlaege unterhalb dieses Wertes werden
# nicht geschrieben (CLIP gibt Wahrscheinlichkeiten zwischen 0..1 nach
# Softmax ueber das gesamte Vokabular; Threshold um 0.05-0.15 ist ueblich)
_CONFIDENCE_THRESHOLD = float(os.environ.get("LUMIO_CLIP_THRESHOLD", "0.08"))
# Absoluter Mindest-Cosine (−1..1) zwischen Bild und bestem Label. Anders
# als die Softmax (die ueber das geschlossene Vokabular immer auf 1.0
# normiert und darum auch bei voellig anderem Bildinhalt das 'am wenigsten
# unpassende' Label hochzieht) misst der rohe Cosine die ABSOLUTE Passung.
# Liegt selbst das beste Label darunter, passt nichts → kein Tag. Damit
# bekommen z.B. Business-Fotos keine Hochzeits-Tags mehr. Empirisch:
# CLIP-ViT-B-32-Treffer liegen ~0.24-0.35, Fehltreffer < 0.20.
_MIN_SIMILARITY = float(os.environ.get("LUMIO_CLIP_MIN_SIMILARITY", "0.21"))
# Maximale Anzahl CLIP-Tags pro Bild (Top-N nach Confidence) — verhindert
# Tag-Spam bei breitem Vokabular.
_MAX_TAGS = int(os.environ.get("LUMIO_CLIP_MAX_TAGS", "5"))


# ----------------------------------------------------------------------------
# CLIP-Vokabular
# ----------------------------------------------------------------------------
# Pro Tag ein Prompt-Template. CLIP funktioniert besser mit
# vollstaendigen Saetzen als mit Einzelwoertern — 'a photo of a wedding
# kiss' ergibt klarere Embeddings als 'wedding_kiss'.
#
# Tags sind absichtlich Hochzeits-fokussiert; das ist die Lumio-
# Hauptzielgruppe. Generische Tags wie 'portrait/landscape' machen wir
# weiter im rule_based-Tagger (CLIP wuerde sie auch erkennen, aber
# zuverlaessiger via Aspect-Ratio).
#
# Tag-Namen sind die internen Keys (snake_case), Prompts der CLIP-Input.
# Die UI-Labels kommen aus AUTO_TAG_VOCABULARY in der API
# (apps/api/src/routes/auto-tags.ts) — Worker und API teilen sich
# die Tag-Keys.
CLIP_TAG_VOCABULARY: dict[str, str] = {
    # -- Hochzeit: Inhalt / Motive --
    "bride_and_groom":   "a wedding photo of a bride and groom together",
    "couple_kiss":       "a photo of a couple kissing at their wedding",
    "wedding_rings":     "a close-up photo of wedding rings",
    "bridal_bouquet":    "a photo of a bridal bouquet of flowers",
    "wedding_dress":     "a photo of a bride wearing a wedding dress",
    "first_dance":       "a photo of newlyweds during their first dance",
    "group_photo":       "a wedding group photo with many people",
    "bridesmaids":       "a photo of bridesmaids at a wedding",
    "ceremony":          "a photo of a wedding ceremony with guests seated",
    "reception":         "a photo of a wedding reception with tables",
    "cake_cutting":      "a photo of a couple cutting a wedding cake",
    "toast":             "a photo of people raising glasses for a toast",
    "details":           "a close-up detail photo of wedding decorations",

    # -- Hochzeit: Setting --
    "church":            "a photo taken inside a church",
    "outdoor_ceremony":  "an outdoor wedding ceremony",
    "garden":            "a photo taken in a garden",
    "beach":             "a wedding photo at the beach",
    "vineyard":          "a wedding at a vineyard",

    # -- Hochzeit: Stil / Emotion --
    "candid":            "a candid unposed wedding photo",
    "posed_portrait":    "a posed formal wedding portrait",
    "laughter":          "a photo of people laughing joyfully",
    "tears":             "a photo of someone with tears of joy at a wedding",
    "dancing":           "a photo of people dancing at a wedding party",

    # -- Business / Corporate --
    "business_portrait": "a professional corporate headshot of a person in business attire",
    "team_photo":        "a group photo of business colleagues or a company team",
    "meeting":           "people in a business meeting around a conference table",
    "presentation":      "a person giving a presentation or speech on a stage",
    "office":            "an interior photo of a modern office workspace",
    "handshake":         "two people shaking hands in a business setting",
    "conference":        "an audience at a conference or corporate event",

    # -- Generisch (album-uebergreifend) --
    "person_portrait":   "a portrait photograph of a single person",
    "product_shot":      "a product photograph on a clean background",
    "food":              "a photograph of plated food or drinks",
    "architecture":      "an architectural photograph of a building",
    "nature_scenery":    "a scenic landscape photograph of nature",
    "cityscape":         "an urban cityscape photograph of a city",
}


# ----------------------------------------------------------------------------
# Lazy Model Loading
# ----------------------------------------------------------------------------
# Modell wird einmalig beim ersten Aufruf geladen und im Prozess gecacht.
# Das spart Container-Startup-Zeit (Worker faehrt sofort hoch und kann
# rule_based-Jobs verarbeiten) und vermeidet Memory-Footprint wenn der
# Worker nur Non-Image-Jobs macht.
#
# Thread-safe via Lock — Celery Workers haben mehrere Threads / Workers
# pro Process. Wir wollen nicht 8x das gleiche Modell in den Speicher
# laden.
_load_lock = threading.Lock()
_model = None
_preprocess = None
_tokenizer = None
_text_features = None  # vorberechnete Text-Embeddings (eine pro Tag)
_tag_order: list[str] = []  # Reihenfolge der Tags fuer Text-Feature-Index
_device = "cpu"


def _ensure_loaded() -> bool:
    """Laedt Modell + Text-Embeddings einmalig. Gibt True wenn ready."""
    global _model, _preprocess, _tokenizer, _text_features, _tag_order, _device

    if not available:
        return False
    if _model is not None:
        return True

    with _load_lock:
        if _model is not None:  # double-check nach Lock
            return True

        try:
            import torch
            import open_clip

            # Modell-Cache-Dir setzen damit open_clip nicht ins $HOME schreibt
            os.makedirs(_MODEL_CACHE, exist_ok=True)
            os.environ.setdefault("HF_HOME", _MODEL_CACHE)
            os.environ.setdefault("XDG_CACHE_HOME", _MODEL_CACHE)

            _device = "cuda" if torch.cuda.is_available() else "cpu"

            # CPU-Thread-Contention vermeiden: laufen N Tagging-Tasks
            # parallel (Celery-Concurrency) und nutzt jede CLIP-Inference
            # per Default ALLE Kerne, kaempfen N×Kerne Threads um die CPU
            # → viel Context-Switching, wenig Durchsatz. Wir geben jeder
            # Inference nur ihren fairen Anteil. Auf GPU irrelevant.
            if _device == "cpu":
                try:
                    cores = os.cpu_count() or 4
                    concurrency = max(1, int(os.environ.get("WORKER_CONCURRENCY", "4")))
                    default_threads = max(1, cores // concurrency)
                    threads = int(os.environ.get(
                        "LUMIO_CLIP_TORCH_THREADS", str(default_threads)
                    ))
                    torch.set_num_threads(threads)
                    log.info("clip_tagger.torch_threads", threads=threads,
                             cores=cores, concurrency=concurrency)
                except Exception as err:
                    log.warning("clip_tagger.thread_tuning_failed", err=str(err))
            log.info("clip_tagger.loading", model=_CLIP_MODEL_NAME,
                     pretrained=_CLIP_PRETRAINED, device=_device)

            model, _, preprocess = open_clip.create_model_and_transforms(
                _CLIP_MODEL_NAME,
                pretrained=_CLIP_PRETRAINED,
                cache_dir=os.path.join(_MODEL_CACHE, "clip"),
            )
            model.eval()
            model = model.to(_device)

            tokenizer = open_clip.get_tokenizer(_CLIP_MODEL_NAME)

            # Tag-Vokabular einmalig tokenisieren + encoden
            _tag_order = list(CLIP_TAG_VOCABULARY.keys())
            prompts = [CLIP_TAG_VOCABULARY[k] for k in _tag_order]
            tokens = tokenizer(prompts).to(_device)
            with torch.no_grad():
                text_features = model.encode_text(tokens)
                text_features = text_features / text_features.norm(
                    dim=-1, keepdim=True
                )

            _model = model
            _preprocess = preprocess
            _tokenizer = tokenizer
            _text_features = text_features

            log.info("clip_tagger.loaded", tags=len(_tag_order), device=_device)
            return True
        except Exception as err:
            log.exception("clip_tagger.load_failed", err=str(err))
            return False


def classify_image(filepath: str) -> list[dict]:
    """Klassifiziert ein einzelnes Bild gegen das CLIP-Vokabular.

    Args:
        filepath: lokaler Pfad zu einem JPEG/WebP/PNG

    Returns:
        Liste von {tagName, confidence, source='clip'} Dicts, sortiert
        nach Confidence absteigend. Nur Tags ueber dem Threshold
        (LUMIO_CLIP_THRESHOLD) werden enthalten.

        Bei nicht-verfuegbarem Modell (unavailable oder load-error):
        leere Liste — der Aufrufer muss tolerant sein.
    """
    if not available or not _ensure_loaded():
        return []

    try:
        import torch
        from PIL import Image

        img = Image.open(filepath).convert("RGB")
        img_tensor = _preprocess(img).unsqueeze(0).to(_device)

        with torch.no_grad():
            image_features = _model.encode_image(img_tensor)
            image_features = image_features / image_features.norm(
                dim=-1, keepdim=True
            )
            # Rohe Cosine-Similarity (−1..1): absolute Passung je Label.
            raw = (image_features @ _text_features.T).squeeze(0)
            # Softmax (×100 wie im CLIP-Paper): relative Verteilung fuers
            # Ranking unter den Labels.
            probs = (100.0 * raw).softmax(dim=-1)
            raw_scores = raw.cpu().tolist()
            prob_scores = probs.cpu().tolist()

        # Zwei Gates pro Label:
        #   1. raw_sim >= _MIN_SIMILARITY — passt das Label ueberhaupt
        #      absolut? Faengt den Closed-Set-Effekt ab (siehe Kommentar
        #      bei _MIN_SIMILARITY): ohne diesen Gate bekaeme jedes Bild
        #      das relativ aehnlichste Label, auch wenn keines wirklich
        #      passt (Business-Foto → Hochzeits-Tag).
        #   2. prob >= _CONFIDENCE_THRESHOLD — relativer Mindestanteil.
        results = []
        for tag_key, raw_sim, prob in zip(_tag_order, raw_scores, prob_scores):
            if raw_sim >= _MIN_SIMILARITY and prob >= _CONFIDENCE_THRESHOLD:
                results.append({
                    "tagName": tag_key,
                    "confidence": float(prob),
                    "source": "clip",
                })
        results.sort(key=lambda r: r["confidence"], reverse=True)
        return results[:_MAX_TAGS]
    except Exception as err:
        log.exception("clip_tagger.classify_failed", filepath=filepath, err=str(err))
        return []


def is_available() -> bool:
    """Externe Check-Methode — fuer Caller die optional CLIP nutzen wollen."""
    return available


def get_status() -> dict:
    """Diagnose-Info fuer /super/system-Page."""
    return {
        "available": available,
        "enabled_env": _ENABLED,
        "load_error": _load_err,
        "loaded": _model is not None,
        "device": _device if _model is not None else None,
        "model": _CLIP_MODEL_NAME,
        "pretrained": _CLIP_PRETRAINED,
        "vocabulary_size": len(_tag_order) if _tag_order else len(CLIP_TAG_VOCABULARY),
        "threshold": _CONFIDENCE_THRESHOLD,
        "min_similarity": _MIN_SIMILARITY,
        "max_tags": _MAX_TAGS,
    }
