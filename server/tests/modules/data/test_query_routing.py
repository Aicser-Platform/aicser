import uuid

import pytest


async def test_resolve_query_source_passes_through_non_database_sources():
    from src.modules.data.services.query_routing import resolve_query_source

    ds = {"id": "f1", "type": "file"}
    result = await resolve_query_source(ds)
    assert result is ds


async def test_resolve_query_source_passes_through_when_no_id_present():
    from src.modules.data.services.query_routing import resolve_query_source

    ds = {"type": "database"}  # no "id" or "data_source_id" key
    result = await resolve_query_source(ds)
    assert result is ds


async def test_resolve_query_source_passes_through_when_not_pipeline_managed(monkeypatch):
    from src.modules.data.services.query_routing import resolve_query_source

    class FakeResult:
        def scalars(self):
            class S:
                def first(self):
                    return None
            return S()

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def execute(self, stmt):
            return FakeResult()

    monkeypatch.setattr(
        "src.db.session.async_session", lambda: FakeSession()
    )

    ds = {"id": "ds-1", "type": "database"}
    result = await resolve_query_source(ds)
    assert result is ds


async def test_resolve_query_source_raises_when_pipeline_managed_but_not_ready(monkeypatch):
    from src.modules.data.services.query_routing import (LakehouseNotReady,
                                                           resolve_query_source)

    pipeline_id = uuid.uuid4()
    fake_pipeline = type("P", (), {"id": pipeline_id})()
    fake_run = type("R", (), {"status": "failed"})()

    calls = {"n": 0}

    class FakeResult:
        def __init__(self, value, many=False):
            self._value = value
            self._many = many

        def scalars(self):
            outer = self

            class S:
                def first(self):
                    return outer._value
            return S()

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def execute(self, stmt):
            calls["n"] += 1
            # 1st call: DataPipeline lookup, 2nd: DataLakeObject (none), 3rd: last run
            if calls["n"] == 1:
                return FakeResult(fake_pipeline)
            if calls["n"] == 2:
                return FakeResult(None)
            return FakeResult(fake_run)

    monkeypatch.setattr(
        "src.db.session.async_session", lambda: FakeSession()
    )

    with pytest.raises(LakehouseNotReady) as exc_info:
        await resolve_query_source({"id": "ds-1", "type": "database"})

    assert exc_info.value.pipeline_id == pipeline_id
    assert exc_info.value.last_run_status == "failed"


async def test_resolve_query_source_returns_a_lakehouse_source_when_ready(monkeypatch):
    from src.modules.data.services.query_routing import resolve_query_source

    fake_pipeline = type("P", (), {"id": uuid.uuid4()})()
    fake_gold = type(
        "G",
        (),
        {
            "storage_uri": "s3://lake/orgs/o1/gold/orders/",
            "schema_snapshot": {"columns": [{"name": "id", "type": "bigint"}]},
        },
    )()

    calls = {"n": 0}

    class FakeResult:
        def __init__(self, value):
            self._value = value

        def scalars(self):
            outer = self

            class S:
                def first(self):
                    return outer._value
            return S()

    class FakeSession:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def execute(self, stmt):
            calls["n"] += 1
            if calls["n"] == 1:
                return FakeResult(fake_pipeline)
            return FakeResult(fake_gold)

    monkeypatch.setattr(
        "src.db.session.async_session", lambda: FakeSession()
    )

    result = await resolve_query_source({"id": "ds-1", "type": "database", "name": "Prod DB"})

    assert result["type"] == "lakehouse_iceberg"
    assert result["storage_uri"] == "s3://lake/orgs/o1/gold/orders/"
    assert result["format"] == "iceberg"
    assert result["schema"] == {"columns": [{"name": "id", "type": "bigint"}]}
    assert result["name"] == "Prod DB"  # original fields preserved
