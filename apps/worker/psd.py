"""
Lumio Worker — PSD-Flattening

libvips/pyvips hat keinen nativen PSD-Loader (nur über einen ImageMagick-
Build, der im Standard-Image bewusst fehlt). Damit Photoshop-Dateien
trotzdem als Galerie-Vorschau funktionieren, extrahieren wir hier das
zusammengeführte Composite — also das flachgerechnete Bild, das Photoshop
beim Speichern mit "Maximize Compatibility" ablegt — mit Pillow und
schreiben es als PNG-Zwischendatei. Diese durchläuft anschließend die
normale libvips-Rendition-Pipeline (thumb/preview/web).

Bewusst wird NUR das Composite gelesen, keine Einzel-Layer: für eine
Vorschau ist exakt das gewünscht. Das Original (.psd) bleibt unangetastet
in S3 und steht weiterhin als Download bereit.

Hinweis: Pillow liest klassische PSD (Signatur ``8BPS``, Version 1). Sehr
große PSB-Dateien (Version 2) werden nicht garantiert unterstützt; in dem
Fall schlägt die Verarbeitung kontrolliert fehl (File wird ``failed``).
"""
from __future__ import annotations

PSD_MAGIC = b"8BPS"  # gilt für .psd und .psb


def is_psd(path: str) -> bool:
    """True, wenn die Datei mit der PSD/PSB-Signatur beginnt.

    Magic-Byte-Sniff statt Extension, weil das robuster ist (falscher
    Dateiname, generischer Browser-MIME-Type).
    """
    try:
        with open(path, "rb") as fh:
            return fh.read(4) == PSD_MAGIC
    except OSError:
        return False


def flatten_psd_to_png(src_path: str, out_path: str) -> None:
    """Liest das Composite einer PSD und schreibt es als PNG nach out_path.

    Konvertiert CMYK/Graustufen/Palette nach RGB und rechnet Transparenz
    auf weißem Hintergrund flach, damit die nachgelagerten WebP/JPEG-
    Renditions deterministisch sind und keine schwarzen/transparenten
    Ränder zeigen.
    """
    from PIL import Image  # lazy: schwere optionale Abhängigkeit

    # Pillows Decompression-Bomb-Guard großzügig deaktivieren — ein
    # legitimes 100-MP-Composite würde sonst abgelehnt. Wir verlassen
    # uns stattdessen auf die Ressourcen/Timeouts des Workers.
    Image.MAX_IMAGE_PIXELS = None

    with Image.open(src_path) as im:
        im.load()
        has_alpha = im.mode in ("RGBA", "LA") or (
            im.mode == "P" and "transparency" in im.info
        )
        if has_alpha:
            rgba = im.convert("RGBA")
            base = Image.new("RGB", rgba.size, (255, 255, 255))
            base.paste(rgba, mask=rgba.split()[-1])
            out = base
        elif im.mode == "RGB":
            out = im
        else:
            # CMYK, L, P (ohne Alpha), I, F → nach RGB
            out = im.convert("RGB")

        # compress_level=1: schnelle, verlustfreie Zwischendatei. Sie wird
        # ohnehin sofort von libvips wieder eingelesen und dann gelöscht.
        out.save(out_path, format="PNG", compress_level=1)
