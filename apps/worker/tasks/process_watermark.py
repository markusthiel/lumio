"""
Lumio Worker — process_watermark

Erzeugt eine `watermarked`-Rendition für ein File. Wird vom API ausgelöst,
wenn eine Galerie auf watermarkEnabled umgeschaltet wird, oder direkt im
Anschluss an process_file/process_raw, wenn die Galerie das schon hat.

Strategie:
  - Quelle ist die `web`-Rendition (2560px), nicht das Original.
    Das vermeidet doppeltes Demosaicen/Decodieren.
  - Default: Text-Pattern mit gallery.tenant.name oder
    tenant.watermarkText, diagonal über das ganze Bild.
  - Falls tenant.watermarkImageKey gesetzt: PNG-Overlay zentriert (oder
    gekachelt) mit 30 % Opazität.

Output:
  renditions[kind=watermarked, format=webp, q85]
"""
from __future__ import annotations

import os
import tempfile
from pathlib import Path

import structlog

from app import app
from db import fetch_file, upsert_rendition, get_conn
from storage import (
    download_to_file,
    upload_file,
    rendition_key,
    get_s3_client,
    get_bucket,
)


log = structlog.get_logger(__name__)


@app.task(
    name="tasks.process_watermark.generate",
    bind=True,
    max_retries=2,
    default_retry_delay=30,
)
def generate_watermark(self, file_id: str) -> dict:
    log.info("watermark.start", file_id=file_id)

    file_row = fetch_file(file_id)
    if not file_row:
        return {"file_id": file_id, "status": "missing"}

    # Source = web-Rendition holen
    web_key = _find_rendition_key(file_id, "web")
    if not web_key:
        log.warning("watermark.no_web_rendition", file_id=file_id)
        return {"file_id": file_id, "status": "no_web"}

    # Tenant-Config holen
    cfg = _fetch_tenant_watermark(file_row["tenant_id"])
    text = cfg["text"] or cfg["tenant_name"]
    image_key = cfg["image_key"]

    try:
        _process(
            file_row=file_row,
            web_key=web_key,
            text=text,
            image_key=image_key,
        )
        return {"file_id": file_id, "status": "ready"}
    except Exception as err:
        log.exception("watermark.failed", file_id=file_id)
        raise self.retry(exc=err)


def _process(*, file_row: dict, web_key: str,
             text: str, image_key: str | None) -> None:
    import pyvips  # type: ignore

    file_id = file_row["id"]
    tenant_id = file_row["tenant_id"]
    gallery_id = file_row["gallery_id"]

    with tempfile.TemporaryDirectory(prefix="lumio_wm_") as tmp:
        tmpdir = Path(tmp)
        src_path = tmpdir / "web.webp"
        download_to_file(web_key, str(src_path))

        img = pyvips.Image.new_from_file(str(src_path), access="sequential")
        # Wir brauchen einen Buffer-Modus für composite — re-load mit
        # `random` Access oder `.copy_memory()`.
        img = img.copy_memory()

        watermarked = _apply_watermark(
            img=img,
            text=text,
            image_path=_maybe_download_image(image_key, tmpdir) if image_key else None,
        )

        out_path = tmpdir / "watermarked.webp"
        watermarked.write_to_file(f"{out_path}[Q=85,effort=4,strip=true]")

        key = rendition_key(
            tenant_id, gallery_id, file_id, "watermarked", "webp"
        )
        size_bytes = upload_file(str(out_path), key, "image/webp")
        upsert_rendition(
            file_id=file_id, kind="watermarked",
            storage_key=key, fmt="webp",
            width=watermarked.width, height=watermarked.height,
            size_bytes=size_bytes,
        )
        log.info("watermark.complete", file_id=file_id, size=size_bytes)


