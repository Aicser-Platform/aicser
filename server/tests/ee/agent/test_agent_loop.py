"""Aicser Agent loop: the model drives tools; tiers decide approval; every step is saved so a
paused or interrupted task resumes exactly where it stopped."""

from __future__ import annotations

import itertools
import types
import uuid
from datetime import datetime, timezone

import pytest

from src.core.tool_registry import ToolSpec, ToolTier
from src.modules.agent import loop as L
from src.modules.agent import workspace as W



@pytest.fixture(autouse=True)
def _no_style_lookups(monkeypatch):
    """These tests have no database; how the AI sounds is covered in test_answer_style.py."""
    from unittest.mock import AsyncMock

    monkeypatch.setattr("ee.modules.agent.loop._reader_role", AsyncMock(return_value=""))
    monkeypatch.setattr("ee.modules.ai.services.answer_style.tone_line", AsyncMock(return_value=""))


class Store:
    def __init__(self):
        self.runs, self.steps, self.arts = {}, {}, {}

    def new_run(self, goal="do it", **kw):
        rid = str(uuid.uuid4())
        self.runs[rid] = types.SimpleNamespace(
            id=rid, user_id="u1", organization_id="o1", project_id=None, goal=goal, status="running",
            messages=[{"role": "user", "content": goal}], pending=None, plan=[], usage={}, context={},
            approved_tools=[], untrusted_seen=False, unattended=False, result=None, error=None,
            started_at=datetime.now(timezone.utc), finished_at=None, **kw,
        )
        self.steps[rid], self.arts[rid] = [], []
        return rid


@pytest.fixture()
def store(monkeypatch):
    s = Store()

    async def get_run(rid):
        return s.runs.get(str(rid))

    async def update_run(rid, **f):
        for k, v in f.items():
            setattr(s.runs[str(rid)], k, v)

    async def finish_run(rid, *, status, result=None, error=None, usage=None):
        await update_run(rid, status=status, **({"result": result} if result is not None else {}),
                         **({"error": error} if error else {}), **({"usage": usage} if usage is not None else {}))

    async def add_step(rid, *, kind, **f):
        s.steps[str(rid)].append({"kind": kind, **f})
        return len(s.steps[str(rid)])

    async def put_artifact(rid, *, result, tool_name, title=None, preview=None):
        h = f"result://{len(s.arts[str(rid)]) + 1}"
        s.arts[str(rid)].append(types.SimpleNamespace(handle=h, payload=result, kind="table", title=tool_name))
        return h

    async def get_artifact(rid, h):
        return next((a for a in s.arts[str(rid)] if a.handle == h), None)

    async def list_artifacts(rid):
        return s.arts[str(rid)]

    s.inbox, s.outputs = {}, {}

    async def take_inbox(rid):
        return s.inbox.pop(str(rid), [])

    async def has_inbox(rid):
        return bool(s.inbox.get(str(rid)))

    async def add_output(rid, output):
        s.outputs.setdefault(str(rid), []).append(output)

    for name, fn in dict(get_run=get_run, update_run=update_run, finish_run=finish_run, add_step=add_step,
                         put_artifact=put_artifact, get_artifact=get_artifact, list_artifacts=list_artifacts,
                         take_inbox=take_inbox, has_inbox=has_inbox, add_output=add_output).items():
        monkeypatch.setattr(W, name, fn)

    async def nothing(*a, **k):
        return ""

    async def none_list(*a, **k):
        return []

    monkeypatch.setattr(L.M, "instructions_for", nothing)
    monkeypatch.setattr(L.M, "recall", none_list)

    async def ok(*a, **k):
        return True, ""

    monkeypatch.setattr(L, "_charge", ok)
    monkeypatch.setattr(L, "_has_credits", ok)
    import src.modules.agent.notify as N

    async def quiet(*a, **k):
        return None

    monkeypatch.setattr(N, "notify_waiting", quiet)
    monkeypatch.setattr(N, "notify_finished", quiet)
    return s


calls = []


async def _query(caller, args):
    calls.append(("query", args))
    return {"columns": ["region", "revenue"], "rows": [{"region": f"r{i}", "revenue": i} for i in range(30)], "row_count": 30}


async def _email(caller, args):
    calls.append(("email", args))
    return {"sent": True, "to": args.get("to")}


async def _export(caller, args):
    calls.append(("export", args))
    return {"filename": "pack.xlsx", "rows_seen": len((args.get("data") or {}).get("rows") or [])}


