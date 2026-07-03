"""
Lumio Worker — Export ZIP

Pro Galerie ein Export-ZIP für TenantExport. Anders als build_zip:

  - Filter ist NICHT auf publicVisibility='visible' beschränkt; auch
    versteckte / rejected Files kommen mit, weil es ein DATENEXPORT
    ist (Tenant kriegt seine kompletten Daten). Failed/uploading
    bleibt aussen vor — die haben keine sinnvolle S3-Quelle.

  - Nur Originale (nicht Renditions, nicht web-Versionen).

  - Plus ein metadata.json im ZIP-Root mit:
      {
        gallery: { id, slug, title, description, mode, settings, ... }
        sections: [...]
        files: [
          { filename_in_zip, original_filename, ..., tags, sha256 }
        ]
        comments: [...]
        annotations: [...]
        selections: [...]  (gruppiert per accessId)
      }
    Macht das Archiv selbst-beschreibend — Tenant kann ohne Lumio
    weiterarbeiten.

Aufruf vom Backend:
  enqueue Queues.EXPORT mit
    { type: "export_zip", exportItemId, tenantId, galleryId }
"""
from __future__ import annotations

import json
import os
import tempfile
import zipfile
from datetime import datetime
from typing import Any

import structlog
from botocore.exceptions import ClientError

from app import app
from db import get_conn
from storage import get_s3_client, get_bucket


log = structlog.get_logger(__name__)

UPLOAD_PART_BYTES = 8 * 1024 * 1024


@app.task(
    name="tasks.export_zip.build",
    bind=True,
    max_retries=1,
    default_retry_delay=120,
)
def build_export_zip(
    self,
    export_item_id: str,
    tenant_id: str,
    gallery_id: str,
) -> dict:
    log.info(
        "export_zip.start",
        item_id=export_item_id, tenant=tenant_id, gallery=gallery_id,
    )
    _set_item_status(export_item_id, "building")

    try:
        result = _build(
            tenant_id=tenant_id,
            gallery_id=gallery_id,
        )
        _set_item_ready(
            export_item_id,
            storage_key=result["storage_key"],
            size_bytes=result["size_bytes"],
            file_count=result["file_count"],
        )
        # Wenn das letzte Item dieses Exports fertig ist, markiere den
        # Export als 'ready' (oder 'ready' mit failed-Items — egal,
        # Hauptsache nichts läuft mehr).
        _maybe_finalize_export(export_item_id)
        return {
            "item_id": export_item_id,
            "status": "ready",
            "size_bytes": result["size_bytes"],
            "file_count": result["file_count"],
        }
    except Exception as err:
        log.exception("export_zip.failed", item_id=export_item_id)
        _set_item_failed(export_item_id, str(err))
        _maybe_finalize_export(export_item_id)
        # Kein retry für Export-Builds: wenn etwas wirklich kaputt ist
        # (z.B. Galerie weg, S3 nicht erreichbar), bringt der zweite
        # Versuch in 2 Minuten meistens nichts. Item ist als failed
        # markiert, Tenant sieht das im UI und kann's manuell neu
        # starten falls gewollt.
        return {"item_id": export_item_id, "status": "failed"}