def _apply_watermark(*, img, text: str, image_path: Path | None):
    """Komponiert Watermark über das Bild. Bei image_path: PNG-Overlay
    mittig, leicht transparent. Sonst: Text diagonal als wiederholtes
    Pattern."""
    import pyvips  # type: ignore

    # Composite verlangt einen gemeinsamen Farbraum. Die web-Rendition ist
    # i.d.R. srgb, aber Graustufen-/CMYK-Quellen koennen abweichen → hart
    # auf srgb ziehen, sonst scheitert das spaetere composite() mit
    # "no known route from '<x>' to 'srgb'".
    if img.interpretation != "srgb":
        img = img.colourspace("srgb")

    if image_path is not None:
        overlay = pyvips.Image.new_from_file(str(image_path), access="sequential")
        # Auf ~40 % der Bildbreite skalieren
        target_w = int(img.width * 0.4)
        scale = target_w / overlay.width if overlay.width > 0 else 1
        overlay = overlay.resize(scale)
        # 35 % Opazität (overlay muss Alpha haben — falls nicht, ergänzen)
        if not overlay.hasalpha():
            overlay = overlay.bandjoin(255)
        overlay = _reduce_alpha(overlay, 0.35)

        x = (img.width - overlay.width) // 2
        y = (img.height - overlay.height) // 2
        return img.composite([overlay], "over", x=[x], y=[y])

    # Text-Pattern: ein einzelnes Text-Bild bauen, dann diagonal gekachelt
    # darüberlegen.
    if not text:
        text = "© Lumio"

    # Größe: ca. 4 % der langen Kante
    font_size = max(18, int(max(img.width, img.height) * 0.04))
    # Pango-Markup für Schriftfarbe/Opazität — pyvips/text rendert Alpha
    pango = (
        f'<span foreground="white" font="Sans Bold {font_size}">'
        f'{_escape_pango(text)}'
        '</span>'
    )
    text_img = pyvips.Image.text(
        pango, width=int(font_size * len(text) * 1.6), dpi=72, rgba=True,
    )

    # Pattern: ein Tile bestehend aus [text + Lücke] horizontal und vertikal
    tile_w = text_img.width + font_size * 6
    tile_h = text_img.height + font_size * 4
    # WICHTIG: black() liefert Interpretation "multiband"; composite() mit dem
    # srgb-Text-Bild scheitert dann ("no known route from 'multiband' to
    # 'srgb'"). Daher explizit als srgb (RGB+Alpha) deklarieren.
    tile = pyvips.Image.black(tile_w, tile_h, bands=4).cast("uchar")
    tile = tile.copy(interpretation="srgb")
    # Text in das Tile mittig einbetten
    tile = tile.composite(
        [text_img],
        "over",
        x=[(tile_w - text_img.width) // 2],
        y=[(tile_h - text_img.height) // 2],
    )

    # Tile auf Bildgröße erweitern (kacheln) und rotieren
    pattern = tile.replicate(
        (img.width // tile_w) + 2,
        (img.height // tile_h) + 2,
    )
    # Diagonal-Effekt: 30° rotieren und passend croppen
    pattern = pattern.similarity(angle=-30, background=[0, 0, 0, 0])
    # Auf Bildgröße zentrieren
    cx = (pattern.width - img.width) // 2
    cy = (pattern.height - img.height) // 2
    pattern = pattern.crop(
        max(0, cx), max(0, cy),
        min(img.width, pattern.width),
        min(img.height, pattern.height),
    )
    # Alpha auf ~25 % reduzieren
    pattern = _reduce_alpha(pattern, 0.25)

    return img.composite([pattern], "over")


def _reduce_alpha(im, factor: float):
    """Multipliziert den Alpha-Kanal eines RGBA-Bildes mit `factor` und
    behaelt die srgb-Interpretation. Nutzt Band-Slicing + Instanz-bandjoin —
    der statische `pyvips.Image.bandjoin([...])`-Aufruf wirft in neueren
    pyvips-Versionen TypeError ("missing argument 'other'")."""
    rgb = im[0:3]
    alpha = im[3] * factor
    return rgb.bandjoin(alpha).copy(interpretation="srgb")


def _escape_pango(s: str) -> str:
    return (s.replace("&", "&amp;")
             .replace("<", "&lt;")
             .replace(">", "&gt;"))


# ---------------------------------------------------------------------------
# Helpers (gehen direkt an die DB, damit Worker autark bleibt)
# ---------------------------------------------------------------------------
def _find_rendition_key(file_id: str, kind: str) -> str | None:
    with get_conn() as conn:
        row = conn.execute(
            'SELECT "storageKey" FROM renditions '
            'WHERE "fileId" = %s AND kind = %s',
            (file_id, kind),
        ).fetchone()
    return row["storageKey"] if row else None


def _fetch_tenant_watermark(tenant_id: str) -> dict:
    with get_conn() as conn:
        row = conn.execute(
            'SELECT "watermarkImageKey" AS image_key, '
            '"watermarkText" AS text, name AS tenant_name '
            'FROM tenants WHERE id = %s',
            (tenant_id,),
        ).fetchone()
    return row or {"image_key": None, "text": None, "tenant_name": "Lumio"}


def _maybe_download_image(key: str, tmpdir: Path) -> Path | None:
    """Lädt das Watermark-PNG ins lokale Tempdir. Tolerant — bei Fehler None."""
    try:
        local = tmpdir / "watermark.png"
        download_to_file(key, str(local))
        return local
    except Exception as err:
        log.warning("watermark.image_download_failed", err=str(err))
        return None