async def _delete(caller, args):
    calls.append(("delete", args))
    return {"deleted": True}


SPECS = {
    "run_query": ToolSpec("run_query", "q", {"type": "object"}, _query, ToolTier.READ),
    "export_document": ToolSpec("export_document", "x", {"type": "object"}, _export, ToolTier.WORKSPACE),
    "send_email": ToolSpec("send_email", "e", {"type": "object"}, _email, ToolTier.EXTERNAL),
    "save_chart": ToolSpec("save_chart", "c", {"type": "object"}, _email, ToolTier.INTERNAL),
    "delete_table": ToolSpec("delete_table", "d", {"type": "object"}, _delete, ToolTier.IRREVERSIBLE),
}


@pytest.fixture(autouse=True)
def _tools(monkeypatch):
    calls.clear()

    async def available(caller, policy=None):
        return SPECS, [s.to_function_schema() for s in SPECS.values()]

    async def policy(caller):
        return {"pre_approved": set(), "max_tier": 4, "device": {}}

    monkeypatch.setattr(L, "available_tools", available)
    monkeypatch.setattr(L, "run_policy", policy)


class LLM:
    """Replies from a script; each item is (content, [(tool, args), ...])."""

    def __init__(self, script):
        self.script = list(script)
        self.seen = []
        self.ids = itertools.count(1)

    async def hydrate_user_byok_models(self, *a, **k):
        return None

    async def generate_completion_with_tools(self, **kw):
        self.seen.append([dict(m) for m in kw.get("messages") or []])
        content, tcs = self.script.pop(0)
        return {"success": True, "content": content, "model": "fake",
                "usage": {"prompt_tokens": 100, "completion_tokens": 20},
                "tool_calls": [{"id": f"c{next(self.ids)}", "name": n, "arguments": a} for n, a in tcs]}

    async def generate_completion(self, **kw):
        return {"success": True, "content": "Summary of the work so far."}


def _ctx(monkeypatch):
    import ee.modules.ai.observability.request_context as rc

    monkeypatch.setattr(rc, "start_ai_request_context", lambda **k: None)
    monkeypatch.setattr(rc, "clear_ai_request_context", lambda t: None)


