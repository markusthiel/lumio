"""
Lumio Worker — Imaging Helpers

Gemeinsame pyvips-Routinen für die Rendition-Pipelines (process_file,
process_video, process_raw, process_watermark).

Hintergrund: pyvips mit ``access="sequential"`` streamt das Bild durch
die Pipeline und ist daher sparsam mit RAM, kann das Quell-Image aber
nur EINMAL durchlesen. Das heißt: schon ein zweiter ``.resize()`` oder
zweiter ``.write_to_file()`` aus demselben Image-Handle wirft ::

    VipsJpeg: out of order read at line N

Die korrekte Praxis ist deshalb: für jeden Output ein FRISCHES Handle
laden. JPEG-/PNG-Decode ist günstig genug, dass das pro Rendition
keinen messbaren Aufwand bedeutet (~50 ms bei einem typischen Foto).
"""
from __future__ import annotations

from pathlib import Path
from typing import Iterable, Tuple, Callable


def _pyvips():
    """Lazy import — pyvips ist eine schwere native Abhängigkeit; in CI
    laufen logic-Tests auch ohne libvips am System."""
    import pyvips  # type: ignore
    return pyvips


def probe_dimensions(src_path: str | Path, autorotate: bool = True) -> Tuple[int, int]:
    """Liest nur die Maße aus dem Bild (keine Pixel-Operation).

    Wir öffnen mit sequential-Access und verwerfen sofort wieder — das
    bedeutet keinen Decode, libvips liest nur den JPEG/PNG-Header.
    """
    pyvips = _pyvips()
    img = pyvips.Image.new_from_file(str(src_path), access="sequential")
    if autorotate:
        img = img.autorot()
    return img.width, img.height


def render_image_sizes(
    *,
    src_path: str | Path,
    specs: Iterable[Tuple[str, int, int, str]],
    out_dir: str | Path,
    on_rendition: Callable[[str, str, int, int, str], None] | None = None,
    autorotate: bool = True,
) -> Tuple[int, int]:
    """Erzeugt Renditions aus einer Quelldatei.

    Für JEDE Rendition wird das Quell-Image NEU geladen — siehe
    Modul-Docstring. Das ist die robuste Variante; andere Workarounds
    (``access="random"`` oder ``.copy_memory()`` mit single-load) kosten
    bei großen Originalen substantiell RAM.

    :param specs: Sequenz aus ``(kind, max_edge_pixels, quality, format)``,
        wobei ``format`` einer von ``"webp"`` oder ``"jpg"`` ist. Die
        File-Extension richtet sich danach.
    :param on_rendition: Optional. Wird pro fertig geschriebener Datei
        aufgerufen mit ``(kind, out_path, width, height, format)``.
    :returns: ``(orig_width, orig_height)`` des Quell-Bilds.
    """
    pyvips = _pyvips()
    src_path = Path(src_path)
    out_dir = Path(out_dir)

    src_w, src_h = probe_dimensions(src_path, autorotate=autorotate)
    long_edge = max(src_w, src_h)

    for kind, max_edge, quality, fmt in specs:
        if fmt not in ("webp", "jpg"):
            raise ValueError(f"unsupported rendition format: {fmt!r}")
        scale = min(1.0, max_edge / long_edge) if long_edge > 0 else 1.0
        out_path = out_dir / f"{kind}.{fmt}"

        # Frisches Handle pro Rendition — sequential-Access ist single-pass.
        img = pyvips.Image.new_from_file(str(src_path), access="sequential")
        if autorotate:
            img = img.autorot()
        resized = img.resize(scale) if scale < 1.0 else img

        if fmt == "webp":
            resized.write_to_file(
                f"{out_path}[Q={quality},effort=4,strip=true]"
            )
        else:
            # JPG: Quality + Subsampling 4:2:0 ist Standard für Web-Bilder.
            # interlace=true ergibt progressive JPEGs, was beim Anzeigen
            # im Browser hübscher wirkt; für reine Datei-Downloads
            # neutral. strip=true entfernt EXIF/ICC — wir liefern hier
            # eine 2560px-Web-Version, kein Print-File.
            resized.write_to_file(
                f"{out_path}[Q={quality},interlace=true,strip=true,optimize_coding=true]"
            )

        if on_rendition is not None:
            on_rendition(kind, str(out_path), resized.width, resized.height, fmt)

    return src_w, src_h


# Backwards compat: Aufrufer, die die alte signature ohne format-Tuple
# verwenden, bekommen weiter webp ausgeliefert.
def render_webp_sizes(
    *,
    src_path: str | Path,
    specs: Iterable[Tuple[str, int, int]],
    out_dir: str | Path,
    on_rendition: Callable[[str, str, int, int], None] | None = None,
    autorotate: bool = True,
) -> Tuple[int, int]:
    """Deprecated — neue Aufrufer sollten render_image_sizes nutzen, das
    JPEG- und WebP-Renditions mischen kann."""
    spec4 = [(kind, edge, q, "webp") for kind, edge, q in specs]

    def wrapped(kind: str, path: str, w: int, h: int, _fmt: str) -> None:
        if on_rendition is not None:
            on_rendition(kind, path, w, h)

    return render_image_sizes(
        src_path=src_path, specs=spec4, out_dir=out_dir,
        on_rendition=wrapped, autorotate=autorotate,
    )
