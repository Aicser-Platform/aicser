"""Auto's workflow router: the model decides Chat / Analyze / Agent; failures keep today's default."""

import pytest

from ee.modules.ai.utils import workflow_router as W


class _LLM:
    def __init__(self, reply=None, boom=False):
        self.reply, self.boom, self.calls = reply, boom, 0

    async def generate_completion_with_tools(self, **kw):
        self.calls += 1
        if self.boom:
            raise TimeoutError("slow")
        return {"success": True, "tool_calls": [{"name": "choose_workflow", "arguments": self.reply}]}


@pytest.fixture(autouse=True)
def _clear_cache():
    W._cache.clear()


@pytest.mark.asyncio
async def test_router_returns_the_models_choice():
    llm = _LLM({"workflow": "agent", "confident": True, "reason": "several steps and an email"})
    d = await W.decide_workflow("prepare the pack and email the CFO", llm, has_data_source=True)
    assert (d.workflow, d.source) == ("agent", "llm")


@pytest.mark.asyncio
async def test_router_fails_open_to_analyze_with_data_and_chat_without():
    assert (await W.decide_workflow("q", _LLM(boom=True), has_data_source=True)).workflow == "analyze"
    assert (await W.decide_workflow("q", _LLM(boom=True), has_data_source=False)).workflow == "chat"
    assert (await W.decide_workflow("q", None, has_data_source=True)).source == "fallback"


@pytest.mark.asyncio
async def test_unknown_workflow_is_ignored():
    d = await W.decide_workflow("q", _LLM({"workflow": "dashboard"}), has_data_source=True)
    assert d.source == "fallback"


@pytest.mark.asyncio
async def test_analyze_without_a_data_source_becomes_chat():
    d = await W.decide_workflow("revenue last month", _LLM({"workflow": "analyze"}), has_data_source=False)
    assert d.workflow == "chat"


@pytest.mark.asyncio
async def test_same_request_is_decided_once():
    llm = _LLM({"workflow": "analyze", "confident": True})
    await W.decide_workflow("top customers", llm, has_data_source=True, cache_scope="o1")
    await W.decide_workflow("Top customers ", llm, has_data_source=True, cache_scope="o1")
    assert llm.calls == 1


def test_kernel_follows_the_workflow_decision():
    from ee.modules.ai.kernel.goal_resolver import should_use_agent_kernel

    base = {"query": "show revenue by month", "data_source_id": "ds"}
    assert should_use_agent_kernel({**base, "agent_context": {"analysis_mode": "standard", "workflow": "agent"}})
    assert not should_use_agent_kernel({**base, "query": "build a dashboard and then a report",
                                        "agent_context": {"analysis_mode": "standard", "workflow": "analyze"}})
    # No decision at all (older client): keyword fallback still applies.
    assert should_use_agent_kernel({**base, "query": "build a dashboard and then a report",
                                    "agent_context": {"analysis_mode": "standard"}})
