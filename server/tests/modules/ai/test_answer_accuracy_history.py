"""Answer-accuracy runs: nightly runs are opt-in (they spend AI credits); manual runs always go."""

import pytest

from src.shared.jobs import tasks


@pytest.mark.asyncio
async def test_nightly_run_is_skipped_unless_opted_in(monkeypatch):
    monkeypatch.delenv("AISER_NIGHTLY_EVAL", raising=False)
    out = await tasks.run_answer_accuracy_eval({}, trigger="nightly")
    assert "skipped" in out


@pytest.mark.asyncio
async def test_manual_and_opted_in_runs_execute(monkeypatch):
    from ee.modules.ai.evals import history

    calls = []

    async def fake_run_and_store(trigger, locale=None, limit=None):
        calls.append(trigger)
        return {"status": "completed", "trigger": trigger}

    monkeypatch.setattr(history, "run_and_store", fake_run_and_store)
    assert (await tasks.run_answer_accuracy_eval({}, trigger="manual"))["status"] == "completed"
    monkeypatch.setenv("AISER_NIGHTLY_EVAL", "on")
    assert (await tasks.run_answer_accuracy_eval({}, trigger="nightly"))["status"] == "completed"
    assert calls == ["manual", "nightly"]
