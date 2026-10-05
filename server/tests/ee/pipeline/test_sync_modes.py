"""Bronze-only (step 3) and resume-from-Bronze (deploy) sync modes."""

import os
import uuid
from types import SimpleNamespace

os.environ.setdefault("AISER_EDITION", "enterprise")


class FakeStage:
    def __init__(self, name, outputs=None):
        self.name = name
        self.outputs = outputs or {"ok": True}
        self.calls = 0

    async def execute(self, ctx):
        self.calls += 1
        from src.modules.pipeline.runner import StageResult

        return StageResult(stage=self.name, rows=5, outputs=self.outputs)


def _ctx(checkpoint=None):
    from src.modules.pipeline.runner import RunContext

    return RunContext(
        session=None,
        run=SimpleNamespace(id=uuid.uuid4(), checkpoint={}, status="queued"),
        pipeline=SimpleNamespace(id=uuid.uuid4(), target_layer="silver"),
        checkpoint=checkpoint or {},
        org_id=uuid.uuid4(),
    )


async def test_stop_after_ingest_lands_bronze_only():
    from src.modules.pipeline.runner import PipelineRunner

    ingest = FakeStage("ingest", {"bronze_object_id": "b1", "row_count": 42})
    transform, load = FakeStage("transform"), FakeStage("load")
    ctx = _ctx()
    status = await PipelineRunner([ingest, transform, load], stop_after="ingest").run(ctx)

    assert status == "succeeded"
    assert (ingest.calls, transform.calls, load.calls) == (1, 0, 0)
    assert ctx.checkpoint["stage"] == "ingest"
    assert ctx.stage_outputs["ingest"]["row_count"] == 42


async def test_resume_from_bronze_skips_ingest_and_keeps_its_outputs():
    from src.modules.pipeline.runner import PipelineRunner, _bronze_summary

    ingest, transform, load = FakeStage("ingest"), FakeStage("transform"), FakeStage("load")
    ctx = _ctx({"stage": "ingest", "outputs": {"bronze_object_id": "b1", "row_count": 42}})
    status = await PipelineRunner([ingest, transform, load]).run(ctx)

    assert status == "succeeded"
    assert (ingest.calls, transform.calls, load.calls) == (0, 1, 1)
    assert _bronze_summary(ctx) == {"bronze_object_id": "b1", "bronze_rows": 42}


def test_bronze_seed_only_resumes_landed_tables():
    from src.modules.pipeline.sync.service import SyncService

    job = SimpleNamespace(
        checkpoint={
            "stop_after": "ingest",
            "sheets": {
                "orders": {"status": "succeeded", "checkpoint": {"stage": "ingest", "outputs": {"row_count": 9}}},
                "customers": {"status": "failed", "checkpoint": {}},
            },
        }
    )
    seed = SyncService._bronze_seed(job, ["orders", "customers", "products"])

    assert seed == {"orders": {"checkpoint": {"stage": "ingest", "outputs": {"row_count": 9}}}}
    # No "status": the runner must still run Transform/Load for the seeded table
    assert "status" not in seed["orders"]


class _Result:
    def __init__(self, value):
        self.value = value

    def scalar_one_or_none(self):
        return self.value


class _DB:
    def __init__(self, value):
        self.value = value

    async def execute(self, _query):
        return _Result(self.value)


def _job(status, checkpoint):
    return SimpleNamespace(
        id=uuid.uuid4(),
        pipeline_id=uuid.uuid4(),
        status=status,
        checkpoint=checkpoint,
        rows_read=0,
        rows_written=0,
        error_message=None,
        started_at=None,
        finished_at=None,
    )


