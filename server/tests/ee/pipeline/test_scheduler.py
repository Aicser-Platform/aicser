import os
import uuid
from datetime import datetime, timezone

os.environ.setdefault("AISER_EDITION", "enterprise")


def test_compute_next_run_at_advances_past_the_reference_time():
    from src.modules.pipeline.scheduler import compute_next_run_at

    after = datetime(2026, 8, 25, 10, 30, tzinfo=timezone.utc)
    nxt = compute_next_run_at("0 * * * *", after)

    assert nxt == datetime(2026, 8, 25, 11, 0, tzinfo=timezone.utc)
    assert nxt > after


def test_compute_next_run_at_rejects_a_bad_expression():
    import pytest

    from src.modules.pipeline.scheduler import compute_next_run_at

    with pytest.raises(ValueError, match="invalid cron"):
        compute_next_run_at("not a cron", datetime.now(timezone.utc))


async def test_dispatch_enqueues_due_pipelines_and_advances_next_run_at():
    from unittest.mock import AsyncMock, MagicMock, patch

    from src.modules.pipeline.scheduler import dispatch_due_pipelines

    now = datetime(2026, 8, 25, 10, 30, tzinfo=timezone.utc)
    pipeline = MagicMock()
    pipeline.id = uuid.uuid4()
    pipeline.organization_id = uuid.uuid4()
    pipeline.source_asset_type = "data_source"
    pipeline.schedule_cron = "0 * * * *"
    pipeline.next_run_at = datetime(2026, 8, 25, 10, 0, tzinfo=timezone.utc)
    pipeline.ingest_mode = "snapshot"
    pipeline.target_layer = "silver"

    result = MagicMock()
    result.scalars.return_value.all.return_value = [pipeline]
    session = AsyncMock()
    session.add = MagicMock()
    session.execute = AsyncMock(return_value=result)

    with patch(
        "src.modules.pipeline.scheduler.enqueue_job",
        new=AsyncMock(return_value="job-1"),
    ) as eq:
        run_ids = await dispatch_due_pipelines(session, now)

    assert len(run_ids) == 1
    eq.assert_awaited_once()
    assert eq.await_args.args[0] == "run_pipeline"
    assert pipeline.next_run_at == datetime(2026, 8, 25, 11, 0, tzinfo=timezone.utc)
