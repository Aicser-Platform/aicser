"""Aicser Agent Phase 3: saved skills, org agents, schedules, and the compliance pack."""

from __future__ import annotations

import types
import uuid
from datetime import datetime, timedelta, timezone

import pytest

from src.modules.agent import org_agents as OA
from src.modules.agent import policy as P
from src.modules.agent import schedules as SC
from src.modules.agent import skills as SK
from src.modules.agent.compliance import _run_record


def _skill(**kw):
    base = dict(id=uuid.uuid4(), name="Weekly pack", version=2, tools=["run_query"], instructions="Revenue for {region} in {month}",
                inputs=[{"name": "region", "label": "Region", "required": True, "default": None},
                        {"name": "month", "label": "Month", "required": False, "default": "last month"}])
    base.update(kw)
    return types.SimpleNamespace(**base)


# ── Skills ───────────────────────────────────────────────────────────────────


def test_undeclared_placeholders_become_inputs():
    inputs = SK.clean_inputs([{"name": "region", "label": "Region"}], "Sales for {region} by {channel}")
    assert [i["name"] for i in inputs] == ["region", "channel"]
    assert inputs[1]["label"] == "Channel" and inputs[1]["required"] is True


def test_bad_input_names_are_dropped_and_count_is_capped():
    assert SK.clean_inputs([{"name": "a b"}, {"name": "ok"}], "x") == [
        {"name": "ok", "label": "ok", "required": True, "default": None}]
    with pytest.raises(SK.SkillError):
        SK.clean_inputs([], " ".join("{p%d}" % i for i in range(SK.MAX_INPUTS + 1)))


def test_render_fills_inputs_and_defaults():
    assert SK.render(_skill(), {"region": "EMEA"}) == "Revenue for EMEA in last month"
    assert SK.render(_skill(), {"region": "EMEA", "month": "May"}) == "Revenue for EMEA in May"


def test_render_requires_required_inputs():
    with pytest.raises(SK.SkillError, match="Region"):
        SK.render(_skill(), {})


def test_snapshot_keeps_name_version_and_tools():
    skill = _skill()
    assert SK.snapshot(skill) == {"id": str(skill.id), "name": "Weekly pack", "version": 2, "tools": ["run_query"]}


def test_skill_validation():
    with pytest.raises(SK.SkillError):
        SK._validated({"name": "", "instructions": "x"})
    with pytest.raises(SK.SkillError):
        SK._validated({"name": "a", "instructions": "x", "scope": "public"})
    with pytest.raises(SK.SkillError):
        SK._validated({"name": "a", "instructions": "x", "pack": "astrology"})
    ok = SK._validated({"name": "a", "instructions": "x {y}", "pack": "finance", "tools": ["b", "a", "a"]})
    assert ok["tools"] == ["a", "b"] and ok["inputs"][0]["name"] == "y"


# ── Schedules ────────────────────────────────────────────────────────────────


def test_schedule_time_validation():
    assert SC._when({"frequency": "weekly", "hour": 9, "minute": 30, "weekday": 4, "timezone": "Asia/Phnom_Penh"})["weekday"] == 4
    for bad in ({"frequency": "yearly"}, {"hour": 24}, {"timezone": "Mars/Base"}, {"notify": "sometimes"}):
        with pytest.raises(SC.ScheduleError):
            SC._when(bad)


@pytest.mark.asyncio
async def test_schedule_runs_skill_with_inputs_as_owner(monkeypatch):
    skill = _skill()

    async def visible(*a, **k):
        return skill

    monkeypatch.setattr(SK, "get_visible", visible)
    sched = types.SimpleNamespace(id=uuid.uuid4(), name="Monday pack", owner_id="u1", organization_id="o1", project_id=None,
                                  skill_id=skill.id, goal=None, inputs={"region": "APAC"}, org_agent_id=None, notify="failure")
    goal, ctx = await SC._goal_and_context(sched)
    assert goal == "Revenue for APAC in last month"
    assert ctx["skill"]["version"] == 2 and ctx["notify"] == "failure" and ctx["schedule_name"] == "Monday pack"