@pytest.mark.asyncio
async def test_read_tools_run_and_large_results_travel_by_handle(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    llm = LLM([
        ("", [("update_plan", {"items": [{"label": "Query", "status": "active"}, {"label": "Export", "status": "pending"}]})]),
        ("", [("run_query", {"sql": "select 1"})]),
        ("", [("export_document", {"format": "xlsx", "title": "Pack", "data": "result://1"})]),
        ("Done: exported pack.xlsx with 30 regions.", []),
    ])
    assert await L.run_agent(rid, llm) == "completed"
    run = store.runs[rid]
    assert run.result["answer"].startswith("Done")
    assert [c[0] for c in calls] == ["query", "export"]
    assert calls[1][1]["data"]["row_count"] == 30  # the handle arrived resolved to the stored rows
    tool_msg = next(m for m in llm.seen[2] if m.get("role") == "tool" and "result://1" in m["content"])
    assert tool_msg
    assert [p["label"] for p in run.plan] == ["Query", "Export"] and all(p["status"] == "done" for p in run.plan)


@pytest.mark.asyncio
async def test_outside_effect_waits_for_approval_then_runs(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    llm = LLM([
        ("", [("send_email", {"to": ["cfo@x.com"], "subject": "Pack", "body": "Attached"})]),
        ("Emailed the CFO.", []),
    ])
    assert await L.run_agent(rid, llm) == "waiting_approval"
    run = store.runs[rid]
    assert run.pending["type"] == "approval" and run.pending["tool_call"]["name"] == "send_email"
    assert calls == []
    decided = {"type": "approval", "call_id": run.pending["call_id"], "decision": "allow", "by": "u1"}
    assert await L.run_agent(rid, llm, decided=decided) == "completed"
    assert calls[0][0] == "email"
    # The model saw the email result before writing its answer.
    assert any(m.get("role") == "tool" and '"sent": true' in m["content"] for m in llm.seen[-1])


@pytest.mark.asyncio
async def test_declined_action_is_reported_to_the_model_and_not_run(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    llm = LLM([("", [("send_email", {"to": ["a@b.c"], "subject": "s", "body": "b"})]), ("I did not send it.", [])])
    await L.run_agent(rid, llm)
    pending = store.runs[rid].pending
    await L.run_agent(rid, llm, decided={"type": "approval", "call_id": pending["call_id"], "decision": "deny"})
    assert calls == [] and store.runs[rid].status == "completed"
    assert any("declined" in m["content"] for m in llm.seen[-1] if m.get("role") == "tool")


@pytest.mark.asyncio
async def test_ask_once_is_remembered_for_the_rest_of_the_task(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    llm = LLM([
        ("", [("save_chart", {"title": "a"})]),
        ("", [("save_chart", {"title": "b"})]),
        ("Saved two charts.", []),
    ])
    await L.run_agent(rid, llm)
    pending = store.runs[rid].pending
    status = await L.run_agent(rid, llm, decided={"type": "approval", "call_id": pending["call_id"],
                                                  "decision": "allow", "remember": True})
    assert status == "completed" and len(calls) == 2


@pytest.mark.asyncio
async def test_irreversible_actions_are_handed_back(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    llm = LLM([("", [("delete_table", {"name": "orders"})]), ("Please delete it yourself in Data.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    assert calls == []
    assert any(s.get("approval", {}).get("policy") == "hand_back" for s in store.steps[rid] if s.get("approval"))


@pytest.mark.asyncio
async def test_question_pauses_and_the_answer_reaches_the_model(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    llm = LLM([("", [("ask_user", {"question": "Which quarter?", "options": ["Q3", "Q4"]})]), ("Using Q3.", [])])
    assert await L.run_agent(rid, llm) == "waiting_approval"
    pending = store.runs[rid].pending
    assert pending["type"] == "question" and pending["options"] == ["Q3", "Q4"]
    await L.run_agent(rid, llm, decided={"type": "question", "call_id": pending["call_id"], "answer": "Q3"})
    assert any(m.get("role") == "tool" and "Q3" in m["content"] for m in llm.seen[-1])


@pytest.mark.asyncio
async def test_resume_after_crash_finishes_unanswered_tool_calls_first(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    store.runs[rid].messages.append({"role": "assistant", "content": None, "tool_calls": [
        {"id": "c9", "type": "function", "function": {"name": "run_query", "arguments": "{\"sql\": \"select 1\"}"}}]})
    llm = LLM([("Found 30 regions.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    assert calls and calls[0][0] == "query"
    assert any(m.get("role") == "tool" and m.get("tool_call_id") == "c9" for m in llm.seen[0])


@pytest.mark.asyncio
async def test_pending_approval_without_a_decision_keeps_waiting(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    store.runs[rid].pending = {"type": "approval", "call_id": "c1", "queue": []}
    assert await L.run_agent(rid, LLM([])) == "waiting_approval"


@pytest.mark.asyncio
async def test_turn_limit_ends_with_an_honest_summary(store, monkeypatch):
    _ctx(monkeypatch)
    monkeypatch.setattr(L, "MAX_TURNS", 2)
    rid = store.new_run()
    llm = LLM([("", [("run_query", {"sql": "a"})]), ("", [("run_query", {"sql": "b"})])])
    assert await L.run_agent(rid, llm) == "completed"
    assert "limit" in store.runs[rid].result["answer"]


@pytest.mark.asyncio
async def test_untrusted_output_forces_approval_even_when_pre_approved(store, monkeypatch):
    from src.core.tool_registry import ASK_EVERY_TIME, approval_for

    spec = SPECS["send_email"]
    assert approval_for(spec, pre_approved=["send_email"], untrusted_content_seen=True) == ASK_EVERY_TIME


class RecordingLLM(LLM):
    """Also records the tools and system prompt each model turn was offered."""

    def __init__(self, script):
        super().__init__(script)
        self.tools, self.systems = [], []

    async def generate_completion_with_tools(self, **kw):
        self.tools.append({t["function"]["name"] for t in kw.get("tools") or []})
        self.systems.append(kw.get("system_context") or "")
        return await super().generate_completion_with_tools(**kw)


@pytest.mark.asyncio
async def test_skill_run_is_limited_to_its_tools_and_named_in_the_prompt(store, monkeypatch):
    _ctx(monkeypatch)
    from src.modules.agent.tools import RUNTIME_TOOLS

    async def available(caller, policy=None):  # as the real list: registry tools plus runtime tools
        return SPECS, [s.to_function_schema() for s in SPECS.values()] + RUNTIME_TOOLS

    monkeypatch.setattr(L, "available_tools", available)
    rid = store.new_run()
    store.runs[rid].context = {"skill": {"id": "s1", "name": "Weekly pack", "version": 3, "tools": ["run_query"]}}
    llm = RecordingLLM([("Done: 30 regions.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    offered = llm.tools[0]
    assert "run_query" in offered and "send_email" not in offered and "export_document" not in offered
    assert "update_plan" in offered  # runtime tools stay
    assert 'saved skill "Weekly pack" (version 3)' in llm.systems[0]


@pytest.mark.asyncio
async def test_org_agent_tier_limit_and_unattended_schedule_prompt(store, monkeypatch):
    _ctx(monkeypatch)
    seen_policy = {}

    async def available(caller, policy=None):
        seen_policy.update(policy or {})
        return SPECS, [s.to_function_schema() for s in SPECS.values()]

    monkeypatch.setattr(L, "available_tools", available)
    rid = store.new_run()
    store.runs[rid].context = {"org_agent_id": "a1", "org_agent_name": "Finance close", "max_tier": 1,
                               "agent_instructions": "Use the GL in EUR.", "schedule_id": "sc1"}
    llm = RecordingLLM([("Done.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    assert seen_policy["max_tier"] == 1
    system = llm.systems[0]
    assert 'organization\'s agent "Finance close"' in system and "Use the GL in EUR." in system
    assert "started by a schedule" in system


def test_compaction_keeps_schema_word_for_word():
    schema = '{"tables": [{"name": "payments", "columns": [{"name": "value_date"}]}]}'
    msgs = [
        {"role": "assistant", "content": None, "tool_calls": [
            {"id": "a", "type": "function", "function": {"name": "describe_data_source", "arguments": "{}"}},
            {"id": "b", "type": "function", "function": {"name": "run_query", "arguments": "{}"}}]},
        {"role": "tool", "tool_call_id": "a", "content": schema},
        {"role": "tool", "tool_call_id": "b", "content": '{"rows": []}'},
    ]
    kept = L._pinned_results(msgs)
    assert "value_date" in kept and "run_query" not in kept


@pytest.mark.asyncio
async def test_dates_in_results_are_stored_as_text(monkeypatch):
    from datetime import date
    from decimal import Decimal

    assert W.jsonable({"rows": [{"d": date(2024, 1, 4), "x": Decimal("1.5")}]}) == {"rows": [{"d": "2024-01-04", "x": "1.5"}]}


@pytest.mark.asyncio
async def test_tool_that_reports_failure_is_an_error_the_model_reads(store, monkeypatch):
    _ctx(monkeypatch)

    async def failing_save(caller, args):
        return {"success": False, "error": "chart_type is required"}

    specs = {**SPECS, "save_chart": ToolSpec("save_chart", "c", {"type": "object"}, failing_save, ToolTier.WORKSPACE)}

    async def available(caller, policy=None):
        return specs, [s.to_function_schema() for s in specs.values()]

    monkeypatch.setattr(L, "available_tools", available)
    rid = store.new_run()
    llm = LLM([("", [("save_chart", {})]), ("Could not save the chart: chart_type is required.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    step = next(s for s in store.steps[rid] if s.get("tool_name") == "save_chart")
    assert step["status"] == "error" and "chart_type is required" in step["error"]
    tool_msg = next(m for m in llm.seen[1] if m.get("role") == "tool")
    assert "chart_type is required" in tool_msg["content"]


@pytest.mark.asyncio
async def test_repeated_failures_of_one_tool_tell_the_model_to_step_back(store, monkeypatch):
    _ctx(monkeypatch)

    async def failing_save(caller, args):
        return {"success": False, "error": "column outstanding does not exist"}

    specs = {**SPECS, "save_chart": ToolSpec("save_chart", "c", {"type": "object"}, failing_save, ToolTier.WORKSPACE)}

    async def available(caller, policy=None):
        return specs, [s.to_function_schema() for s in specs.values()]

    monkeypatch.setattr(L, "available_tools", available)
    rid = store.new_run()
    llm = LLM([("", [("save_chart", {"n": i})]) for i in range(3)] + [("I could not save it.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    tool_msgs = [m["content"] for turn in llm.seen[1:] for m in turn if m.get("role") == "tool"]
    assert "stop trying variations" not in tool_msgs[1]  # after two failures: still just the error
    assert "failure 3 in a row" in llm.seen[3][-1]["content"] and "Re-read the schema" in llm.seen[3][-1]["content"]


@pytest.mark.asyncio
async def test_plan_review_pauses_and_the_edited_plan_is_followed(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    llm = LLM([
        ("", [("update_plan", {"review": True, "items": [{"label": "Loans", "status": "pending"},
                                                          {"label": "Branches", "status": "pending"}]})]),
        ("Done.", []),
    ])
    assert await L.run_agent(rid, llm) == "waiting_approval"
    run = store.runs[rid]
    assert run.pending["type"] == "plan" and run.pending["items"] == ["Loans", "Branches"]
    decided = {"type": "plan", "call_id": run.pending["call_id"], "items": ["Loans", "Collateral"], "edited": True}
    assert await L.run_agent(rid, llm, decided=decided) == "completed"
    assert [p["label"] for p in run.plan] == ["Loans", "Collateral"] and run.context["plan_reviewed"] is True
    tool_msg = next(m for m in llm.seen[1] if m.get("role") == "tool")
    assert "Collateral" in tool_msg["content"]


@pytest.mark.asyncio
async def test_done_steps_keep_their_results(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    llm = LLM([("", [("update_plan", {"items": [{"label": "Loans", "status": "done", "result": "120 loans, $4.1M"}]})]),
               ("Done.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    assert store.runs[rid].plan[0]["result"] == "120 loans, $4.1M"


@pytest.mark.asyncio
async def test_message_sent_mid_task_joins_at_the_next_step(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    store.inbox[rid] = [{"text": "Use EUR, not USD"}]
    llm = LLM([("Done in EUR.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    assert any("[Added by the person while you work] Use EUR, not USD" in str(m.get("content")) for m in llm.seen[0])


@pytest.mark.asyncio
async def test_text_streams_while_the_model_writes(store, monkeypatch):
    _ctx(monkeypatch)
    drafts = []

    class StreamingLLM(LLM):
        async def generate_completion_with_tools(self, **kw):
            await kw["on_text"]("Revenue rose")
            return await super().generate_completion_with_tools(**kw)

    real_update = W.update_run

    async def spy(rid, **f):
        if "draft" in f:
            drafts.append(f["draft"])
        await real_update(rid, **f)

    monkeypatch.setattr(W, "update_run", spy)
    rid = store.new_run()
    assert await L.run_agent(rid, StreamingLLM([("Revenue rose 12%.", [])])) == "completed"
    assert "Revenue rose" in drafts and drafts[-1] is None  # shown while writing, cleared at the end


@pytest.mark.asyncio
async def test_created_things_become_outputs(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    llm = LLM([("", [("export_document", {"format": "xlsx", "title": "Pack"})]), ("Exported.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    assert store.outputs.get(rid) is None  # the fake export returns no link, so there is no card
    assert W.output_of("save_chart", {"title": "Revenue"}, {"chart_id": "c1"})["href"] == "/chart-designer?chart=c1"
    assert W.output_of("export_document", {}, {"download_url": "/f/1", "filename": "a.xlsx"})["kind"] == "file"
    assert W.output_of("run_query", {}, {"rows": []}) is None


def test_answer_figures_are_checked_against_the_data():
    from src.modules.agent.grounding import ground_answer

    out = ground_answer("Total loans: 4,120,500 across 120 loans; NPL rate 7.5%; also 999,999 unverified.",
                        ['{"npl_rate": 7.5}'], [{"rows": [{"total": 4120500, "n": 120}]}])
    assert out["checked"] >= 3 and out["unverified"] == ["999,999"] and out["verified"] >= 3


def test_rounded_scaled_and_derived_figures_count_as_found():
    from src.modules.agent.grounding import ground_answer

    payloads = [{"rows": [{"branch": "A", "loans": 80, "principal": 3349712.4}, {"branch": "B", "loans": 40, "principal": 1756650.1}]},
                {"rows": [{"rate": 0.1333}]}]
    answer = ("Outstanding is $5.1M across 120 loans; 33% of loans (40) are secured; unsecured $3.35M. "
              "NPL rate 13.33%. Branch 5 leads in 2024. Coverage 9.99x is invented.")
    out = ground_answer(answer, [], payloads)
    assert out["unverified"] == ["9.99x"], out



@pytest.mark.asyncio
async def test_first_plan_with_several_parts_is_reviewed_without_being_asked(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    four = [{"label": f"Part {i}", "status": "pending"} for i in range(1, 5)]
    assert await L.run_agent(rid, LLM([("", [("update_plan", {"items": four})]), ("Done.", [])])) == "waiting_approval"
    assert store.runs[rid].pending["type"] == "plan"

    rid2 = store.new_run()
    three = four[:3]
    assert await L.run_agent(rid2, LLM([("", [("update_plan", {"items": three})]), ("Done.", [])])) == "completed"

    rid3 = store.new_run()
    store.runs[rid3].unattended = True  # scheduled runs never wait for a review
    assert await L.run_agent(rid3, LLM([("", [("update_plan", {"items": four})]), ("Done.", [])])) == "completed"


@pytest.mark.asyncio
async def test_first_turn_writes_the_plan_and_the_person_gets_an_acknowledgement(store, monkeypatch):
    _ctx(monkeypatch)
    choices = []

    class AckLLM(LLM):
        async def generate_completion_with_tools(self, **kw):
            choices.append(kw.get("tool_choice"))
            return await super().generate_completion_with_tools(**kw)

        async def generate_completion(self, **kw):
            return {"success": True, "content": "I'll size the three levers and compare branches."}

    from src.modules.agent.tools import RUNTIME_TOOLS

    async def available(caller, policy=None):
        return SPECS, [s.to_function_schema() for s in SPECS.values()] + RUNTIME_TOOLS

    monkeypatch.setattr(L, "available_tools", available)
    rid = store.new_run()
    llm = AckLLM([("", [("update_plan", {"items": [{"label": "Baseline (done)", "status": "active"},
                                                   {"label": "Levers", "status": "active"}]})]),
                  ("Done.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    assert choices[0] == {"type": "function", "function": {"name": "update_plan"}} and choices[1] == "auto"
    assert any(s["kind"] == "message" and "three levers" in s["summary"] for s in store.steps[rid])
    plan = store.runs[rid].plan
    assert plan[0]["label"] == "Baseline" and [p["status"] for p in plan].count("active") <= 1


class TriageLLM(LLM):
    """The fast model answers with the given text; any model turn is counted."""

    def __init__(self, triage, script=()):
        super().__init__(list(script))
        self.triage, self.turns = triage, 0

    async def generate_completion(self, **kw):
        return {"success": True, "content": self.triage}

    async def generate_completion_with_tools(self, **kw):
        self.turns += 1
        return await super().generate_completion_with_tools(**kw)


@pytest.mark.asyncio
async def test_a_greeting_is_answered_without_planning_or_tools(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    llm = TriageLLM("REPLY: Hi! What would you like to look at?")
    assert await L.run_agent(rid, llm) == "completed"
    assert llm.turns == 0 and not store.runs[rid].plan
    assert store.runs[rid].result["answer"] == "Hi! What would you like to look at?"


@pytest.mark.asyncio
@pytest.mark.parametrize("triage", ["WORK: I'll compare the branches.", "I'll compare the branches."])
async def test_work_goes_through_the_loop_even_if_the_marker_is_missing(store, monkeypatch, triage):
    _ctx(monkeypatch)
    rid = store.new_run()
    llm = TriageLLM(triage, [("Done.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    assert llm.turns == 1
    assert any(s["kind"] == "message" and s["summary"] == "I'll compare the branches." for s in store.steps[rid])


def test_an_opening_line_cut_off_mid_sentence_is_not_shown():
    assert L._read_triage("WORK: I will examine your loans, deposits, and branch") == ("", "")
    assert L._read_triage("WORK: I will examine your loans.") == ("", "I will examine your loans.")


@pytest.mark.parametrize("text", ["RE", "REPLY", "WO", "work", ""])
def test_a_marker_cut_off_by_the_length_limit_is_never_shown(text):
    assert L._read_triage(text) == ("", "")


@pytest.mark.asyncio
async def test_a_scheduled_task_is_never_answered_without_doing_the_work(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    store.runs[rid].unattended = True
    llm = TriageLLM("REPLY: Hello.", [("Done.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    assert llm.turns == 1


class FlakyLLM(LLM):
    """Fails the first calls, recording which model each call asked for."""

    def __init__(self, script, failures):
        super().__init__(script)
        self.failures, self.models = failures, []

    async def generate_completion_with_tools(self, **kw):
        self.models.append(kw.get("model_id"))
        if self.failures:
            self.failures -= 1
            return {"success": False, "error": "Temporary error. Please try again."}
        return await super().generate_completion_with_tools(**kw)


@pytest.mark.asyncio
async def test_a_failed_model_call_is_retried_then_uses_the_default_model(store, monkeypatch):
    _ctx(monkeypatch)
    monkeypatch.setattr(L, "MODEL_RETRY_WAIT_S", 0)
    rid = store.new_run()
    store.runs[rid].context = {**(store.runs[rid].context or {}), "model_id": "chosen"}
    llm = FlakyLLM([("Done.", [])], 2)
    assert await L.run_agent(rid, llm) == "completed"
    assert llm.models[:2] == ["chosen", "chosen"] and llm.models[2] != "chosen"


@pytest.mark.asyncio
async def test_a_task_still_fails_when_the_model_keeps_failing(store, monkeypatch):
    _ctx(monkeypatch)
    monkeypatch.setattr(L, "MODEL_RETRY_WAIT_S", 0)
    rid = store.new_run()
    assert await L.run_agent(rid, FlakyLLM([], 10)) == "failed"
    assert store.runs[rid].status == "failed"


def test_each_confirmed_figure_names_its_source():
    from src.modules.agent.grounding import ground_answer

    payload = {"rows": [{"campus": "A", "n": 141}, {"campus": "B", "n": 104}]}
    out = ground_answer("A has 141 of 245 records, not 999.", [], [payload],
                        [{"handle": "result://1", "title": "By campus", "payload": payload}])
    assert out["sources"]["141"] == {"how": "found", "handle": "result://1", "title": "By campus"}
    assert out["sources"]["245"]["how"] == "calculated" and out["sources"]["245"]["handle"] == "result://1"
    assert out["unverified"] == ["999"]


@pytest.mark.asyncio
async def test_a_figure_it_cannot_back_up_goes_back_to_the_agent_once(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    llm = LLM([("", [("update_plan", {"items": [{"label": "Look", "status": "active"}]})]),
               ("Revenue was 5,555.", []), ("Revenue was about 6,666.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    assert "5,555" in str(llm.seen[-1][-1]["content"]) and "not in the data" in str(llm.seen[-1][-1]["content"])
    assert store.runs[rid].result["grounding"]["unverified"] == ["6,666"]  # told once, then labelled


@pytest.mark.asyncio
async def test_the_tasks_data_source_is_used_when_the_model_leaves_it_out(store, monkeypatch):
    _ctx(monkeypatch)
    seen = {}

    async def query(caller, args):
        seen.update(args)
        return {"rows": [{"n": 1}], "row_count": 1}

    specs = {"run_query": ToolSpec("run_query", "q", {"type": "object", "properties": {"data_source_id": {}, "sql": {}}},
                                   query, ToolTier.READ)}

    async def available(caller, policy=None):
        return specs, [s.to_function_schema() for s in specs.values()]

    monkeypatch.setattr(L, "available_tools", available)
    rid = store.new_run()
    store.runs[rid].context = {"data_source_id": "ds-123"}
    store.runs[rid].plan = [{"id": "p1", "label": "Query", "status": "active"}]
    llm = LLM([("", [("run_query", {"sql": "select 1"})]), ("One row.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    assert seen["data_source_id"] == "ds-123"


def test_step_summaries_read_as_plain_language():
    assert L._summarize("run_query", {"rows": [{}], "row_count": 1}, "result://1") == "1 row"
    assert L._summarize("run_query", {"rows": [{}, {}], "row_count": 2}, None) == "2 rows"
    assert L._summarize("list_domains", {"domains": [1, 2, 3]}, None) == "3 business areas"
    assert L._summarize("mystery", {"ok": True}, None) == "Done"


@pytest.mark.asyncio
async def test_slow_memory_recall_never_holds_the_task_up(store, monkeypatch):
    import asyncio as aio
    import time as tm

    _ctx(monkeypatch)

    async def slow_recall(*a, **k):
        await aio.sleep(5)
        return [{"content": "never used"}]

    monkeypatch.setattr(L.M, "recall", slow_recall)
    monkeypatch.setattr(L, "RECALL_TIMEOUT_S", 0.05)
    rid = store.new_run()
    store.runs[rid].plan = [{"id": "p1", "label": "Answer", "status": "active"}]
    started = tm.perf_counter()
    assert await L.run_agent(rid, LLM([("Done.", [])])) == "completed"
    assert tm.perf_counter() - started < 2


@pytest.mark.asyncio
async def test_release_check_runs_never_use_the_organizations_credits(monkeypatch):
    import types as ty

    called = []

    async def track(*a, **k):
        called.append(a)
        return True, 1, ""

    import src.modules.pricing.usage_tracker as UT

    monkeypatch.setattr(UT, "track_ai_credits_idempotent", track, raising=False)
    run = ty.SimpleNamespace(organization_id="o1", user_id="u1", trigger="eval")
    assert await L._charge(run, 3, "k") == (True, "")
    assert await L._has_credits(run) == (True, "")
    assert called == []


@pytest.mark.asyncio
async def test_a_malformed_answer_is_rewritten_once_before_it_is_shown(store, monkeypatch):
    _ctx(monkeypatch)
    bad = "| A | B |\n|---|---|\n| 1 | 2 | 3 |"
    good = "| A | B |\n|---|---|\n| 1 | 2 |"
    rid = store.new_run()
    llm = LLM([(bad, []), (good, [])])
    assert await L.run_agent(rid, llm) == "completed"
    assert store.runs[rid].result["answer"] == good
    assert "Before your answer is shown, fix" in llm.seen[1][-1]["content"]

    rid2 = store.new_run()  # still wrong after the rewrite: shown as it is, no loop
    llm2 = LLM([(bad, []), (bad, [])])
    assert await L.run_agent(rid2, llm2) == "completed"
    assert store.runs[rid2].result["answer"] == bad


@pytest.mark.asyncio
async def test_a_message_while_the_model_writes_restarts_the_turn_with_it(store, monkeypatch):
    import asyncio

    _ctx(monkeypatch)
    monkeypatch.setattr(L, "INTERRUPT_CHECK_S", 0.01)
    rid = store.new_run()

    class SlowThenFast(LLM):
        async def generate_completion_with_tools(self, **kw):
            if not self.seen:  # the first turn is still writing when the person adds a message
                self.seen.append([dict(m) for m in kw.get("messages") or []])
                store.inbox[rid] = [{"text": "Only branch 2, please"}]
                await asyncio.sleep(30)
            return await super().generate_completion_with_tools(**kw)

    llm = SlowThenFast([("Branch 2 only: 1 of 24 loans.", [])])
    assert await asyncio.wait_for(L.run_agent(rid, llm), timeout=5) == "completed"
    assert any("Only branch 2, please" in str(m.get("content")) for m in llm.seen[1])
    assert store.runs[rid].result["answer"] == "Branch 2 only: 1 of 24 loans."


@pytest.mark.asyncio
async def test_an_answer_cut_off_at_the_limit_is_rewritten_once_and_not_streamed(store, monkeypatch):
    _ctx(monkeypatch)
    rid = store.new_run()
    streamed = []

    class CutOff(LLM):
        async def generate_completion_with_tools(self, **kw):
            streamed.append(kw.get("on_text") is not None)
            out = await super().generate_completion_with_tools(**kw)
            if len(self.seen) == 1:
                out["finish_reason"] = "length"
            return out

    llm = CutOff([("Branch 5 has the most NPLs and", []), ("Branch 5 has the most NPLs: 22.5%.", [])])
    assert await L.run_agent(rid, llm) == "completed"
    assert store.runs[rid].result["answer"] == "Branch 5 has the most NPLs: 22.5%."
    assert "cut off at the length limit" in llm.seen[1][-1]["content"]
    assert streamed == [True, False]  # the rewrite replaces the first version in one step


@pytest.mark.asyncio
async def test_a_change_waits_with_its_before_and_after(store, monkeypatch):
    _ctx(monkeypatch)

    async def change(caller, args):
        return {"title": "Chart: NPL", "undo": {"handler": "x", "args": {}}}

    async def preview(caller, args):
        return {"title": "Chart: NPL", "changes": [{"field": "chart_type", "before": "bar", "after": args["chart_type"]}]}

    specs = {**SPECS, "update_chart": ToolSpec("update_chart", "u", {"type": "object"}, change, ToolTier.INTERNAL,
                                               preview=preview)}

    async def available(caller, policy=None):
        return specs, [s.to_function_schema() for s in specs.values()]

    monkeypatch.setattr(L, "available_tools", available)
    rid = store.new_run()
    llm = LLM([("", [("update_chart", {"chart_type": "line"})])])
    assert await L.run_agent(rid, llm) == "waiting_approval"
    assert store.runs[rid].pending["preview"]["changes"] == [{"field": "chart_type", "before": "bar", "after": "line"}]
