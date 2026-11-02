"""Noticing repeats, confirming changes, continuing long plans, and read-only sub-tasks."""

import pytest

from src.core.tool_registry import verify_by_preview
from src.modules.agent import delegate, guards
from src.modules.agent.loop import _plan_unfinished
from src.shared import office_docs as od

BODY = "x" * 300


def test_same_call_counts_and_a_different_one_starts_over():
    g = guards.ProgressGuard()
    assert g.see("a", {"q": 1}) == 1 and g.see("a", {"q": 1}) == 2
    assert g.see("a", {"q": 2}) == 1
    assert g.see("b", {"q": 2}) == 1


def test_same_body_with_a_reworded_note_is_the_same_work():
    """The real failure: six saves of one document, differing only in the note."""
    g = guards.ProgressGuard()
    assert g.see("write_document", {"content": BODY, "note": "one"}) == 1
    assert g.see("write_document", {"content": BODY, "note": "two"}) == 2


def test_short_different_arguments_are_real_progress():
    g = guards.ProgressGuard()
    for i in range(6):
        assert g.see("run_query", {"sql": f"select {i}"}) == 1


def test_a_fifth_identical_call_is_blocked():
    g = guards.ProgressGuard()
    for _ in range(4):
        assert not g.blocks("t", {"a": 1})
        g.see("t", {"a": 1})
    assert g.blocks("t", {"a": 1}) and not g.blocks("t", {"a": 2})


@pytest.mark.asyncio
async def test_preview_reports_what_did_not_land():
    async def landed(caller, args):
        return {"changes": [{"field": "title", "before": "New", "after": "New"}]}

    async def failed(caller, args):
        return {"changes": [{"field": "title", "before": "Old", "after": "New"}]}

    assert await verify_by_preview(landed)(None, {}, {}) is None
    assert "title" in await verify_by_preview(failed)(None, {}, {})


def test_tracked_edits_are_confirmed_in_the_saved_file():
    docx = pytest.importorskip("docx")
    import io

    d = docx.Document()
    d.add_paragraph("Inspected every 90 days.")
    out = io.BytesIO()
    d.save(out)
    res = od.edit_docx(out.getvalue(), [{"find": "90", "replace": "60"}])
    assert od.confirm_edits(res["data"], "docx", res["changes"]) == []
    assert od.confirm_edits(out.getvalue(), "docx", res["changes"]) == ["60"]
    assert "60" in od.outline(res["data"], "docx")["paragraphs"][0]["text"]


def test_only_open_plans_continue():
    class Run:
        plan = [{"status": "done"}, {"status": "pending"}]

    assert _plan_unfinished(Run)
    Run.plan = [{"status": "done"}]
    assert not _plan_unfinished(Run)


@pytest.mark.asyncio
async def test_parallel_needs_two_parts_and_caps_at_four(monkeypatch):
    assert "error" in await delegate.run_subtasks(None, [{"goal": "one"}], None)
    seen = []

    async def one(run, goal, llm):
        seen.append(goal)
        return {"goal": goal, "status": "completed"}

    monkeypatch.setattr(delegate, "_one", one)
    res = await delegate.run_subtasks(None, [{"goal": str(i)} for i in range(6)], None)
    assert len(res["results"]) == delegate.MAX_SUBTASKS == len(seen)


@pytest.mark.asyncio
async def test_one_failed_part_does_not_lose_the_others(monkeypatch):
    async def one(run, goal, llm):
        if goal == "bad":
            raise RuntimeError("boom")
        return {"goal": goal, "status": "completed"}

    monkeypatch.setattr(delegate, "_one", one)
    res = await delegate.run_subtasks(None, [{"goal": "good"}, {"goal": "bad"}], None)
    assert [r["status"] for r in res["results"]] == ["completed", "failed"]
