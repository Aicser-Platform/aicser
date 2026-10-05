import os
import uuid

os.environ.setdefault("AISER_EDITION", "enterprise")


class FakeStage:
    def __init__(self, name, rows=0, raises=None):
        self.name = name
        self.rows = rows
        self.raises = raises
        self.calls = 0

    async def execute(self, ctx):
        self.calls += 1
        if self.raises:
            raise self.raises
        from src.modules.pipeline.runner import StageResult

        return StageResult(stage=self.name, rows=self.rows, outputs={"ok": True})


def _ctx():
    from src.modules.pipeline.runner import RunContext

    return RunContext(
        session=None,
        run=type("R", (), {"id": uuid.uuid4(), "checkpoint": {}, "status": "queued"})(),
        pipeline=type("P", (), {"id": uuid.uuid4(), "target_layer": "silver"})(),
        checkpoint={},
        org_id=uuid.uuid4(),
    )


async def test_runner_executes_stages_in_order():
    from src.modules.pipeline.runner import PipelineRunner

    a, b, c = (
        FakeStage("ingest", 10),
        FakeStage("transform", 8),
        FakeStage("load", 8),
    )
    ctx = _ctx()
    status = await PipelineRunner([a, b, c]).run(ctx)

    assert status == "succeeded"
    assert (a.calls, b.calls, c.calls) == (1, 1, 1)
    assert ctx.checkpoint["stage"] == "load"


async def test_runner_records_failure_and_stops():
    from src.modules.pipeline.runner import PipelineRunner

    a = FakeStage("ingest", 10)
    b = FakeStage("transform", raises=ValueError("bad cast"))
    c = FakeStage("load")
    ctx = _ctx()
    status = await PipelineRunner([a, b, c]).run(ctx)

    assert status == "failed"
    assert c.calls == 0
    assert ctx.error_message == "bad cast"
    assert ctx.error_code == "stage_failed"


async def test_runner_resumes_from_checkpoint():
    """A retry must not re-run a stage that already completed."""
    from src.modules.pipeline.runner import PipelineRunner

    a, b, c = FakeStage("ingest"), FakeStage("transform"), FakeStage("load")
    ctx = _ctx()
    ctx.checkpoint = {"stage": "ingest", "outputs": {"bronze_object_id": "x"}}
    await PipelineRunner([a, b, c]).run(ctx)

    assert a.calls == 0, "completed stage must be skipped on resume"
    assert (b.calls, c.calls) == (1, 1)


async def test_runner_honours_cancellation_between_stages():
    from src.modules.pipeline.runner import PipelineRunner

    a, b = FakeStage("ingest"), FakeStage("transform")
    ctx = _ctx()
    ctx.cancel_requested = True
    status = await PipelineRunner([a, b]).run(ctx)

    assert status == "cancelled"
    assert a.calls == 0


async def test_run_pipeline_job_skips_when_already_running():
    """Two concurrent runs of one pipeline must not overlap; the second is skipped, not queued."""
    from unittest.mock import AsyncMock, MagicMock

    from src.modules.pipeline.runner import run_pipeline_job

    session = AsyncMock()

    run = MagicMock()
    run.pipeline_id = uuid.uuid4()
    pipeline = MagicMock()
    pipeline.id = uuid.uuid4()

    run_result = MagicMock()
    run_result.scalar_one_or_none.return_value = run
    pipeline_result = MagicMock()
    pipeline_result.scalar_one_or_none.return_value = pipeline
    lock_result = MagicMock()
    lock_result.scalar.return_value = False
    session.execute = AsyncMock(side_effect=[run_result, pipeline_result, lock_result])

    status = await run_pipeline_job(session, uuid.uuid4())

    assert status == "skipped_already_running"
    assert run.status == "failed"
    assert run.error_code == "already_running"
    await session.commit()


def test_sheet_view_exposes_the_attributes_stage_code_reads():
    """Ingest/Transform/Load stages read everything through
    ctx.pipeline.<attr> -- the shim must expose exactly what they read,
    with options/yaml_artifact_id swapped to the sheet's own."""
    from src.modules.pipeline.runner import _sheet_view

    pipeline = type(
        "P",
        (),
        {
            "id": "pipeline-1",
            "organization_id": "org-1",
            "name": "crm",
            "slug": "crm",
            "source_asset_type": "data_source",
            "source_asset_id": "db_1",
            "target_layer": "silver",
            "ingest_mode": "incremental",
        },
    )()
    sheet = type(
        "S",
        (),
        {
            "source_table": "customers",
            "watermark_column": "updated_at",
            "yaml_artifact_id": "artifact-1",
        },
    )()

    view = _sheet_view(pipeline, sheet)

    assert view.source_asset_id == "db_1"
    assert view.source_asset_type == "data_source"
    assert view.ingest_mode == "incremental"
    assert view.options == {"source_table": "customers", "watermark_column": "updated_at"}
    assert view.yaml_artifact_id == "artifact-1"


