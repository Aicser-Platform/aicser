import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest


def test_router_is_mounted_under_catalog():
    from src.modules.pipeline.catalog.router import router

    assert router.prefix == "/catalog"


def test_the_router_is_plan_gated_on_lakehouse():
    from src.modules.pipeline.catalog.router import router

    assert router.dependencies, "catalog must carry the lakehouse plan gate"


def test_the_lake_objects_route_exists():
    from src.modules.pipeline.catalog.router import router

    routes = {(r.path, tuple(sorted(r.methods))) for r in router.routes}
    assert ("/catalog/lake-objects", ("GET",)) in routes


async def test_list_lake_objects_serialises_rows(monkeypatch):
    from src.modules.pipeline.catalog import router as module

    obj = SimpleNamespace(
        id=uuid.uuid4(),
        data_source_id="src-1",
        layer="bronze",
        row_count=120,
        byte_size=4096,
        version="v1",
        storage_uri="file://lake/orgs/o1/bronze/src-1/v1.parquet",
        status="active",
        schema_snapshot={"columns": [{"name": "id", "type": "bigint"}]},
        created_at=datetime(2026, 8, 28, tzinfo=timezone.utc),
    )

    class FakeScalars:
        def all(self):
            return [obj]

    class FakeResult:
        def scalars(self):
            return FakeScalars()

    class FakeDB:
        async def execute(self, _statement):
            return FakeResult()

    monkeypatch.setattr(module, "_org_id", lambda payload: uuid.uuid4())

    result = await module.list_lake_objects(db=FakeDB(), payload={})

    assert len(result) == 1
    assert result[0].id == str(obj.id)
    assert result[0].data_source_id == "src-1"
    assert result[0].layer == "bronze"
    assert result[0].schema_snapshot == {"columns": [{"name": "id", "type": "bigint"}]}


async def test_list_lake_objects_returns_an_empty_list_for_an_org_with_nothing(
    monkeypatch,
):
    from src.modules.pipeline.catalog import router as module

    class FakeScalars:
        def all(self):
            return []

    class FakeResult:
        def scalars(self):
            return FakeScalars()

    class FakeDB:
        async def execute(self, _statement):
            return FakeResult()

    monkeypatch.setattr(module, "_org_id", lambda payload: uuid.uuid4())

    result = await module.list_lake_objects(db=FakeDB(), payload={})

    assert result == []


async def test_list_lake_objects_orders_by_created_at_desc(monkeypatch):
    """If a source has 2+ active lake objects at the same layer (e.g. after a
    re-ingest), the client's buildCatalogTree picks whichever one .find()
    hits first; the query must be deterministic (newest first) or the UI can
    show stale data non-deterministically."""
    from src.modules.pipeline.catalog import router as module

    captured = {}

    class FakeScalars:
        def all(self):
            return []

    class FakeResult:
        def scalars(self):
            return FakeScalars()

    class FakeDB:
        async def execute(self, statement):
            captured["statement"] = statement
            return FakeResult()

    monkeypatch.setattr(module, "_org_id", lambda payload: uuid.uuid4())

    await module.list_lake_objects(db=FakeDB(), payload={})

    compiled = str(
        captured["statement"].compile(compile_kwargs={"literal_binds": True})
    )
    assert "ORDER BY" in compiled
    assert "created_at DESC" in compiled


def test_the_profiles_route_exists():
    from src.modules.pipeline.catalog.router import router

    routes = {(r.path, tuple(sorted(r.methods))) for r in router.routes}
    assert ("/catalog/lake-objects/{lake_object_id}/profiles", ("GET",)) in routes


async def test_profiles_maps_a_foreign_org_lake_object_to_404(monkeypatch):
    from fastapi import HTTPException

    from src.modules.pipeline.catalog import router as module

    class FakeResult:
        def scalar_one_or_none(self):
            return None

    class FakeDB:
        async def execute(self, _statement):
            return FakeResult()

    monkeypatch.setattr(module, "_org_id", lambda payload: uuid.uuid4())

    with pytest.raises(HTTPException) as exc_info:
        await module.list_lake_object_profiles(
            str(uuid.uuid4()), limit=20, db=FakeDB(), payload={}
        )

    assert exc_info.value.status_code == 404


async def test_profiles_maps_a_malformed_id_to_404(monkeypatch):
    from fastapi import HTTPException

    from src.modules.pipeline.catalog import router as module

    with pytest.raises(HTTPException) as exc_info:
        await module.list_lake_object_profiles(
            "not-a-uuid", db=object(), payload={}
        )

    assert exc_info.value.status_code == 404


async def test_profiles_returns_the_latest_rows_first(monkeypatch):
    from src.modules.pipeline.catalog import router as module

    owner = SimpleNamespace(id=uuid.uuid4())
    newest = SimpleNamespace(
        id=uuid.uuid4(),
        health_score=91,
        row_count=500,
        sampled=False,
        findings=[{"code": "null_ratio_high"}],
        created_at=datetime(2026, 8, 28, tzinfo=timezone.utc),
    )

    class FakeOwnerResult:
        def scalar_one_or_none(self):
            return owner

    class FakeProfileScalars:
        def all(self):
            return [newest]

    class FakeProfileResult:
        def scalars(self):
            return FakeProfileScalars()

    class FakeDB:
        def __init__(self):
            self._responses = [FakeOwnerResult(), FakeProfileResult()]

        async def execute(self, _statement):
            return self._responses.pop(0)

    monkeypatch.setattr(module, "_org_id", lambda payload: uuid.uuid4())

    result = await module.list_lake_object_profiles(
        str(owner.id), limit=20, db=FakeDB(), payload={}
    )

    assert len(result) == 1
    assert result[0].id == str(newest.id)
    assert result[0].health_score == 91
    assert result[0].findings == [{"code": "null_ratio_high"}]
