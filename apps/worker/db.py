"""
Lumio Worker — Database Access

Schlanke DB-Anbindung über psycopg + raw SQL. Kein ORM-Overkill auf
Worker-Seite — die Logik ist begrenzt: File-Status updaten, Rendition
einfügen, Job-Stream konsumieren.
"""
from __future__ import annotations

import os
from contextlib import contextmanager
from typing import Iterator, Any

import psycopg
from psycopg.rows import dict_row


DATABASE_URL = os.environ["DATABASE_URL"]


@contextmanager
def get_conn() -> Iterator[psycopg.Connection]:
    """Eine Connection pro Job — keep it simple. Bei steigender Last
    auf einen Connection-Pool umstellen (psycopg_pool)."""
    conn = psycopg.connect(DATABASE_URL, row_factory=dict_row)
    try:
        yield conn
        conn.commit()
    except Exception:
        conn.rollback()
        raise
    finally:
        conn.close()


def fetch_file(file_id: str) -> dict[str, Any] | None:
    with get_conn() as conn:
        return conn.execute(
            """
            SELECT f.id, f."originalFilename" AS original_filename,
                   f."storageKey" AS storage_key, f."mimeType" AS mime_type,
                   f."sizeBytes" AS size_bytes, f.kind, f.status,
                   f.width, f.height, f."galleryId" AS gallery_id,
                   g."tenantId" AS tenant_id
            FROM files f
            JOIN galleries g ON g.id = f."galleryId"
            WHERE f.id = %s
            """,
            (file_id,),
        ).fetchone()


def mark_file_ready(
    file_id: str,
    width: int | None,
    height: int | None,
    sha256: str | None = None,
) -> None:
    """Setzt status='ready' + finale Maße. Wenn sha256 mitgegeben wird,
    wird der Hash in derselben Transaktion geschrieben — vermeidet eine
    Zwischen-Zeile mit ready=true aber sha256=NULL, die für die Dup-
    Detection als 'ungehashed' zählen würde."""
    with get_conn() as conn:
        if sha256 is not None:
            conn.execute(
                """
                UPDATE files
                SET status = 'ready', width = %s, height = %s,
                    sha256 = %s, "updatedAt" = NOW()
                WHERE id = %s
                """,
                (width, height, sha256, file_id),
            )
        else:
            conn.execute(
                """
                UPDATE files
                SET status = 'ready', width = %s, height = %s,
                    "updatedAt" = NOW()
                WHERE id = %s
                """,
                (width, height, file_id),
            )


def update_file_sha256(file_id: str, sha256: str) -> None:
    """Setzt nur den sha256 (für Backfill bestehender Files)."""
    with get_conn() as conn:
        conn.execute(
            'UPDATE files SET sha256 = %s, "updatedAt" = NOW() WHERE id = %s',
            (sha256, file_id),
        )


def set_taken_at(file_id: str, taken_at) -> None:
    """Setzt den Aufnahmezeitpunkt aus EXIF. taken_at ist ein (naiver)
    datetime oder None. Bei None passiert NICHTS — wir überschreiben ein
    evtl. schon gesetztes Datum nicht mit NULL."""
    if taken_at is None:
        return
    with get_conn() as conn:
        conn.execute(
            'UPDATE files SET "takenAt" = %s, "updatedAt" = NOW() WHERE id = %s',
            (taken_at, file_id),
        )


def mark_file_failed(file_id: str, message: str) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE files
            SET status = 'failed', "errorMessage" = %s, "updatedAt" = NOW()
            WHERE id = %s
            """,
            (message[:500], file_id),
        )


def upsert_rendition(
    file_id: str,
    kind: str,
    storage_key: str,
    fmt: str,
    width: int | None,
    height: int | None,
    size_bytes: int,
    metadata: dict | None = None,
    page: int = 0,
) -> None:
    """Insert oder Update (auf fileId+kind+page unique)."""
    import json
    meta_json = json.dumps(metadata) if metadata is not None else None
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO renditions
                (id, "fileId", kind, page, "storageKey", format, width, height,
                 "sizeBytes", metadata, "createdAt")
            VALUES
                (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, %s, %s::jsonb, NOW())
            ON CONFLICT ("fileId", kind, page) DO UPDATE
                SET "storageKey" = EXCLUDED."storageKey",
                    format = EXCLUDED.format,
                    width = EXCLUDED.width,
                    height = EXCLUDED.height,
                    "sizeBytes" = EXCLUDED."sizeBytes",
                    metadata = EXCLUDED.metadata
            """,
            (file_id, kind, page, storage_key, fmt, width, height,
             size_bytes, meta_json),
        )


def set_page_count(file_id: str, page_count: int) -> None:
    """Setzt die Seitenzahl eines mehrseitigen Dokuments (PDF)."""
    with get_conn() as conn:
        conn.execute(
            'UPDATE files SET "pageCount" = %s, "updatedAt" = NOW() WHERE id = %s',
            (page_count, file_id),
        )
