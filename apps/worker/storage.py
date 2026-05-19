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
