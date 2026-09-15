import os
import pytest

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_router_is_plan_gated_and_prefixed():
    from src.modules.pipeline.router import router

    assert router.prefix == "/pipelines"
    assert len(router.dependencies) >= 1, "router must carry the lakehouse plan gate"


def test_expected_routes_exist():
    from src.modules.pipeline.router import router

    paths = {
        (r.path, tuple(sorted(r.methods)))
        for r in router.routes
        if hasattr(r, "path") and hasattr(r, "methods")
    }
    assert ("/pipelines", ("GET",)) in paths
    assert ("/pipelines", ("POST",)) in paths
    assert ("/pipelines/{pipeline_id}", ("PATCH",)) in paths
    assert ("/pipelines/{pipeline_id}/run", ("POST",)) in paths
    assert ("/pipelines/{pipeline_id}/runs", ("GET",)) in paths
    assert ("/pipelines/runs/{run_id}", ("GET",)) in paths
    assert ("/pipelines/runs/{run_id}/cancel", ("POST",)) in paths


def test_create_request_validates_cron():
    import pytest
    from pydantic import ValidationError

    from src.modules.pipeline.schemas import PipelineCreateRequest

    ok = PipelineCreateRequest(
        name="Daily orders",
        source_asset_type="data_source",
        source_asset_id="ds-1",
        source_table="public.orders",
        target_layer="silver",
        schedule_cron="0 2 * * *",
    )
    assert ok.slug == "daily-orders"

    with pytest.raises(ValidationError):
        PipelineCreateRequest(
            name="Bad",
            source_asset_type="data_source",
            source_asset_id="ds-1",
            source_table="public.bad",
            target_layer="silver",
            schedule_cron="every tuesday",
        )


@pytest.mark.asyncio
async def test_attach_yaml_artifact_links_pipeline_to_published_snapshot():
    import uuid

    from src.modules.data.models import DataPipeline, SemanticLayerArtifact
    from src.modules.pipeline.router import _attach_yaml_artifact

    class FakeSession:
        def __init__(self):
            self.added = []

        def add(self, item):
            self.added.append(item)

        async def flush(self):
            pass

    pipeline = DataPipeline(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        name="Prepared records",
        slug="prepared-records",
        source_asset_type="data_source",
        source_asset_id="ds-1",
        target_layer="silver",
        ingest_mode="snapshot",
    )
    session = FakeSession()

    await _attach_yaml_artifact(session, pipeline, "version: 1", uuid.uuid4())

    assert pipeline.yaml_artifact_id is not None
    assert len(session.added) == 1
    artifact = session.added[0]
    assert isinstance(artifact, SemanticLayerArtifact)
    assert artifact.id == pipeline.yaml_artifact_id
    assert artifact.data_source_id == "ds-1"
    assert artifact.status == "published"
    assert artifact.model_snapshot == {"yaml": "version: 1"}


def test_run_validation_rejects_pipeline_without_saved_yaml():
    import uuid

    import pytest
    from fastapi import HTTPException

    from src.modules.data.models import DataPipeline
    from src.modules.pipeline.router import _ensure_pipeline_runnable

    pipeline = DataPipeline(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        name="Prepared records",
        slug="prepared-records",
        source_asset_type="data_source",
        source_asset_id="ds-1",
        target_layer="silver",
        ingest_mode="snapshot",
    )

    with pytest.raises(HTTPException) as exc:
        _ensure_pipeline_runnable(pipeline)

    assert exc.value.status_code == 400
    assert "save the pipeline before running it" in exc.value.detail


async def test_create_pipeline_accepts_a_data_source_with_no_table():
    """`source_asset_type="data_source"` is ALSO how the onboarding wizard and the
    ingest empty state create pipelines for spreadsheet/file uploads (see
    client/ee/src/ee/components/onboarding/OnboardingWizard.tsx and
    IngestEmptyState.tsx) — neither sends a source_table. Requiring one here 422s
    both file-upload flows. `source_table` stays optional; a live-database
    pipeline is identified by actually having it set."""
    from src.modules.pipeline.schemas import PipelineCreateRequest

    req = PipelineCreateRequest(
        name="Orders sync",
        source_asset_type="data_source",
        source_asset_id="ds-1",
    )

    assert req.source_table is None
    assert req.source_asset_type == "data_source"


async def test_pipeline_response_surfaces_source_table_and_watermark_column():
    import uuid

    from src.modules.data.models import DataPipeline
    from src.modules.pipeline.router import _to_response

    pipeline = DataPipeline(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        name="Orders sync",
        slug="orders-sync",
        source_asset_type="data_source",
        source_asset_id="ds-1",
        options={"source_table": "public.orders", "watermark_column": "updated_at"},
        target_layer="silver",
        ingest_mode="incremental",
        enabled=True,
    )

    class FakeResult:
        def scalars(self):
            return self

        def all(self):
            return []

    class FakeDB:
        async def execute(self, stmt):
            return FakeResult()

    response = await _to_response(FakeDB(), pipeline)

    assert response.source_table == "public.orders"
    assert response.watermark_column == "updated_at"
    assert response.sheets == []


