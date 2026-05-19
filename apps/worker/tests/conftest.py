"""
Lumio Worker — Integration Test Fixtures

Spinnt eine echte Postgres + MinIO via testcontainers hoch, lädt das
Test-Schema, setzt Umgebungsvariablen und liefert Helper-Funktionen
für Tests.

Container werden session-scoped reused; pro Test wird truncated, statt
neu zu erstellen — sehr viel schneller bei mehreren Tests.

Modi:
  1. Bereits laufende Services nutzen (CI mit `services:`-Mapping):
     LUMIO_TEST_DATABASE_URL und LUMIO_TEST_S3_ENDPOINT setzen, dann
     überspringt der conftest das Container-Starten und verbindet direkt.
  2. Testcontainers (lokale Entwicklung):
     Docker muss laufen, dann werden Postgres + MinIO automatisch gestartet.
  3. Skip (Sandbox ohne Docker und ohne Services):
     Alle Integration-Tests werden übersprungen. LUMIO_REQUIRE_INTEGRATION=1
     macht das in CI zum Fehler.
"""
from __future__ import annotations

import os
import sys
import uuid
from pathlib import Path
from typing import Iterator

import psycopg
import pytest

FIXTURES_DIR = Path(__file__).parent / "fixtures"
SCHEMA_SQL = (FIXTURES_DIR / "schema.sql").read_text()

sys.path.insert(0, str(Path(__file__).parent.parent))


def _docker_available() -> bool:
    try:
        import docker  # type: ignore

        client = docker.from_env()
        client.ping()
        return True
    except Exception:
        return False


# Modus 1: externe Services
EXT_DATABASE_URL = os.environ.get("LUMIO_TEST_DATABASE_URL")
EXT_S3_ENDPOINT = os.environ.get("LUMIO_TEST_S3_ENDPOINT")
EXT_S3_ACCESS_KEY = os.environ.get("LUMIO_TEST_S3_ACCESS_KEY", "minio")
EXT_S3_SECRET_KEY = os.environ.get("LUMIO_TEST_S3_SECRET_KEY", "minio123")
EXT_S3_BUCKET = os.environ.get("LUMIO_TEST_S3_BUCKET", "lumio-test")
USE_EXTERNAL = bool(EXT_DATABASE_URL and EXT_S3_ENDPOINT)

REQUIRE_INT = os.environ.get("LUMIO_REQUIRE_INTEGRATION") == "1"
DOCKER_OK = _docker_available()
INTEGRATION_OK = USE_EXTERNAL or DOCKER_OK

if REQUIRE_INT and not INTEGRATION_OK:
    raise RuntimeError(
        "LUMIO_REQUIRE_INTEGRATION=1 gesetzt, aber weder externe Services "
        "(LUMIO_TEST_DATABASE_URL + LUMIO_TEST_S3_ENDPOINT) noch Docker "
        "sind verfügbar."
    )

skip_no_infra = pytest.mark.skipif(
    not INTEGRATION_OK,
    reason="Weder externe Services noch Docker verfügbar — Integration-Tests übersprungen",
)


@pytest.fixture(scope="session")
def env() -> Iterator[dict]:
    """Liefert die Service-Endpoints (egal ob extern oder via testcontainers)
    und setzt die Worker-Module-ENVs."""

    cleanup_callbacks = []
    overrides: dict[str, str] = {}

    if USE_EXTERNAL:
        assert EXT_DATABASE_URL and EXT_S3_ENDPOINT
        overrides["DATABASE_URL"] = EXT_DATABASE_URL
        overrides["S3_ENDPOINT"] = EXT_S3_ENDPOINT
        overrides["S3_BUCKET"] = EXT_S3_BUCKET
        overrides["S3_ACCESS_KEY"] = EXT_S3_ACCESS_KEY
        overrides["S3_SECRET_KEY"] = EXT_S3_SECRET_KEY
        overrides["S3_REGION"] = "us-east-1"
        overrides["S3_FORCE_PATH_STYLE"] = "true"
    else:
        if not DOCKER_OK:
            pytest.skip("Docker nicht verfügbar")
        from testcontainers.postgres import PostgresContainer
        from testcontainers.minio import MinioContainer

        postgres = PostgresContainer("postgres:16-alpine")
        postgres.start()
        cleanup_callbacks.append(postgres.stop)

        minio = MinioContainer(
            "minio/minio:latest",
            access_key="testkey",
            secret_key="testsecret123",
        )
        minio.start()
        cleanup_callbacks.append(minio.stop)
        minio.get_client().make_bucket("lumio-test")

        host = postgres.get_container_host_ip()
        port = postgres.get_exposed_port(5432)
        overrides["DATABASE_URL"] = (
            f"postgresql://{postgres.username}:{postgres.password}"
            f"@{host}:{port}/{postgres.dbname}"
        )
        overrides["S3_ENDPOINT"] = (
            f"http://{minio.get_container_host_ip()}:"
            f"{minio.get_exposed_port(9000)}"
        )
        overrides["S3_BUCKET"] = "lumio-test"
        overrides["S3_ACCESS_KEY"] = "testkey"
        overrides["S3_SECRET_KEY"] = "testsecret123"
        overrides["S3_REGION"] = "us-east-1"
        overrides["S3_FORCE_PATH_STYLE"] = "true"

    # Schema initialisieren (idempotent — bei externen Services wird auf
    # einer leeren DB aufgesetzt, bei testcontainers eh frisch)
    _initialize_schema(overrides["DATABASE_URL"])

    # Bucket sicherstellen (bei externen Services)
    if USE_EXTERNAL:
        _ensure_bucket(overrides)

    saved = {}
    for k, v in overrides.items():
        saved[k] = os.environ.get(k)
        os.environ[k] = v

    yield overrides

    for k, prev in saved.items():
        if prev is None:
            os.environ.pop(k, None)
        else:
            os.environ[k] = prev

    for cb in cleanup_callbacks:
        try:
            cb()
        except Exception:
            pass


