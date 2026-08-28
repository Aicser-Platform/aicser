import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import uuid


async def test_profile_job_reports_the_resulting_status(monkeypatch):
    from src.shared.jobs import tasks

    session_id = str(uuid.uuid4())
    seen = {}

    class FakeSession:
        async def __aenter__(self):
            return "db"

        async def __aexit__(self, *_):
            return False

    async def fake_run_profile(db, sid):
        seen["db"], seen["sid"] = db, sid
        return "review"

    monkeypatch.setattr("src.db.session.async_session", lambda: FakeSession())
    monkeypatch.setattr(
        "src.modules.pipeline.onboarding.service.run_profile", fake_run_profile
    )

    result = await tasks.profile_staged_asset({}, session_id)

    assert result == {"success": True, "status": "review", "session_id": session_id}
    assert str(seen["sid"]) == session_id


async def test_ingest_job_reports_failure_without_raising(monkeypatch):
    from src.shared.jobs import tasks

    class FakeSession:
        async def __aenter__(self):
            return "db"

        async def __aexit__(self, *_):
            return False

    async def boom(db, sid):
        raise RuntimeError("disk on fire")

    monkeypatch.setattr("src.db.session.async_session", lambda: FakeSession())
    monkeypatch.setattr("src.modules.pipeline.onboarding.service.run_ingest", boom)

    result = await tasks.ingest_staged_asset({}, str(uuid.uuid4()))

    assert result["success"] is False
    assert "disk on fire" in result["error"]


def test_both_jobs_are_registered_with_the_worker():
    from src.shared.jobs import worker

    names = {getattr(fn, "name", getattr(fn, "__name__", "")) for fn in worker._ARQ_FUNCTIONS}

    assert "profile_staged_asset" in names
    assert "ingest_staged_asset" in names


def test_the_long_running_jobs_do_not_use_the_short_global_timeout():
    from src.shared.jobs import worker

    by_name = {getattr(fn, "name", None): fn for fn in worker._ARQ_FUNCTIONS}

    assert by_name["ingest_staged_asset"].timeout_s == worker.PIPELINE_JOB_TIMEOUT
    assert by_name["profile_staged_asset"].timeout_s == worker.PIPELINE_JOB_TIMEOUT