@pytest.mark.asyncio
async def test_schedule_with_deleted_skill_or_paused_agent_is_skipped(monkeypatch):
    async def gone(*a, **k):
        return None

    monkeypatch.setattr(SK, "get_visible", gone)
    sched = types.SimpleNamespace(id=uuid.uuid4(), name="x", owner_id="u1", organization_id="o1", project_id=None,
                                  skill_id=uuid.uuid4(), goal=None, inputs={}, org_agent_id=None, notify="always")
    with pytest.raises(SC.ScheduleError, match="deleted"):
        await SC._goal_and_context(sched)

    agent = types.SimpleNamespace(id=uuid.uuid4(), status="paused", paused_reason="Owner left the organization.",
                                  monthly_credit_cap=0, name="A", instructions=None, max_tier=2)

    async def get_agent(*a, **k):
        return agent

    monkeypatch.setattr(OA, "get_agent", get_agent)
    sched2 = types.SimpleNamespace(id=uuid.uuid4(), name="x", owner_id="u1", organization_id="o1", project_id=None,
                                   skill_id=None, goal="Close the books", inputs={}, org_agent_id=agent.id, notify="always")
    with pytest.raises(SC.ScheduleError, match="Owner left"):
        await SC._goal_and_context(sched2)


# ── Org agents ───────────────────────────────────────────────────────────────


def test_org_agent_tier_never_reaches_irreversible():
    assert OA._validated({"name": "A", "max_tier": 4})["max_tier"] == 3
    with pytest.raises(OA.OrgAgentError):
        OA._validated({"name": " "})


@pytest.mark.asyncio
async def test_credit_cap_stops_new_runs(monkeypatch):
    agent = types.SimpleNamespace(id=uuid.uuid4(), status="active", paused_reason=None, monthly_credit_cap=500)

    async def used(_id):
        return 500.0

    monkeypatch.setattr(OA, "credits_this_month", used)
    assert "500 credits" in await OA.check_runnable(agent)
    agent.monthly_credit_cap = 0
    assert await OA.check_runnable(agent) is None


@pytest.mark.asyncio
async def test_run_context_carries_identity_and_limit():
    agent = types.SimpleNamespace(id=uuid.uuid4(), name="Finance close", instructions="EUR", max_tier=1)
    ctx = await OA.run_context(agent)
    assert ctx == {"org_agent_id": str(agent.id), "org_agent_name": "Finance close", "agent_instructions": "EUR", "max_tier": 1}


# ── Compliance pack ──────────────────────────────────────────────────────────


def test_retention_is_at_least_a_month_or_off():
    assert P._clean({"retention_days": 7})["retention_days"] == 30
    assert P._clean({"retention_days": 0})["retention_days"] == 0
    assert P._clean({"retention_days": 400})["retention_days"] == 400
    assert P._clean({"retention_days": "x"})["retention_days"] == 0


def test_audit_record_has_identity_tools_and_hashes():
    now = datetime.now(timezone.utc)
    run = types.SimpleNamespace(id=uuid.uuid4(), organization_id=uuid.uuid4(), user_id=uuid.uuid4(), project_id=None,
                                goal="g", status="completed", trigger="schedule", unattended=True, agent_version="2",
                                context={"skill": {"id": "s"}, "org_agent_id": "a", "schedule_id": "sc"}, usage={"credits": 3},
                                error=None, untrusted_seen=False, feedback=None, created_at=now, started_at=now,
                                finished_at=now + timedelta(seconds=5))
    step = types.SimpleNamespace(seq=1, kind="tool", tool_name="send_email", tier=3, status="ok", args_hash="ab12",
                                 args={"to": "[redacted]"}, approval={"decision": "allow", "by": "u"}, summary="sent",
                                 error=None, model=None, tokens_in=None, tokens_out=None, latency_ms=40, created_at=now)
    rec = _run_record(run, [step])
    assert rec["org_agent_id"] == "a" and rec["schedule_id"] == "sc" and rec["unattended"] is True
    assert rec["steps"][0]["args_sha256"] == "ab12" and rec["steps"][0]["approval"]["decision"] == "allow"
