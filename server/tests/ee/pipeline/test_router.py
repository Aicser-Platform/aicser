import os

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_router_is_plan_gated_and_prefixed():
    from src.modules.pipeline.router import router

    assert router.prefix == "/pipelines"
    assert len(router.dependencies) >= 1, "router must carry the lakehouse plan gate"


def test_expected_routes_exist():
    from src.modules.pipeline.router import router

    paths = {(r.path, tuple(sorted(r.methods))) for r in router.routes}
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
        target_layer="silver",
        schedule_cron="0 2 * * *",
    )
    assert ok.slug == "daily-orders"

    with pytest.raises(ValidationError):
        PipelineCreateRequest(
            name="Bad",
            source_asset_type="data_source",
            source_asset_id="ds-1",
            target_layer="silver",
            schedule_cron="every tuesday",
        )


def test_attach_yaml_artifact_links_pipeline_to_published_snapshot():
    import uuid

    from src.modules.data.models import DataPipeline, SemanticLayerArtifact
    from src.modules.pipeline.router import _attach_yaml_artifact

    class FakeSession:
        def __init__(self):
            self.added = []

        def add(self, item):
            self.added.append(item)

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

    _attach_yaml_artifact(session, pipeline, "version: 1", uuid.uuid4())

    assert pipeline.yaml_artifact_id is not None
    assert len(session.added) == 1
    artifact = session.added[0]
    assert isinstance(artifact, SemanticLayerArtifact)
    assert artifact.id == pipeline.yaml_artifact_id
    assert artifact.data_source_id == "ds-1"
    assert artifact.status == "published"
    assert artifact.model_snapshot == {"yaml": "version: 1"}
