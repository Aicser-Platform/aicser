"""Agent service and tool assembly: entitlement gates, approval state, RBAC/feature filtering."""

from __future__ import annotations

import types

import pytest

from src.core.tool_registry import ToolCaller, ToolRegistry, ToolSpec, ToolTier
from src.modules.agent import service as S
from src.modules.agent import tools as T


@pytest.mark.asyncio
async def test_start_needs_agent_and_unattended_needs_digital_worker(monkeypatch):
    import src.modules.pricing.seats as seats

    async def ai_seat(org, user):
        return False

    monkeypatch.setattr(seats, "is_platform_seat", ai_seat)

    async def ent(org, feature):
        return (feature == "agent", f"no {feature}")

    monkeypatch.setattr(S, "_entitled", ent)
    with pytest.raises(S.AgentError) as e:
        await S.start_task(user_id="u", organization_id="o", goal="x", unattended=True)
    assert e.value.status == 402 and e.value.code == "digital_worker_required"

    async def none(org, feature):
        return (False, "Feature 'agent' requires a higher plan.")

    monkeypatch.setattr(S, "_entitled", none)
    with pytest.raises(S.AgentError) as e:
        await S.start_task(user_id="u", organization_id="o", goal="x")
    assert e.value.code == "agent_not_enabled"


@pytest.mark.asyncio
async def test_approve_and_answer_require_the_matching_wait():
    run = types.SimpleNamespace(id="r", status="running", pending=None)
    with pytest.raises(S.AgentError) as e:
        await S.approve(run, allow=True, remember=False, by="u")
    assert e.value.status == 409
    run = types.SimpleNamespace(id="r", status="waiting_approval", pending={"type": "approval", "call_id": "c"})
    with pytest.raises(S.AgentError):
        await S.answer(run, text="Q3", by="u")


def test_pending_shown_to_the_client_is_redacted():
    p = S._public_pending({"type": "approval", "tool_call": {"name": "send_email", "arguments": {"api_key": "s3", "to": ["a"]}}})
    assert p["tool"] == "send_email" and p["arguments"]["api_key"] == "***" and p["arguments"]["to"] == ["a"]


@pytest.mark.asyncio
async def test_tools_are_filtered_by_feature_permission_and_admin_policy(monkeypatch):
    async def h(c, a):
        return {}

    reg = ToolRegistry()
    reg.register(ToolSpec("open", "d", {"type": "object"}, h))
    reg.register(ToolSpec("alerts", "d", {"type": "object"}, h, ToolTier.INTERNAL, feature="alerts"))
    reg.register(ToolSpec("export", "d", {"type": "object"}, h, ToolTier.WORKSPACE, permission_code="project:export"))
    reg.register(ToolSpec("off", "d", {"type": "object"}, h))
    reg.register(ToolSpec("mcp_only", "d", {"type": "object"}, h, surfaces=frozenset({"mcp"})))
    monkeypatch.setattr(T, "load_registered_tools", lambda: reg)

    async def feature_on(org, feature, cache):
        return False

    async def perm(caller, code):
        return code != "project:export"

    monkeypatch.setattr(T, "_feature_on", feature_on)
    monkeypatch.setattr(T, "has_permission", perm)
    import ee.modules.ai.services.capability_governance_service as G

    async def disabled(org):
        return {"off"}

    monkeypatch.setattr(G, "get_disabled_capabilities", disabled)
    specs, schemas = await T.available_tools(ToolCaller("u", "o"), {"pre_approved": set(), "max_tier": 4, "device": {"enabled": False}})
    assert set(specs) == {"open"}
    names = {s["function"]["name"] for s in schemas}
    assert {"open", "update_plan", "ask_user", "read_result", "remember", "recall", "run_parallel"} == names


def test_every_tool_module_registers():
    from src.core.tool_registry import load_registered_tools

    names = {t.name for t in load_registered_tools().list(surface="agent")}
    assert {"run_query", "ask", "export_document", "send_email", "create_alert", "run_python"} <= names


