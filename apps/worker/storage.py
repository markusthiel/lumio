"""
Lumio Worker — Storage Helper

Stellt einen S3-Client bereit, der mit allen unterstützten Providern funktioniert
(MinIO, AWS S3, Cloudflare R2, Backblaze B2, Wasabi).
"""
from __future__ import annotations

import os
from functools import lru_cache

import boto3
from botocore.config import Config


@lru_cache(maxsize=1)
def get_s3_client():
    """Lazy-initialisierter, prozessweiter S3-Client."""
    endpoint = os.environ["S3_ENDPOINT"]
    region = os.environ.get("S3_REGION", "us-east-1")
    force_path_style = os.environ.get("S3_FORCE_PATH_STYLE", "true").lower() == "true"

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


def download_to_tempfile(storage_key: str, dest_path: str) -> str:
    """Lädt ein Objekt aus S3 in eine lokale Datei. Gibt den Pfad zurück."""
    s3 = get_s3_client()
    s3.download_file(get_bucket(), storage_key, dest_path)
    return dest_path


def upload_file(local_path: str, storage_key: str, content_type: str | None = None) -> None:
    """Lädt eine lokale Datei nach S3."""
    s3 = get_s3_client()
    extra: dict = {}
    if content_type:
        extra["ContentType"] = content_type
    s3.upload_file(local_path, get_bucket(), storage_key, ExtraArgs=extra)
