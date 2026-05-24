"""
Lumio Worker — File Hashing

SHA-256 berechnen vom Original-File. Wird genutzt für die Duplikat-
Erkennung im Studio: zwei Files mit identischem SHA-256-Hash sind
bit-genau gleich, unabhängig von Filename oder EXIF-Differenzen wie
unterschiedlichem Aufnahmedatum-Tag (denn der ist Teil der Datei
und ändert den Hash mit).

Für unterschiedliche Versionen desselben Fotos (z.B. anderer JPEG-
Export, anderes EXIF) wäre ein perceptual hash (pHash) besser. Wir
fangen aber mit SHA-256 an, weil das deterministisch, schnell und
false-positive-frei ist — der häufigste Dup-Fall ist "User hat
versehentlich beide Versionen rein gezogen", und da ist die Datei
bit-genau identisch.
"""
from __future__ import annotations

import hashlib


# 1 MB Chunk-Size — schnell genug für I/O ohne überdimensionierten
# Memory-Footprint. Bei riesigen Videos (mehrere GB) wollen wir nicht
# alles im RAM haben.
_HASH_CHUNK_BYTES = 1 * 1024 * 1024


def sha256_file(path: str) -> str:
    """Berechnet SHA-256 des Files an `path` und gibt den Hex-Digest
    zurück (64-Zeichen-String, lowercase). Streamt die Datei in
    1-MB-Chunks."""
    h = hashlib.sha256()
    with open(path, "rb") as f:
        while True:
            chunk = f.read(_HASH_CHUNK_BYTES)
            if not chunk:
                break
            h.update(chunk)
    return h.hexdigest()
