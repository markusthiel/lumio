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


def mark_file_ready(file_id: str, width: int | None, height: int | None) -> None:
    with get_conn() as conn:
        conn.execute(
            """
            UPDATE files
            SET status = 'ready', width = %s, height = %s,
                "updatedAt" = NOW()
            WHERE id = %s
            """,
            (width, height, file_id),
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
) -> None:
    """Insert oder Update (auf fileId+kind unique)."""
    with get_conn() as conn:
        conn.execute(
            """
            INSERT INTO renditions
                (id, "fileId", kind, "storageKey", format, width, height, "sizeBytes", "createdAt")
            VALUES
                (gen_random_uuid(), %s, %s, %s, %s, %s, %s, %s, NOW())
            ON CONFLICT ("fileId", kind) DO UPDATE
                SET "storageKey" = EXCLUDED."storageKey",
                    format = EXCLUDED.format,
                    width = EXCLUDED.width,
                    height = EXCLUDED.height,
                    "sizeBytes" = EXCLUDED."sizeBytes"
            """,
            (file_id, kind, storage_key, fmt, width, height, size_bytes),
        )
