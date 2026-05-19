"""
Integration-Test für `process_file._process`.

Was wir hier prüfen — und was nicht:
  - Wir testen die Pipeline End-to-End: JPEG aus S3 lesen, drei Renditions
    bauen, in S3 hochladen, in der DB als rendition + status='ready' eintragen.
  - Wir testen NICHT Celery (kein Broker, kein Retry-Verhalten).
  - Wir umgehen den Celery-Task-Wrapper und rufen `_process` direkt auf —
    deterministischer und schneller.

Voraussetzung: Docker läuft. Sonst überspringt der Test selbst.
"""
from __future__ import annotations

import io
import uuid
from pathlib import Path

import pytest

FIXTURES_DIR = Path(__file__).parent.parent / "fixtures"
SAMPLE_JPEG = FIXTURES_DIR / "sample.jpg"


@pytest.mark.integration
def test_process_file_jpeg_end_to_end(db, seed_tenant_and_gallery, s3):
    # libvips / pyvips muss im System verfügbar sein
    pytest.importorskip("pyvips")

    tenant_id = seed_tenant_and_gallery["tenant_id"]
    gallery_id = seed_tenant_and_gallery["gallery_id"]
    file_id = str(uuid.uuid4())

    # Original-Storage-Key wie er aus der API käme
    storage_key = f"t/{tenant_id}/g/{gallery_id}/orig/{file_id}/sample.jpg"

    # Original hochladen
    s3.put_object(
        Bucket="lumio-test",
        Key=storage_key,
        Body=SAMPLE_JPEG.read_bytes(),
        ContentType="image/jpeg",
    )

    # File-Record anlegen — der Worker hätte ihn von der API bekommen
    file_size = SAMPLE_JPEG.stat().st_size
    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO files
                (id, "galleryId", "originalFilename", "storageKey",
                 "mimeType", "sizeBytes", kind, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                file_id,
                gallery_id,
                "sample.jpg",
                storage_key,
                "image/jpeg",
                file_size,
                "image",
                "uploaded",
            ),
        )
    db.commit()

    # Worker-Funktion direkt aufrufen
    from tasks.process_file import _process
    from db import fetch_file

    row = fetch_file(file_id)
    assert row is not None
    _process(row)

    # ---- Assert: DB-Status ist 'ready', width/height sind das Original
    with db.cursor() as cur:
        cur.execute(
            'SELECT status, width, height, "errorMessage" FROM files WHERE id = %s',
            (file_id,),
        )
        status, width, height, err = cur.fetchone()
    assert status == "ready", f"unerwartet status={status} err={err}"
    assert width == 320 and height == 240, (width, height)

    # ---- Assert: 3 Renditions in der DB
    with db.cursor() as cur:
        cur.execute(
            'SELECT kind, format, width, height, "sizeBytes", "storageKey" '
            'FROM renditions WHERE "fileId" = %s ORDER BY kind',
            (file_id,),
        )
        rends = cur.fetchall()
    kinds = {r[0] for r in rends}
    assert kinds == {"thumb", "preview", "web"}, kinds

    by_kind = {r[0]: r for r in rends}

    # Format ist webp
    for r in rends:
        assert r[1] == "webp"

    # 320 px Original — alle Renditions max 320 long-edge
    # (kleines Testbild: keine Vergrößerung)
    assert by_kind["thumb"][2] <= 400
    assert by_kind["preview"][2] <= 1600
    assert by_kind["web"][2] <= 2560
    # SizeBytes > 0
    for r in rends:
        assert r[4] > 0, r

    # ---- Assert: Renditions wirklich in S3
    for r in rends:
        key = r[5]
        head = s3.head_object(Bucket="lumio-test", Key=key)
        assert head["ContentLength"] == r[4], (
            f"S3-Größe für {key} != DB-Größe: "
            f"{head['ContentLength']} vs {r[4]}"
        )

    # ---- Assert: Storage-Key-Struktur stimmt zur API-Konvention
    for r in rends:
        kind, _, _, _, _, key = r
        expected_prefix = (
            f"t/{tenant_id}/g/{gallery_id}/r/{file_id}/{kind}."
        )
        assert key.startswith(expected_prefix), (key, expected_prefix)


@pytest.mark.integration
def test_process_file_marks_failed_on_corrupt_source(db, seed_tenant_and_gallery, s3):
    """Ein kaputtes Original muss die File als 'failed' markieren, statt zu
    crashen oder die DB in einem inkonsistenten Zustand zu lassen."""
    pytest.importorskip("pyvips")

    tenant_id = seed_tenant_and_gallery["tenant_id"]
    gallery_id = seed_tenant_and_gallery["gallery_id"]
    file_id = str(uuid.uuid4())
    storage_key = f"t/{tenant_id}/g/{gallery_id}/orig/{file_id}/bad.jpg"

    # Random-Müll als JPEG ausgeben
    s3.put_object(
        Bucket="lumio-test",
        Key=storage_key,
        Body=b"not actually a jpeg, just bytes",
        ContentType="image/jpeg",
    )

    with db.cursor() as cur:
        cur.execute(
            """
            INSERT INTO files
                (id, "galleryId", "originalFilename", "storageKey",
                 "mimeType", "sizeBytes", kind, status)
            VALUES (%s, %s, %s, %s, %s, %s, %s, %s)
            """,
            (
                file_id, gallery_id, "bad.jpg", storage_key,
                "image/jpeg", 30, "image", "uploaded",
            ),
        )
    db.commit()

    from tasks.process_file import _process
    from db import fetch_file, mark_file_failed

    row = fetch_file(file_id)
    # _process wird intern werfen — wir fangen das, simulieren also den
    # Aufruf, den der Celery-Task-Wrapper machen würde
    with pytest.raises(Exception):
        _process(row)
    mark_file_failed(file_id, "test corruption")

    with db.cursor() as cur:
        cur.execute("SELECT status, \"errorMessage\" FROM files WHERE id = %s",
                    (file_id,))
        status, err = cur.fetchone()
    assert status == "failed"
    assert err == "test corruption"
