import uuid
from types import SimpleNamespace

import pytest

from src.modules.pipeline.quality import record_quality, run_quality_checks


class FakeSession:
    def __init__(self, previous):
        self.previous = previous

    async def execute(self, _query):
        prev = self.previous
        return SimpleNamespace(first=lambda: (prev,) if prev is not None else None)


def run(status="succeeded", rows=100):
    return SimpleNamespace(id=uuid.uuid4(), status=status, rows_written=rows, checkpoint={})


PIPELINE = SimpleNamespace(id=uuid.uuid4())


@pytest.mark.asyncio
async def test_flags_a_big_drop_in_rows():
    checks = await run_quality_checks(FakeSession(1000), run(rows=300), PIPELINE)
    assert checks == [{"code": "volume_drop", "previous": 1000, "current": 300}]


@pytest.mark.asyncio
async def test_flags_an_empty_run_after_a_full_one():
    assert (await run_quality_checks(FakeSession(50), run(rows=0), PIPELINE))[0]["code"] == "no_rows"


@pytest.mark.asyncio
async def test_normal_runs_and_first_runs_pass():
    assert await run_quality_checks(FakeSession(1000), run(rows=900), PIPELINE) == []
    assert await run_quality_checks(FakeSession(None), run(rows=5), PIPELINE) == []
    assert await run_quality_checks(FakeSession(1000), run(status="failed", rows=0), PIPELINE) == []


@pytest.mark.asyncio
async def test_record_keeps_existing_checkpoint():
    r = run(rows=10)
    r.checkpoint = {"sheets": {}}
    await record_quality(FakeSession(100), r, PIPELINE)
    assert r.checkpoint["sheets"] == {} and r.checkpoint["quality"]["checks"][0]["code"] == "volume_drop"