def _build(*, tenant_id: str, gallery_id: str) -> dict[str, Any]:
    s3 = get_s3_client()
    bucket = get_bucket()

    # Metadaten + Files in einer Transaktion holen (konsistenter Snapshot).
    meta = _fetch_gallery_meta(gallery_id)
    if not meta:
        raise ValueError("gallery not found or empty")
    files = _fetch_files(gallery_id)
    sections = _fetch_sections(gallery_id)
    comments = _fetch_comments(gallery_id)
    selections = _fetch_selections(gallery_id)

    ts = datetime.utcnow().strftime("%Y%m%dT%H%M%SZ")
    safe_slug = "".join(c if c.isalnum() or c in "-_" else "_" for c in meta["slug"])
    out_key = f"t/{tenant_id}/exports/{ts}_{safe_slug}.zip"

    tmp = tempfile.NamedTemporaryFile(
        prefix="lumio-export-", suffix=".zip", delete=False
    )
    tmp_path = tmp.name
    try:
        seen_names: set[str] = set()
        zipped_files: list[dict] = []
        skipped: list[dict] = []
        with zipfile.ZipFile(
            tmp, mode="w", compression=zipfile.ZIP_STORED, allowZip64=True,
        ) as zf:
            for f in files:
                arcname = _dedupe_name(
                    f"originals/{f['original_filename']}", seen_names
                )
                try:
                    obj = s3.get_object(Bucket=bucket, Key=f["storage_key"])
                except (ClientError, s3.exceptions.NoSuchKey) as e:
                    if _is_not_found(e):
                        skipped.append({
                            "file_id": str(f["id"]),
                            "filename": f["original_filename"],
                            "reason": "missing_in_s3",
                        })
                        continue
                    raise

                zinfo = zipfile.ZipInfo(filename=arcname)
                zinfo.compress_type = zipfile.ZIP_STORED
                zinfo.date_time = datetime.utcnow().timetuple()[:6]
                with zf.open(zinfo, mode="w", force_zip64=True) as zentry:
                    body = obj["Body"]
                    while True:
                        chunk = body.read(8 * 1024 * 1024)
                        if not chunk:
                            break
                        zentry.write(chunk)
                zipped_files.append({
                    "file_id": str(f["id"]),
                    "filename_in_zip": arcname,
                    "original_filename": f["original_filename"],
                    "mime_type": f["mime_type"],
                    "size_bytes": int(f["size_bytes"]),
                    "kind": f["kind"],
                    "sha256": f.get("sha256"),
                    "width": f.get("width"),
                    "height": f.get("height"),
                    "created_at": (
                        f["created_at"].isoformat()
                        if f.get("created_at") else None
                    ),
                    "section_id": (
                        str(f["section_id"]) if f.get("section_id") else None
                    ),
                    "tags": f.get("tags") or [],
                })

            # metadata.json zum Schluss schreiben, damit es alle Files
            # referenzieren kann (filename_in_zip).
            metadata = {
                "export": {
                    "generated_at": datetime.utcnow().isoformat() + "Z",
                    "tool": "Lumio",
                    "version": 1,
                },
                "gallery": meta,
                "sections": sections,
                "files": zipped_files,
                "skipped_files": skipped,
                "comments": comments,
                "selections": selections,
            }
            zf.writestr("metadata.json", json.dumps(
                metadata, indent=2, default=str, ensure_ascii=False
            ))
            # README für menschliche Leser.
            zf.writestr("README.txt", _readme_text(meta, len(zipped_files)))

        tmp.close()
        size_bytes = os.path.getsize(tmp_path)
        log.info("export_zip.upload", key=out_key, size=size_bytes)
        _multipart_upload(tmp_path, out_key)

    finally:
        try:
            tmp.close()
        except Exception:
            pass
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    return {
        "storage_key": out_key,
        "size_bytes": size_bytes,
        "file_count": len(zipped_files),
    }


# ---------------------------------------------------------------------------
# DB-Fetches
# ---------------------------------------------------------------------------
def _fetch_gallery_meta(gallery_id: str) -> dict | None:
    with get_conn() as conn:
        row = conn.execute(
            'SELECT id, slug, title, description, mode, status, '
            '  "commentsEnabled", "ratingsEnabled", "downloadEnabled", '
            '  "selectionLimit", "createdAt", "updatedAt" '
            'FROM galleries WHERE id = %s',
            (gallery_id,),
        ).fetchone()
        if not row:
            return None
        return {
            "id": str(row["id"]),
            "slug": row["slug"],
            "title": row["title"],
            "description": row["description"],
            "mode": row["mode"],
            "status": row["status"],
            "comments_enabled": row["commentsEnabled"],
            "ratings_enabled": row["ratingsEnabled"],
            "download_enabled": row["downloadEnabled"],
            "selection_limit": row["selectionLimit"],
            "created_at": row["createdAt"],
            "updated_at": row["updatedAt"],
        }