def _initialize_schema(db_url: str) -> None:
    """Wendet das Test-Schema an. Erst die Tables wegputzen, falls es ein
    Re-Run auf einer existierenden DB ist (häufiger Fall: CI nutzt eine
    persistente Service-Postgres über mehrere Test-Suites hinweg)."""
    with psycopg.connect(db_url) as conn:
        with conn.cursor() as cur:
            cur.execute(
                "DROP TABLE IF EXISTS renditions, files, galleries, users, "
                "tenants, zip_downloads CASCADE"
            )
            cur.execute(SCHEMA_SQL)
        conn.commit()


def _ensure_bucket(env: dict) -> None:
    import boto3
    from botocore.config import Config
    from botocore.exceptions import ClientError

    client = boto3.client(
        "s3",
        endpoint_url=env["S3_ENDPOINT"],
        region_name=env["S3_REGION"],
        aws_access_key_id=env["S3_ACCESS_KEY"],
        aws_secret_access_key=env["S3_SECRET_KEY"],
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
        ),
    )
    try:
        client.head_bucket(Bucket=env["S3_BUCKET"])
    except ClientError:
        try:
            client.create_bucket(Bucket=env["S3_BUCKET"])
        except ClientError as e:
            # Bucket existiert evtl. schon, ist OK
            if "BucketAlreadyOwnedByYou" not in str(e):
                raise


@pytest.fixture(scope="function")
def db(env) -> Iterator[psycopg.Connection]:
    """Pro Test eine fresh Connection. Tabellen werden VOR jedem Test
    truncated, damit die Tests unabhängig sind."""
    conn = psycopg.connect(env["DATABASE_URL"])
    with conn.cursor() as cur:
        cur.execute(
            "TRUNCATE renditions, files, galleries, users, tenants, "
            "zip_downloads RESTART IDENTITY CASCADE"
        )
    conn.commit()
    try:
        yield conn
    finally:
        conn.close()


@pytest.fixture(scope="function")
def seed_tenant_and_gallery(db):
    """Legt einen Tenant + eine Galerie an und gibt ihre IDs zurück."""
    tenant_id = str(uuid.uuid4())
    gallery_id = str(uuid.uuid4())
    with db.cursor() as cur:
        cur.execute(
            "INSERT INTO tenants (id, slug, name) VALUES (%s, %s, %s)",
            (tenant_id, f"t-{tenant_id[:8]}", "Test Studio"),
        )
        cur.execute(
            "INSERT INTO galleries (id, \"tenantId\", slug, title) "
            "VALUES (%s, %s, %s, %s)",
            (gallery_id, tenant_id, f"g-{gallery_id[:8]}", "Test Gallery"),
        )
    db.commit()
    return {"tenant_id": tenant_id, "gallery_id": gallery_id}


@pytest.fixture(scope="function")
def s3(env):
    """boto3-Client für direkte Bucket-Aktionen in Tests."""
    import boto3
    from botocore.config import Config

    return boto3.client(
        "s3",
        endpoint_url=env["S3_ENDPOINT"],
        region_name=env["S3_REGION"],
        aws_access_key_id=env["S3_ACCESS_KEY"],
        aws_secret_access_key=env["S3_SECRET_KEY"],
        config=Config(
            signature_version="s3v4",
            s3={"addressing_style": "path"},
        ),
    )


def pytest_collection_modifyitems(config, items):
    for item in items:
        if "integration" in str(item.fspath):
            item.add_marker(skip_no_infra)