async def test_multi_sheet_run_executes_each_sheet_independently_and_survives_one_failure():
    """One saved pipeline with N tables ("sheets") must run every sheet as
    part of the same triggered run -- and one sheet's failure (e.g. a schema
    conflict) must not block the others, since each is an independent table,
    the same way one broken Excel sheet doesn't corrupt the rest of the
    workbook. Reproduces the shape of a real production incident: a
    `customers` sheet succeeding while an `employees` sheet fails must still
    leave the run's checkpoint recording both outcomes separately."""
    from unittest.mock import AsyncMock, MagicMock, patch

    from src.modules.pipeline.runner import StageResult, run_pipeline_job

    session = AsyncMock()

    run = MagicMock()
    run.pipeline_id = uuid.uuid4()
    run.checkpoint = {}
    pipeline = MagicMock()
    pipeline.id = uuid.uuid4()
    pipeline.organization_id = uuid.uuid4()
    pipeline.source_asset_type = "data_source"
    pipeline.source_asset_id = "db_1"
    pipeline.target_layer = "silver"
    pipeline.ingest_mode = "incremental"
    pipeline.slug = "crm"

    sheet_customers = MagicMock(source_table="customers", watermark_column=None, yaml_artifact_id=uuid.uuid4())
    sheet_employees = MagicMock(source_table="employees", watermark_column=None, yaml_artifact_id=uuid.uuid4())

    run_result = MagicMock()
    run_result.scalar_one_or_none.return_value = run
    pipeline_result = MagicMock()
    pipeline_result.scalar_one_or_none.return_value = pipeline
    lock_result = MagicMock()
    lock_result.scalar.return_value = True
    sheets_result = MagicMock()
    sheets_result.scalars.return_value.all.return_value = [sheet_customers, sheet_employees]

    session.execute = AsyncMock(
        side_effect=[run_result, pipeline_result, lock_result, sheets_result]
    )

    class OneStage:
        name = "ingest"

        async def execute(self, ctx):
            if ctx.pipeline.options["source_table"] == "employees":
                raise ValueError("decimal mismatch")
            ctx.rows_read = 80
            ctx.rows_written = 80
            return StageResult(stage=self.name, rows=80, outputs={})

    with patch(
        "src.modules.pipeline.stages.build_stages",
        lambda view: [OneStage()],
    ):
        status = await run_pipeline_job(session, uuid.uuid4())

    assert status == "failed"
    assert run.rows_read == 80
    assert run.rows_written == 80
    assert run.checkpoint["sheets"]["customers"]["status"] == "succeeded"
    assert run.checkpoint["sheets"]["employees"]["status"] == "failed"
    assert "employees" in run.error_message
    assert "customers" not in run.error_message


async def test_multi_sheet_run_resume_skips_already_succeeded_sheets():
    """A retry after a partial failure must not re-run sheets that already
    succeeded -- mirroring the single-pipeline per-stage resume, but keyed
    per sheet."""
    from unittest.mock import AsyncMock, MagicMock, patch

    from src.modules.pipeline.runner import StageResult, run_pipeline_job

    session = AsyncMock()

    run = MagicMock()
    run.pipeline_id = uuid.uuid4()
    run.checkpoint = {
        "sheets": {
            "customers": {
                "status": "succeeded",
                "checkpoint": {},
                "rows_read": 80,
                "rows_written": 80,
            }
        }
    }
    pipeline = MagicMock()
    pipeline.id = uuid.uuid4()
    pipeline.organization_id = uuid.uuid4()
    pipeline.source_asset_type = "data_source"
    pipeline.source_asset_id = "db_1"
    pipeline.target_layer = "silver"
    pipeline.ingest_mode = "incremental"
    pipeline.slug = "crm"

    sheet_customers = MagicMock(source_table="customers", watermark_column=None, yaml_artifact_id=uuid.uuid4())
    sheet_employees = MagicMock(source_table="employees", watermark_column=None, yaml_artifact_id=uuid.uuid4())

    run_result = MagicMock()
    run_result.scalar_one_or_none.return_value = run
    pipeline_result = MagicMock()
    pipeline_result.scalar_one_or_none.return_value = pipeline
    lock_result = MagicMock()
    lock_result.scalar.return_value = True
    sheets_result = MagicMock()
    sheets_result.scalars.return_value.all.return_value = [sheet_customers, sheet_employees]

    session.execute = AsyncMock(
        side_effect=[run_result, pipeline_result, lock_result, sheets_result]
    )

    calls = []

    class TrackingStage:
        name = "ingest"

        async def execute(self, ctx):
            calls.append(ctx.pipeline.options["source_table"])
            ctx.rows_read = 15
            ctx.rows_written = 15
            return StageResult(stage=self.name, rows=15, outputs={})

    with patch(
        "src.modules.pipeline.stages.build_stages",
        lambda view: [TrackingStage()],
    ):
        status = await run_pipeline_job(session, uuid.uuid4())

    assert status == "succeeded"
    assert calls == ["employees"], "already-succeeded customers sheet must not re-run"
    assert run.checkpoint["sheets"]["customers"]["status"] == "succeeded"
    assert run.checkpoint["sheets"]["employees"]["status"] == "succeeded"
    assert run.rows_read == 95
    assert run.rows_written == 95


async def test_runner_stops_after_an_empty_incremental_tick_and_reports_success():
    """IngestStage's no-op result carries no Bronze storage_uri, so running
    Transform/Load after it would raise and mark an empty (but correct) tick as
    failed. The run ends successfully at ingest instead."""
    from src.modules.pipeline.runner import PipelineRunner, StageResult

    class NoOpIngest:
        name = "ingest"

        def __init__(self):
            self.calls = 0

        async def execute(self, ctx):
            self.calls += 1
            return StageResult(
                stage=self.name,
                rows=0,
                outputs={"note": "no_new_rows_since_watermark"},
            )

    ingest = NoOpIngest()
    transform = FakeStage("transform", 8)
    load = FakeStage("load", 8)

    ctx = _ctx()
    status = await PipelineRunner([ingest, transform, load]).run(ctx)

    assert status == "succeeded"
    assert ingest.calls == 1
    assert transform.calls == 0
    assert load.calls == 0
    assert ctx.checkpoint["stage"] == "ingest"