async def test_create_pipeline_rejects_a_duplicate_name_with_a_clear_error(monkeypatch):
    """The pipeline builder defaults every new pipeline's title to "Prepared
    records" until the user renames it. A second pipeline saved under that
    default name in the same org hits uq_data_pipeline_org_slug and must not
    surface as a raw 500 — this reproduces the exact production failure seen
    in server logs for POST /api/pipelines."""
    from unittest.mock import AsyncMock

    from fastapi import HTTPException
    from sqlalchemy.exc import IntegrityError

    from src.modules.pipeline.router import create_pipeline
    from src.modules.pipeline.schemas import PipelineCreateRequest

    monkeypatch.setattr(
        "src.modules.pipeline.router.require_source_access",
        AsyncMock(),
    )

    class FakeDB:
        def add(self, item):
            pass

        async def commit(self):
            raise IntegrityError(
                "INSERT INTO data_pipelines ...",
                {},
                Exception(
                    'duplicate key value violates unique constraint '
                    '"uq_data_pipeline_org_slug"\nDETAIL:  Key '
                    "(organization_id, slug)="
                    "(11111111-1111-1111-1111-111111111111, prepared-records) "
                    "already exists."
                ),
            )

        async def rollback(self):
            pass

    body = PipelineCreateRequest(
        name="Prepared records",
        source_asset_type="data_source",
        source_asset_id="db_mysql_1",
        source_table="departments",
        target_layer="silver",
        ingest_mode="incremental",
    )

    with pytest.raises(HTTPException) as exc_info:
        await create_pipeline(
            body,
            db=FakeDB(),
            payload={"organization_id": "11111111-1111-1111-1111-111111111111"},
        )

    assert exc_info.value.status_code == 409
    assert "Prepared records" in exc_info.value.detail


async def test_resolve_preview_source_scopes_the_lookup_to_the_requested_table():
    """A data source backing more than one pipeline (e.g. crm: customers,
    employees) must resolve to the object for the table the caller actually
    asked for -- not just whichever was created most recently. Reproduces the
    exact production symptom: selecting a different table in the pipeline
    builder never changed the preview data, because the old lookup ignored
    source_table entirely and always returned the newest Bronze/Silver row
    for the whole data source."""
    import uuid

    from src.modules.pipeline.router import resolve_preview_source

    org_id = uuid.uuid4()

    customers_obj = type("Obj", (), {"storage_uri": "s3://b/silver/customers", "source_table": "customers"})()
    employees_obj = type("Obj", (), {"storage_uri": "s3://b/silver/employees", "source_table": "employees"})()

    calls = []

    class FakeResult:
        def __init__(self, value):
            self._value = value

        def scalar_one_or_none(self):
            return self._value

    class FakeDB:
        async def execute(self, stmt):
            sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
            calls.append(sql)
            if "data_lake_objects.layer = 'bronze'" in sql:
                return FakeResult(None)  # nothing in Bronze for either table in this test
            if "data_lake_objects.layer = 'silver'" in sql:
                if "data_lake_objects.source_table = 'customers'" in sql:
                    return FakeResult(customers_obj)
                if "data_lake_objects.source_table = 'employees'" in sql:
                    return FakeResult(employees_obj)
            return FakeResult(None)

    result = await resolve_preview_source(
        FakeDB(), org_id=org_id, source_asset_id="db_mysql_1", source_table="customers"
    )

    assert result is customers_obj
    # Confirms the fix actually filters by table, not just data_source_id --
    # a query missing the source_table clause would make this test meaningless.
    assert any("data_lake_objects.source_table = 'customers'" in c for c in calls)


def test_ensure_pipeline_runnable_accepts_a_multi_sheet_pipeline_with_no_pipeline_level_yaml():
    """A multi-sheet pipeline's transform YAML lives per-sheet, not on the
    pipeline's own yaml_artifact_id -- has_sheets=True must be enough to run,
    or every multi-sheet pipeline would 400 on every trigger."""
    import uuid

    from src.modules.data.models import DataPipeline
    from src.modules.pipeline.router import _ensure_pipeline_runnable

    pipeline = DataPipeline(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        name="crm",
        slug="crm",
        source_asset_type="data_source",
        source_asset_id="db_1",
        target_layer="silver",
        ingest_mode="incremental",
    )

    _ensure_pipeline_runnable(pipeline, has_sheets=True)  # must not raise


