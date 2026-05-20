"""
Smoke-Tests für tasks.build_zip.

Wir testen das, was sich ohne lebenden S3/DB testen lässt:
- _dedupe_name verhindert Namens-Kollisionen
- Eine ZIP-Datei mit dem Worker-Pattern (ZipFile auf Disk-Datei,
  ZIP_STORED, allowZip64) lässt sich tatsächlich wieder entpacken
  und enthält die richtigen Daten. Das ist die Regression, gegen
  die der frühere Buffer-Truncate-Bug schützt.

Echte S3-Round-Trips laufen über die integration/-Tests (mit
LUMIO_TEST_S3_ENDPOINT in conftest gated).
"""
from __future__ import annotations

import os
import sys
import tempfile
import zipfile

# damit `from tasks...` aufgeht
sys.path.insert(0, os.path.join(os.path.dirname(__file__), ".."))

os.environ.setdefault("REDIS_URL", "redis://localhost:6379")
os.environ.setdefault("DATABASE_URL", "postgres://test:test@localhost/test")

from tasks.build_zip import _dedupe_name  # noqa: E402


def test_dedupe_first_occurrence_returns_name() -> None:
    seen: set[str] = set()
    assert _dedupe_name("IMG_0001.JPG", seen) == "IMG_0001.JPG"
    assert "IMG_0001.JPG" in seen


def test_dedupe_second_occurrence_gets_suffix() -> None:
    seen: set[str] = {"IMG_0001.JPG"}
    assert _dedupe_name("IMG_0001.JPG", seen) == "IMG_0001_2.JPG"


def test_dedupe_third_occurrence_continues_counter() -> None:
    seen: set[str] = {"IMG_0001.JPG", "IMG_0001_2.JPG"}
    assert _dedupe_name("IMG_0001.JPG", seen) == "IMG_0001_3.JPG"


def test_dedupe_handles_no_extension() -> None:
    seen: set[str] = {"README"}
    assert _dedupe_name("README", seen) == "README_2"


def test_zip_disk_pattern_produces_readable_archive() -> None:
    """
    Regression: der frühere Worker-Code hat während des Schreibens den
    BytesIO-Buffer truncate'd, was das Central Directory mit falschen
    Offsets hinterließ. Resultat: Namen lesbar, aber 'Bad magic number
    for file header' beim entry-read. Dieser Test stellt sicher, dass
    das aktuelle Pattern (Disk-backed Tempfile) ein vollständiges,
    entpackbares ZIP produziert.
    """
    tmp = tempfile.NamedTemporaryFile(
        prefix="lumio-zip-test-", suffix=".zip", delete=False
    )
    tmp_path = tmp.name
    try:
        with zipfile.ZipFile(
            tmp, mode="w",
            compression=zipfile.ZIP_STORED,
            allowZip64=True,
        ) as zf:
            for i in range(3):
                zinfo = zipfile.ZipInfo(filename=f"img_{i}.jpg")
                zinfo.compress_type = zipfile.ZIP_STORED
                with zf.open(zinfo, "w") as zentry:
                    # 5 KB Inhalt pro File — größer als ein einzelner
                    # write() call, weniger als der Multipart-Threshold
                    for _ in range(5):
                        zentry.write(b"x" * 1024)
        tmp.close()

        # Lesbar?
        with zipfile.ZipFile(tmp_path) as zf:
            names = zf.namelist()
            assert names == ["img_0.jpg", "img_1.jpg", "img_2.jpg"]
            for n in names:
                data = zf.read(n)  # würde bei kaputtem CD throw'en
                assert len(data) == 5 * 1024
                assert data == b"x" * 5120
    finally:
        os.unlink(tmp_path)


if __name__ == "__main__":
    tests = [
        test_dedupe_first_occurrence_returns_name,
        test_dedupe_second_occurrence_gets_suffix,
        test_dedupe_third_occurrence_continues_counter,
        test_dedupe_handles_no_extension,
        test_zip_disk_pattern_produces_readable_archive,
    ]
    failures = 0
    for t in tests:
        try:
            t()
            print(f"ok  {t.__name__}")
        except AssertionError as e:
            print(f"FAIL {t.__name__}: {e}")
            failures += 1
    sys.exit(1 if failures else 0)