async def test_status_reports_per_stream_progress_for_bronze_run():
    from src.modules.pipeline.sync.service import SyncService

    job = _job(
        "running",
        {
            "stop_after": "ingest",
            "planned_streams": ["orders", "customers"],
            "current_stream": "customers",
            "current_stage": "ingest",
            "sheets": {
                "orders": {
                    "status": "succeeded",
                    "rows_read": 120,
                    "bronze_object_id": "b-orders",
                    "bronze_rows": 120,
                    "checkpoint": {"stage": "ingest"},
                }
            },
        },
    )
    res = await SyncService.get_sync_status(str(job.id), uuid.uuid4(), _DB(job))

    assert res.mode == "ingest_only"
    assert [(s.name, s.status) for s in res.streams] == [("orders", "succeeded"), ("customers", "running")]
    assert res.streams[0].bronze_rows == 120
    assert res.streams[0].bronze_object_id == "b-orders"
    assert 5 < res.progress_pct < 100


async def test_get_bronze_job_rejects_unfinished_or_full_runs():
    import pytest

    from src.modules.pipeline.sync.service import SyncService

    running = _job("running", {"stop_after": "ingest"})
    with pytest.raises(ValueError, match="has not succeeded"):
        await SyncService._get_bronze_job(str(running.id), uuid.uuid4(), _DB(running))

    full = _job("succeeded", {})
    with pytest.raises(ValueError, match="Bronze-only"):
        await SyncService._get_bronze_job(str(full.id), uuid.uuid4(), _DB(full))

    with pytest.raises(ValueError, match="required"):
        await SyncService._get_bronze_job(None, uuid.uuid4(), _DB(None))


async def test_new_pipeline_gets_a_free_slug_when_a_renamed_one_holds_it():
    """A pipeline renamed in the wizard keeps its slug; a new one under the old name used to
    fail with uq_data_pipeline_org_slug."""
    from unittest.mock import AsyncMock, MagicMock

    from src.modules.pipeline.sync.service import SyncService

    taken = MagicMock()
    taken.scalars.return_value.all.return_value = ["production-analytics-pipeline", "production-analytics-pipeline-2"]
    db = AsyncMock()
    db.execute.return_value = taken

    import uuid

    assert await SyncService._unique_slug(db, uuid.uuid4(), "production-analytics-pipeline") == "production-analytics-pipeline-3"

    taken.scalars.return_value.all.return_value = []
    assert await SyncService._unique_slug(db, uuid.uuid4(), "fresh") == "fresh"


def test_wizard_state_is_stored_without_anything_credential_like():
    from src.modules.pipeline.sync.service import _without_secrets

    state = {
        "pipelineName": "commerce",
        "destinationConfig": {"destination_type": "postgresql", "connection_config": {"password": "p"}},
        "catalog": [{"name": "t", "columns": [{"name": "password_hint"}]}],
        "nested": [{"api_key": "k", "keep": 1}],
    }

    out = _without_secrets(state)

    assert "connection_config" not in out["destinationConfig"]
    assert out["nested"] == [{"keep": 1}]
    assert out["catalog"][0]["columns"][0]["name"] == "password_hint"  # values are kept, keys are judged


async def test_redeploying_an_edited_pipeline_resumes_from_its_current_bronze():
    """No step-3 Bronze job when editing: each table starts at Transform on the Bronze it holds."""
    import uuid
    from types import SimpleNamespace
    from unittest.mock import AsyncMock, MagicMock

    from src.modules.pipeline.sync.service import SyncService

    found = SimpleNamespace(id=uuid.uuid4(), storage_uri="s3://b/bronze/products/load_id=1/p.parquet", row_count=40)
    hit, miss = MagicMock(), MagicMock()
    hit.scalar_one_or_none.return_value = found
    miss.scalar_one_or_none.return_value = None
    db = AsyncMock()
    db.execute.side_effect = [hit, miss]

    seed = await SyncService._lake_bronze_seed(db, SimpleNamespace(source_asset_id="ds-1"), ["products", "new_table"])

    assert seed == {"products": {"checkpoint": {"stage": "ingest", "outputs": {
        "bronze_object_id": str(found.id), "storage_uri": found.storage_uri, "row_count": 40,
    }}}}  # new_table has no Bronze: it is ingested by the run
