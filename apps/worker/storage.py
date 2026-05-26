"""
Lumio Worker — Storage Helper

S3-Client + Key-Generierung. Spiegelt das Schema aus
apps/api/src/services/storage.ts wider — die Keys MÜSSEN exakt
übereinstimmen, sonst findet die API die Renditions nicht wieder.
"""
from __future__ import annotations

import os
from functools import lru_cache
from typing import Optional

import boto3
from botocore.config import Config


@lru_cache(maxsize=1)
def get_s3_client():
    endpoint = os.environ["S3_ENDPOINT"]
    region = os.environ.get("S3_REGION", "us-east-1")
    force_path_style = (
        os.environ.get("S3_FORCE_PATH_STYLE", "true").lower() == "true"
    )

    cfg = Config(
        signature_version="s3v4",
        s3={"addressing_style": "path" if force_path_style else "virtual"},
        retries={"max_attempts": 5, "mode": "adaptive"},
    )

    return boto3.client(
        "s3",
        endpoint_url=endpoint,
        region_name=region,
        aws_access_key_id=os.environ["S3_ACCESS_KEY"],
        aws_secret_access_key=os.environ["S3_SECRET_KEY"],
        config=cfg,
    )


def get_bucket() -> str:
    return os.environ["S3_BUCKET"]


def rendition_key(tenant_id: str, gallery_id: str, file_id: str,
                  kind: str, extension: str) -> str:
    """Muss identisch zur Funktion in apps/api/src/services/storage.ts sein."""
    return f"t/{tenant_id}/g/{gallery_id}/r/{file_id}/{kind}.{extension}"


def download_to_file(storage_key: str, dest_path: str) -> str:
    get_s3_client().download_file(get_bucket(), storage_key, dest_path)
    return dest_path


def upload_file(local_path: str, storage_key: str,
                content_type: Optional[str] = None) -> int:
    extra: dict = {}
    if content_type:
        extra["ContentType"] = content_type
    get_s3_client().upload_file(
        local_path, get_bucket(), storage_key, ExtraArgs=extra
    )
    return os.path.getsize(local_path)


def upload_bytes(data: bytes, storage_key: str, content_type: str) -> int:
    get_s3_client().put_object(
        Bucket=get_bucket(),
        Key=storage_key,
        Body=data,
        ContentType=content_type,
    )
    return len(data)


def delete_prefix(prefix: str) -> dict:
    """Löscht ALLE Objekte unter `prefix` im konfigurierten Bucket.

    Wird für Galerie- und Tenant-Cleanup genutzt: bei Galerie-Delete
    muss `t/<tenantId>/g/<galleryId>/` und `t/<tenantId>/downloads/
    <galleryId>/` weg, bei Tenant-Delete `t/<tenantId>/`.

    S3-Mechanik:
      - ListObjectsV2 liefert max. 1000 Keys pro Page → paginieren
      - DeleteObjects nimmt max. 1000 Keys pro Call → batchen

    Defensiv:
      - Errors pro Batch werden gesammelt und am Ende zurueckgegeben,
        Loop bricht NICHT ab. Bei partiellem Fehler bleibt evtl. ein
        Teil-Müll liegen — der Aufrufer entscheidet ob Retry sinnvoll
        ist.
      - Bei leerem Prefix (kein Objekt vorhanden) ist das Ergebnis
        einfach { deleted: 0, errors: 0 } — kein Error.

    Wichtig: prefix MUSS mit '/' enden, sonst löscht der Aufruf
    versehentlich angrenzende Pfade. Z.B. prefix='t/abc/g/foo'
    würde auch 't/abc/g/foobar/' matchen. Wir enforce'n das hart.
    """
    if not prefix.endswith("/"):
        raise ValueError(f"prefix must end with '/': {prefix!r}")

    s3 = get_s3_client()
    bucket = get_bucket()
    deleted = 0
    errors = 0
    continuation_token: Optional[str] = None

    while True:
        list_kwargs = {"Bucket": bucket, "Prefix": prefix, "MaxKeys": 1000}
        if continuation_token:
            list_kwargs["ContinuationToken"] = continuation_token
        page = s3.list_objects_v2(**list_kwargs)
        contents = page.get("Contents", []) or []
        if not contents:
            break

        keys = [{"Key": obj["Key"]} for obj in contents]
        resp = s3.delete_objects(
            Bucket=bucket,
            Delete={"Objects": keys, "Quiet": True},
        )
        deleted += len(keys) - len(resp.get("Errors", []) or [])
        errors += len(resp.get("Errors", []) or [])

        if not page.get("IsTruncated"):
            break
        continuation_token = page.get("NextContinuationToken")

    return {"prefix": prefix, "deleted": deleted, "errors": errors}


def delete_object(storage_key: str) -> None:
    """Loescht ein einzelnes Objekt aus dem Bucket. Im Gegensatz zu
    delete_prefix nimmt diese Funktion einen exakten Key (kein Slash-
    Suffix-Forcing), passt also fuer einzelne Asset-Files wie
    branding-Logos oder optimierte Hero-Bilder.

    Schluckt 'NoSuchKey'-Fehler still — Idempotenz; ein zweimaliger
    Aufruf ist harmlos."""
    s3 = get_s3_client()
    bucket = get_bucket()
    try:
        s3.delete_object(Bucket=bucket, Key=storage_key)
    except Exception:  # noqa: BLE001
        # boto3 wirft bei NoSuchKey idR keinen Fehler (S3 ist idempotent),
        # aber andere Backends (Minio in seltenen Edge-Cases) koennen.
        # Wir wollen die Caller nicht mit Try/Except belasten.
        pass