@pytest.mark.asyncio
async def test_a_task_from_chat_reads_the_conversation_so_far(monkeypatch):
    """ "The other recommended actions" means what an earlier answer recommended (a task once had to ask)."""
    import src.modules.ai.orchestrator.conversation_hydration as H
    from src.modules.chats.conversations.service import ConversationService

    async def allowed(self, conversation_id, user_id, forbidden_detail=""):
        return None

    async def history(factory, conversation_id, limit=20, answer_chars=700):
        assert answer_chars > 700  # the task reads more of each answer than a chat follow-up does
        return [{"role": "user", "content": "How can we improve the loan book?"},
                {"role": "assistant", "content": "Recommended: 1. Review branch 2 pricing. 2. Flag missing collateral."}]

    monkeypatch.setattr(ConversationService, "_require_conversation_access", allowed)
    monkeypatch.setattr(H, "get_conversation_history", history)
    text = await S._conversation_so_far("c1", "u1")
    assert text == ("Person: How can we improve the loan book?\n\n"
                    "Aicser: Recommended: 1. Review branch 2 pricing. 2. Flag missing collateral.")

    async def denied(self, conversation_id, user_id, forbidden_detail=""):
        raise PermissionError("no access")

    monkeypatch.setattr(ConversationService, "_require_conversation_access", denied)
    assert await S._conversation_so_far("c1", "someone-else") == ""


@pytest.mark.asyncio
async def test_a_task_discards_only_its_own_drafts_and_can_undo(monkeypatch):
    import uuid as _uuid

    from src.modules.agent import workspace as W

    owner = _uuid.uuid4()
    recipe = types.SimpleNamespace(id=_uuid.uuid4(), status="draft", is_deleted=False)

    class _Result:
        def scalar_one_or_none(self):
            return recipe

    class _DB:
        async def __aenter__(self):
            return self

        async def __aexit__(self, *a):
            return False

        async def execute(self, q):
            return _Result()

        async def commit(self):
            pass

    run = types.SimpleNamespace(id="r1", user_id=owner, outputs=[
        {"kind": "chart", "title": "Chart", "href": "/c"},
        {"kind": "recipe", "title": "Loans QC", "href": "/prepare/x", "id": str(recipe.id)}])
    saved = {}

    async def update_run(rid, **f):
        saved.update(f)
        run.outputs = f.get("outputs", run.outputs)

    async def get_run(rid):
        return run

    monkeypatch.setattr(S, "async_session", lambda: _DB())
    monkeypatch.setattr(W, "update_run", update_run)
    monkeypatch.setattr(W, "get_run", get_run)
    monkeypatch.setattr(S, "run_to_dict", lambda r, **k: {"outputs": r.outputs})

    out = await S.discard_output(run, index=1)
    assert recipe.is_deleted and out["outputs"][1]["discarded"] is True
    out = await S.discard_output(run, index=1, undo=True)
    assert not recipe.is_deleted and out["outputs"][1]["discarded"] is False

    with pytest.raises(S.AgentError) as e:
        await S.discard_output(run, index=0)  # a chart is not a draft this endpoint manages
    assert e.value.code == "not_discardable"
    recipe.status = "published"
    with pytest.raises(S.AgentError) as e:
        await S.discard_output(run, index=1)
    assert e.value.code == "not_a_draft" and not recipe.is_deleted


@pytest.mark.asyncio
async def test_undo_takes_back_a_change_as_the_task_owner(monkeypatch):
    from src.core import tool_registry as R
    from src.modules.agent import workspace as W

    seen = {}

    async def restore(caller, args):
        seen.update(caller=caller, args=args)
        return {"restored": True}

    R.register_undo("restore_test", restore)
    run = types.SimpleNamespace(id="r1", user_id="u1", organization_id="o1", project_id="p1", outputs=[
        {"kind": "change", "title": "Chart: NPL", "undo": {"handler": "restore_test", "args": {"chart_id": "c1"}}}])

    async def update_run(rid, **f):
        run.outputs = f.get("outputs", run.outputs)

    async def get_run(rid):
        return run

    monkeypatch.setattr(W, "update_run", update_run)
    monkeypatch.setattr(W, "get_run", get_run)
    monkeypatch.setattr(S, "run_to_dict", lambda r, **k: {"outputs": r.outputs})
    out = await S.undo_output(run, index=0)
    assert out["outputs"][0]["undone"] is True
    assert seen["caller"].user_id == "u1" and seen["args"] == {"chart_id": "c1"}
    with pytest.raises(S.AgentError) as e:
        await S.undo_output(run, index=0)
    assert e.value.code == "already_undone"


def test_changes_become_cards_with_undo_and_new_sheets_open():
    from src.modules.agent import workspace as W

    card = W.output_of("update_chart", {}, {"title": "Chart: NPL", "href": "/chart-designer?chart=c1",
                                            "undo": {"handler": "restore_chart", "args": {}}})
    assert card["kind"] == "change" and card["undo"]["handler"] == "restore_chart"
    sheet = W.output_of("create_sheet", {}, {"workbook_id": "w1", "title": "NPL", "href": "/sheets/w1"})
    assert sheet == {"kind": "sheet", "title": "NPL", "href": "/sheets/w1", "tool": "create_sheet"}
