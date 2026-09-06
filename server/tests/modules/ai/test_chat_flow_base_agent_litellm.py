"""BaseAgent (chats/core/ai_flows) used to hold its own AsyncOpenAI client -
bypassing org budget enforcement, PII scrubbing, and BYOK entirely for the 6
chat-flow agents built on it (chart/sql/title/intent/insight/assistant).
It now routes through the shared LiteLLMService like every other AI Engine call.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.chats.core.ai_flows.agents.base_agent import BaseAgent

# base_agent.py imports ChatNodeRepository via the ee.modules.chats path, not
# src.modules.chats (a separately-loaded module object - src/modules/chats/__init__.py
# __path__-redirects into the ee tree, but that's a second load, not an alias)
# - patching the src-path copy here left the real repository running, which
# then hit a real (and here, incompletely-registered) DB session.
_REPO = "ee.modules.chats.node_memory.repository.ChatNodeRepository"


class _ConcreteAgent(BaseAgent):
    async def execute(self, user_prompt, messages=None):
        return await self.completion(user_prompt, messages or [])


def _make_agent(**kwargs):
    kwargs.setdefault("save_memory", False)
    return _ConcreteAgent(
        name="test_agent",
        system_prompt="You are a test agent.",
        **kwargs,
    )


@pytest.fixture(autouse=True)
def _no_real_db_memory_load():
    """completion() always calls _load_node_memory() first, save_memory or not."""
    with patch(f"{_REPO}.get_nodes_by_key", new=AsyncMock(return_value=[])):
        yield


@pytest.mark.asyncio
async def test_completion_routes_through_litellm_service():
    agent = _make_agent()

    fake_response = {
        "success": True,
        "content": "the answer",
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=AsyncMock(return_value=fake_response),
    ) as mock_gc:
        result = await agent.completion("hello")

    assert result == "the answer"
    _, kwargs = mock_gc.call_args
    assert kwargs["messages"][0] == {"role": "system", "content": "You are a test agent."}
    assert kwargs["messages"][-1] == {"role": "user", "content": "hello"}
    assert kwargs["node_name"] == "test_agent"


@pytest.mark.asyncio
async def test_completion_raises_on_llm_failure():
    agent = _make_agent()

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=AsyncMock(return_value={"success": False, "error": "budget exceeded"}),
    ):
        with pytest.raises(RuntimeError, match="budget exceeded"):
            await agent.completion("hello")


@pytest.mark.asyncio
async def test_completion_saves_usage_to_memory():
    agent = _make_agent(save_memory=True, conversation_id="c1", message_id="m1")

    fake_response = {
        "success": True,
        "content": "the answer",
        "usage": {"prompt_tokens": 10, "completion_tokens": 5, "total_tokens": 15},
    }

    saved = {}

    async def fake_save(self, data):
        saved["data"] = data
        return type("Memory", (), {"id": "mem-1"})()

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_completion",
        new=AsyncMock(return_value=fake_response),
    ), patch(f"{_REPO}.create", new=fake_save):
        await agent.completion("hello")

    assert saved["data"].output == "the answer"
    assert "prompt_tokens" in saved["data"].execution_metadata
