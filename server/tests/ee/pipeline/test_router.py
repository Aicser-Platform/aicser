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


async def test_create_pipeline_rejects_a_database_source_with_no_table():
    from pydantic import ValidationError

    from src.modules.pipeline.schemas import PipelineCreateRequest

    with pytest.raises(ValidationError, match="source_table is required"):
        PipelineCreateRequest(
            name="Orders sync",
            source_asset_type="data_source",
            source_asset_id="ds-1",
        )


def test_pipeline_response_surfaces_source_table_and_watermark_column():
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

    response = _to_response(pipeline)

    assert response.source_table == "public.orders"
    assert response.watermark_column == "updated_at"