async def test_sync_sheets_full_replace_creates_updates_and_deletes():
    """PATCH with sheets=[...] is a full replace: a table no longer present
    is dropped, an existing table's watermark/sort_order/yaml are updated in
    place, and a brand-new table gets its own sheet row + YAML artifact."""
    import uuid

    from src.modules.data.models import DataPipeline, DataPipelineSheet
    from src.modules.pipeline.router import _sync_sheets
    from src.modules.pipeline.schemas import SheetSpec

    pipeline = DataPipeline(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        name="crm",
        slug="crm",
        source_asset_type="data_source",
        source_asset_id="db_mysql_1",
        target_layer="silver",
        ingest_mode="incremental",
    )

    kept = DataPipelineSheet(
        id=uuid.uuid4(),
        pipeline_id=pipeline.id,
        source_table="customers",
        watermark_column=None,
        sort_order=0,
    )
    dropped = DataPipelineSheet(
        id=uuid.uuid4(),
        pipeline_id=pipeline.id,
        source_table="deals",
        watermark_column=None,
        sort_order=1,
    )

    added, deleted = [], []

    class FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return self

        def all(self):
            return self._rows

    class FakeDB:
        async def execute(self, stmt):
            return FakeResult([kept, dropped])

        def add(self, obj):
            added.append(obj)

        async def delete(self, obj):
            deleted.append(obj)

        async def flush(self):
            pass

    await _sync_sheets(
        FakeDB(),
        pipeline,
        [
            SheetSpec(source_table="customers", watermark_column="updated_at", yaml="version: 1"),
            SheetSpec(source_table="employees", yaml="version: 1"),
        ],
        actor_id=None,
    )

    assert dropped in deleted
    assert kept.watermark_column == "updated_at"
    assert kept.sort_order == 0
    assert kept.yaml_artifact_id is not None

    new_sheets = [a for a in added if isinstance(a, DataPipelineSheet)]
    assert len(new_sheets) == 1
    assert new_sheets[0].source_table == "employees"

    artifacts = [a for a in added if not isinstance(a, DataPipelineSheet)]
    assert len(artifacts) == 2, "one fresh artifact per sheet with yaml set, including the kept one"


async def test_sheet_items_inlines_yaml_ordered_by_sort_order():
    """The pipeline GET response must carry each sheet's yaml inline so the
    builder can hydrate every tab from one call, without N round-trips to
    /yaml per table."""
    import uuid

    from src.modules.data.models import DataPipelineSheet, SemanticLayerArtifact
    from src.modules.pipeline.router import _sheet_items

    pipeline_id = uuid.uuid4()
    artifact_id = uuid.uuid4()
    sheet_a = DataPipelineSheet(
        id=uuid.uuid4(),
        pipeline_id=pipeline_id,
        source_table="customers",
        watermark_column="updated_at",
        yaml_artifact_id=artifact_id,
        sort_order=0,
    )
    sheet_b = DataPipelineSheet(
        id=uuid.uuid4(),
        pipeline_id=pipeline_id,
        source_table="employees",
        watermark_column=None,
        yaml_artifact_id=None,
        sort_order=1,
    )
    artifact = SemanticLayerArtifact(
        id=artifact_id,
        name="pipeline:crm:customers",
        version="v1",
        object_key="k",
        model_snapshot={"yaml": "version: 1"},
    )

    class FakeResult:
        def __init__(self, rows):
            self._rows = rows

        def scalars(self):
            return self

        def all(self):
            return self._rows

    calls = []

    class FakeDB:
        async def execute(self, stmt):
            calls.append(stmt)
            if len(calls) == 1:
                return FakeResult([sheet_a, sheet_b])
            return FakeResult([artifact])

    items = await _sheet_items(FakeDB(), pipeline_id)

    assert [item.source_table for item in items] == ["customers", "employees"]
    assert items[0].yaml == "version: 1"
    assert items[0].watermark_column == "updated_at"
    assert items[1].yaml is None


async def test_resolve_preview_source_without_a_table_keeps_the_latest_behavior():
    """lake_object pipelines (and any caller that genuinely doesn't know a
    table) must keep working exactly as before -- latest active object for
    the data source, no table filter applied."""
    import uuid

    from src.modules.pipeline.router import resolve_preview_source

    org_id = uuid.uuid4()
    obj = type("Obj", (), {"storage_uri": "s3://b/silver/whatever", "source_table": None})()

    class FakeResult:
        def __init__(self, value):
            self._value = value

        def scalar_one_or_none(self):
            return self._value

    class FakeDB:
        async def execute(self, stmt):
            sql = str(stmt.compile(compile_kwargs={"literal_binds": True}))
            # source_table is a real column now, so it legitimately appears in
            # the SELECT list -- what must NOT appear is a filter on it.
            assert "source_table =" not in sql
            if "data_lake_objects.layer = 'bronze'" in sql:
                return FakeResult(None)
            return FakeResult(obj)

    result = await resolve_preview_source(FakeDB(), org_id=org_id, source_asset_id="lo-1", source_table=None)

    assert result is obj