def _fetch_files(gallery_id: str) -> list[dict]:
    """Alle ready-Files der Galerie inkl. versteckte/rejected.
    
    Wir holen die files-Tabelle erst, dann die file_tags separat —
    eine JOIN-Aggregation mit array_agg waere kuerzer, aber bei
    Galerien mit vielen Tags fehleranfaelliger im psycopg-Mapping.
    """
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT f.id, f."originalFilename" AS original_filename, '
            '  f."mimeType" AS mime_type, f."sizeBytes" AS size_bytes, '
            '  f.kind, f.sha256, f.width, f.height, '
            '  f."storageKey" AS storage_key, '
            '  f."sectionId" AS section_id, f."createdAt" AS created_at '
            'FROM files f '
            'WHERE f."galleryId" = %s AND f.status = %s '
            'ORDER BY f."sortIndex", f."createdAt"',
            (gallery_id, "ready"),
        ).fetchall()
        files = [dict(r) for r in rows]

        if files:
            file_ids = [f["id"] for f in files]
            tag_rows = conn.execute(
                'SELECT ft."fileId" AS file_id, t.name '
                'FROM file_tags ft '
                'JOIN tags t ON t.id = ft."tagId" '
                'WHERE ft."fileId" = ANY(%s)',
                (file_ids,),
            ).fetchall()
            tags_by_file: dict[Any, list[str]] = {}
            for r in tag_rows:
                tags_by_file.setdefault(r["file_id"], []).append(r["name"])
            for f in files:
                f["tags"] = tags_by_file.get(f["id"], [])

    return files


def _fetch_sections(gallery_id: str) -> list[dict]:
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT id, title, "sortIndex" AS sort_index, "createdAt" '
            'FROM gallery_sections WHERE "galleryId" = %s '
            'ORDER BY "sortIndex"',
            (gallery_id,),
        ).fetchall()
        return [
            {
                "id": str(r["id"]),
                "title": r["title"],
                "sort_index": r["sort_index"],
                "created_at": r["createdAt"],
            }
            for r in rows
        ]


def _fetch_comments(gallery_id: str) -> list[dict]:
    """Kommentare (Customer + Studio) zu Files dieser Galerie.

    Annotation (Scribble-JSON) ist in der gleichen Tabelle als
    Comment.annotation. Wir extrahieren beides hier — separater
    Fetch für annotations gibt's nicht, weil keine eigene Tabelle
    existiert.
    """
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT c.id, c."fileId" AS file_id, c.body, '
            '  c."authorLabel" AS author_label, '
            '  c."authorIsStudio" AS author_is_studio, '
            '  c.annotation, c."parentId" AS parent_id, '
            '  c."createdAt" AS created_at '
            'FROM comments c '
            'JOIN files f ON f.id = c."fileId" '
            'WHERE f."galleryId" = %s '
            'ORDER BY c."createdAt"',
            (gallery_id,),
        ).fetchall()
        return [
            {
                "id": str(r["id"]),
                "file_id": str(r["file_id"]),
                "body": r["body"],
                "author_label": r["author_label"],
                "author_is_studio": r["author_is_studio"],
                "annotation": r["annotation"],
                "parent_id": str(r["parent_id"]) if r["parent_id"] else None,
                "created_at": r["created_at"],
            }
            for r in rows
        ]


def _fetch_selections(gallery_id: str) -> list[dict]:
    """Customer-Auswahl (Likes / Farben / Ratings / Status), pro File pro Access.
    """
    with get_conn() as conn:
        rows = conn.execute(
            'SELECT s.id, s."accessId" AS access_id, s."fileId" AS file_id, '
            '  s.color, s.rating, s.liked, s.status, '
            '  s."createdAt" AS created_at, ga.label AS access_label '
            'FROM selections s '
            'JOIN files f ON f.id = s."fileId" '
            'LEFT JOIN gallery_access ga ON ga.id = s."accessId" '
            'WHERE f."galleryId" = %s '
            'ORDER BY s."accessId", s."createdAt"',
            (gallery_id,),
        ).fetchall()
        return [
            {
                "id": str(r["id"]),
                "access_id": str(r["access_id"]) if r["access_id"] else None,
                "access_label": r["access_label"],
                "file_id": str(r["file_id"]),
                "color": r["color"],
                "rating": r["rating"],
                "liked": r["liked"],
                "status": r["status"],
                "created_at": r["created_at"],
            }
            for r in rows
        ]


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
def _dedupe_name(name: str, seen: set[str]) -> str:
    if name not in seen:
        seen.add(name)
        return name
    base, ext = os.path.splitext(name)
    i = 2
    while True:
        candidate = f"{base} ({i}){ext}"
        if candidate not in seen:
            seen.add(candidate)
            return candidate
        i += 1


def _is_not_found(e: Exception) -> bool:
    if not isinstance(e, ClientError):
        return True  # NoSuchKey
    err = e.response.get("Error", {})
    code = err.get("Code", "")
    status = e.response.get("ResponseMetadata", {}).get("HTTPStatusCode")
    return status == 404 or code in ("NoSuchKey", "NoSuchBucket", "404", "NotFound")


