import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace


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
