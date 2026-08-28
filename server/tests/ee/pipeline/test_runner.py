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