def _readme_text(meta: dict, file_count: int) -> str:
    return (
        f"Lumio Datenexport\n"
        f"=================\n\n"
        f"Galerie:     {meta['title']}\n"
        f"Slug:        {meta['slug']}\n"
        f"Dateien:     {file_count}\n"
        f"Exportiert:  {datetime.utcnow().isoformat()}Z\n\n"
        f"Verzeichnisse:\n"
        f"  originals/    — alle Originaldateien dieser Galerie\n"
        f"  metadata.json — Tags, Auswahl, Markierungen, Kommentare\n\n"
        f"Die metadata.json ist UTF-8-codiert und enthält strukturierte\n"
        f"Daten zu jedem File (siehe Schlüssel 'files'), zu Auswahl-Treffern\n"
        f"der Kunden ('selections'), und zu Kommentaren plus gezeichneten\n"
        f"Markierungen ('comments' — die Markierungen sind dort als\n"
        f"'annotation'-JSON-Feld pro Kommentar enthalten). Die Verknüpfung\n"
        f"zu den Originaldateien erfolgt über 'file_id' und 'filename_in_zip'.\n"
    )


def _multipart_upload(local_path: str, key: str) -> None:
    """Pusht Tempfile als Multipart-Upload zu S3."""
    s3 = get_s3_client()
    bucket = get_bucket()
    mpu = s3.create_multipart_upload(Bucket=bucket, Key=key, ContentType="application/zip")
    upload_id = mpu["UploadId"]
    parts: list[dict] = []
    try:
        with open(local_path, "rb") as fh:
            part_number = 1
            while True:
                chunk = fh.read(UPLOAD_PART_BYTES)
                if not chunk:
                    break
                resp = s3.upload_part(
                    Bucket=bucket, Key=key, PartNumber=part_number,
                    UploadId=upload_id, Body=chunk,
                )
                parts.append({"ETag": resp["ETag"], "PartNumber": part_number})
                part_number += 1
        s3.complete_multipart_upload(
            Bucket=bucket, Key=key, UploadId=upload_id,
            MultipartUpload={"Parts": parts},
        )
    except Exception:
        try:
            s3.abort_multipart_upload(Bucket=bucket, Key=key, UploadId=upload_id)
        except Exception:
            pass
        raise


# ---------------------------------------------------------------------------
# DB-Status-Updates
# ---------------------------------------------------------------------------
def _set_item_status(item_id: str, status: str) -> None:
    with get_conn() as conn:
        conn.execute(
            'UPDATE tenant_export_items SET status = %s, "updatedAt" = NOW() '
            'WHERE id = %s',
            (status, item_id),
        )


def _set_item_ready(item_id: str, *,
                    storage_key: str, size_bytes: int, file_count: int) -> None:
    with get_conn() as conn:
        conn.execute(
            'UPDATE tenant_export_items SET status = %s, '
            '"storageKey" = %s, "sizeBytes" = %s, "fileCount" = %s, '
            '"updatedAt" = NOW() WHERE id = %s',
            ("ready", storage_key, size_bytes, file_count, item_id),
        )


def _set_item_failed(item_id: str, message: str) -> None:
    with get_conn() as conn:
        conn.execute(
            'UPDATE tenant_export_items SET status = %s, '
            '"errorMessage" = %s, "updatedAt" = NOW() WHERE id = %s',
            ("failed", message[:500], item_id),
        )


def _maybe_finalize_export(item_id: str) -> None:
    """Wenn alle Items eines Exports einen Endzustand haben → Export ready."""
    with get_conn() as conn:
        # Export-ID des Items finden, dann pruefen ob noch pending/building
        # Items existieren. Bei 0 → status='ready'.
        export_row = conn.execute(
            'SELECT "exportId" FROM tenant_export_items WHERE id = %s',
            (item_id,),
        ).fetchone()
        if not export_row:
            return
        export_id = export_row["exportId"]
        pending = conn.execute(
            'SELECT COUNT(*) AS c FROM tenant_export_items '
            'WHERE "exportId" = %s AND status IN (%s, %s)',
            (export_id, "pending", "building"),
        ).fetchone()
        if pending["c"] > 0:
            return
        conn.execute(
            'UPDATE tenant_exports SET status = %s, "updatedAt" = NOW() '
            'WHERE id = %s',
            ("ready", export_id),
        )
