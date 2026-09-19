"""
Lumio Worker — Database Access

Thin DB access via psycopg + raw SQL. No ORM overkill on the worker
side -- the logic is limited: update file status, insert renditions,
consume the job stream.
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
    """One connection per job -- keep it simple. Switch to a connection
    pool (psycopg_pool) if load increases."""
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
    original_md5: str | None = None,
    original_size: int | None = None,
) -> None:
    """Sets status='ready' + final dimensions. When sha256/original_md5
    are given, they are written in the same transaction -- avoids an
    intermediate row with ready=true but hash=NULL (for sha256 that would
    incorrectly count as "unhashed" in dup detection).

    original_md5 (+ optional original_size, the original master's byte
    size -- a cheap pre-filter for Selection-Import, see
    ImportSelectionTask.lua) get NO dedicated column, instead landing
    under exif->'lumio'->{originalMd5,originalSize}. The exif column
    already exists (currently written by nothing, only read defensively
    by auto_tag.py) -- no schema change needed.

    The exif clause only runs when original_md5 is actually set. For
    every other file (the vast majority -- everything except files
    published via the Lightroom plug-in), exif is left completely
    untouched, in particular an existing NULL stays NULL instead of
    flipping to {} on every call. original_size without original_md5 is
    ignored -- doesn't happen in practice, both come from the same
    embedded XMP packet (extract_metadata).

    jsonb_set targets only the 'lumio' key within exif (path {lumio});
    the new value for it is merged separately beforehand from the
    EXISTING 'lumio' object (COALESCE(exif->'lumio', '{}') ||
    jsonb_strip_nulls(jsonb_build_object(...))) -- a future third field
    under 'lumio' survives an originalMd5/-Size write unharmed, and vice
    versa; jsonb_strip_nulls leaves originalSize out entirely instead of
    writing it as {"originalSize": null} when no size was given. The
    detour via the one-level path {lumio} instead of directly
    {lumio,originalMd5} is necessary because jsonb_set cannot create
    multiple MISSING intermediate levels -- a two-level path on an empty
    exif would be a silent no-op."""
    with get_conn() as conn:
        if original_md5 is not None:
            conn.execute(
                """
                UPDATE files
                SET status = 'ready', width = %s, height = %s,
                    sha256 = COALESCE(%s, sha256),
                    exif = jsonb_set(
                        COALESCE(exif, '{}'::jsonb),
                        '{lumio}',
                        COALESCE(exif->'lumio', '{}'::jsonb) || jsonb_strip_nulls(
                            jsonb_build_object('originalMd5', %s::text, 'originalSize', %s::bigint)
                        ),
                        true
                    ),
                    "updatedAt" = NOW()
                WHERE id = %s
                """,
                (width, height, sha256, original_md5, original_size, file_id),
            )
        else:
            conn.execute(
                """
                UPDATE files
                SET status = 'ready', width = %s, height = %s,
                    sha256 = COALESCE(%s, sha256),
                    "updatedAt" = NOW()
                WHERE id = %s
                """,
                (width, height, sha256, file_id),
            )


def reconcile_original_size(file_id: str, size_bytes: int) -> None:
    """Writes the ACTUAL size of the uploaded original back into
    files.sizeBytes.

    Background: at /uploads/init the client reports the size itself; this
    value lands in files.sizeBytes unchecked. For single-part uploads the
    presigned URL does pin the Content-Length, but for multipart uploads
    the part URLs are not size-bound -- a client could report a small
    size and actually upload more. Since storage/quota accounting
    (computeStorageBytes) sums up files.sizeBytes, that would be a way to
    circumvent the storage limit.

    The worker knows the real size after downloading (os.path.getsize)
    and corrects the value here -- the only source of truth is the
    object actually sitting in S3. Idempotent; always overwrites with the
    measured value."""
    if size_bytes is None or size_bytes < 0:
        return
    with get_conn() as conn:
        conn.execute(
            'UPDATE files SET "sizeBytes" = %s, "updatedAt" = NOW() WHERE id = %s',
            (size_bytes, file_id),
        )


def update_file_sha256(file_id: str, sha256: str) -> None:
    """Sets only the sha256 (for backfilling existing files)."""
    with get_conn() as conn:
        conn.execute(
            'UPDATE files SET sha256 = %s, "updatedAt" = NOW() WHERE id = %s',
            (sha256, file_id),
        )


def set_taken_at(file_id: str, taken_at) -> None:
    """Sets the capture timestamp from EXIF. taken_at is a (naive)
    datetime or None. On None, NOTHING happens -- we don't overwrite an
    already-set date with NULL."""
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
    """Insert or update (unique on fileId+kind+page)."""
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
    """Sets the page count of a multi-page document (PDF)."""
    with get_conn() as conn:
        conn.execute(
            'UPDATE files SET "pageCount" = %s, "updatedAt" = NOW() WHERE id = %s',
            (page_count, file_id),
        )
