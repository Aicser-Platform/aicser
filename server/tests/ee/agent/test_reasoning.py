"""Agent reasoning: where the stronger model is used, recovery, unfinished plans, next steps, lessons."""

import json

import pytest

from ee.modules.agent import reasoning as R


def test_strong_model_where_depth_matters():
    assert R.turn_tier("adaptive", first_turn=True, recovering=False) == "strong"
    assert R.turn_tier("adaptive", first_turn=False, recovering=True) == "strong"
    assert R.turn_tier("adaptive", first_turn=False, recovering=False) is None
    assert R.turn_tier("always", first_turn=False, recovering=False) == "strong"
    assert R.turn_tier("economy", first_turn=True, recovering=True) is None


def test_failed_step_is_noticed_only_in_the_latest_results():
    failed = [{"role": "assistant", "content": ""}, {"role": "tool", "content": json.dumps({"error": "no column x"})}]
    assert R.last_step_failed(failed)
    later = failed + [{"role": "assistant", "content": "retrying"}, {"role": "tool", "content": json.dumps({"rows": []})}]
    assert not R.last_step_failed(later)


def test_unfinished_plan_parts():
    plan = [{"label": "Load", "status": "done"}, {"label": "Compare", "status": "active"}, {"label": "Chart", "status": "pending"}]
    assert R.unfinished_parts(plan) == ["Compare", "Chart"]
    assert "Compare; Chart" in R.unfinished_note(R.unfinished_parts(plan))
    # A plan nobody ticked off says nothing about what was skipped.
    assert R.unfinished_parts([{"label": "Load", "status": "pending"}, {"label": "Chart", "status": "active"}]) == []


class FakeLLM:
    def __init__(self, reply):
        self.reply, self.calls = reply, []

    async def generate_completion(self, **kw):
        self.calls.append(kw)
        return {"success": True, "content": self.reply}


@pytest.mark.asyncio
async def test_follow_ups_come_from_the_model_and_are_trimmed():
    llm = FakeLLM(json.dumps({"follow_ups": [
        {"label": "Watch overdue loans", "goal": "Profile overdue loans by week, then alert when unusual"},
        {"label": "", "goal": "missing label is dropped"},
        {"label": "Share", "goal": "Email the summary to the risk team"},
        {"label": "Fourth", "goal": "x"}, {"label": "Fifth", "goal": "y"}]}))
    out = await R.follow_ups(llm, "Why did NPL rise?", "NPL rose 2.1 points, mostly branch 4 and 7. " * 3, [], ["create_alert"], None)
    assert [f["label"] for f in out] == ["Watch overdue loans", "Share", "Fourth"]
    assert "threshold" in llm.calls[0]["system_context"]


@pytest.mark.asyncio
async def test_no_lessons_without_anything_taught():
    llm = FakeLLM(json.dumps({"lessons": [{"content": "x", "kind": "fact", "scope": "user"}]}))
    assert await R.lessons(llm, "goal", ["only the request"], "answer", [], None) == []
    assert llm.calls == []


@pytest.mark.asyncio
async def test_lessons_are_read_leniently():
    llm = FakeLLM('Here you go: {"lessons": [{"content": "Revenue excludes refunds.", "kind": "fact", "scope": "project"},'
                  ' {"content": "", "kind": "fact"}, {"content": "Weeks start Monday", "kind": "odd", "scope": "galaxy"}]}')
    out = await R.lessons(llm, "Revenue by month", ["Revenue by month", "No, revenue excludes refunds"], "…", [], None)
    assert out == [{"content": "Revenue excludes refunds.", "kind": "fact", "scope": "project"},
                   {"content": "Weeks start Monday", "kind": "fact", "scope": "user"}]
