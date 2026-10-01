import os
import uuid

os.environ.setdefault("AISER_EDITION", "enterprise")

import pyarrow as pa
import pyarrow.parquet as pq


async def test_bronze_routing_writes_regardless_of_storage_backend(
    tmp_path, monkeypatch
):
    """The STORAGE_BACKEND gate is gone by design: Bronze writes on every backend."""
    from src.modules.pipeline.ingest.upload_bridge import \
        maybe_write_upload_to_bronze

    path = tmp_path / "orders.parquet"
    pq.write_table(pa.table({"id": [1, 2, 3]}), path)

    monkeypatch.setattr(
        "src.core.config.settings.STORAGE_BACKEND", "postgres", raising=False
    )
    monkeypatch.setattr(
        "src.core.config.settings.LAKE_ROOT", str(tmp_path / "lake"), raising=False
    )

    out = await maybe_write_upload_to_bronze(
        session=None,
        file_path=str(path),
        organization_id=uuid.uuid4(),
        data_source_id="ds-1",
    )

    assert out is not None
    assert out["row_count"] == 3
    assert out["storage_uri"].startswith("file://")


async def test_bronze_routing_returns_none_on_a_genuine_failure(tmp_path, monkeypatch):
    """A missing/unreadable source file must not break the upload — Bronze is additive."""
    from src.modules.pipeline.ingest.upload_bridge import \
        maybe_write_upload_to_bronze

    monkeypatch.setattr("src.core.config.settings.STORAGE_BACKEND", "", raising=False)
    monkeypatch.setattr(
        "src.core.config.settings.LAKE_ROOT", str(tmp_path / "lake"), raising=False
    )

    out = await maybe_write_upload_to_bronze(
        session=None,
        file_path=str(tmp_path / "does-not-exist.parquet"),
        organization_id=uuid.uuid4(),
        data_source_id="ds-1",
    )
    assert out is None


async def test_bronze_routing_writes_and_returns_uri(tmp_path, monkeypatch):
    from unittest.mock import AsyncMock, MagicMock

    from src.modules.data.models import DataLakeObject
    from src.modules.pipeline.ingest.upload_bridge import \
        maybe_write_upload_to_bronze

    path = tmp_path / "orders.parquet"
    pq.write_table(pa.table({"id": [1, 2, 3]}), path)

    monkeypatch.setattr("src.core.config.settings.STORAGE_BACKEND", "", raising=False)
    monkeypatch.setattr(
        "src.core.config.settings.LAKE_ROOT", str(tmp_path / "lake"), raising=False
    )

    session = AsyncMock()
    session.add = MagicMock()

    out = await maybe_write_upload_to_bronze(
        session=session,
        file_path=str(path),
        organization_id=uuid.uuid4(),
        data_source_id="ds-1",
    )

    assert out is not None
    assert out["row_count"] == 3
    assert out["storage_uri"].startswith("file://")
    assert "/bronze/ds-1/load_id=" in out["object_key"]
    session.add.assert_called_once()
    written = session.add.call_args.args[0]
    assert isinstance(written, DataLakeObject)
