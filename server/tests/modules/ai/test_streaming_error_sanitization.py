"""Regression tests for a raw-error leak reported by a live user: a
litellm.AuthenticationError (including a partially-masked TokenHarbor API
key and a misleading platform.openai.com URL) was streamed to the chat UI
verbatim as if it were the assistant's answer.

Root cause: LiteLLMService.generate_streaming_completion can't raise once
it's already started yielding (it's a generator feeding a live token
stream), so it signals failure by yielding "Error: <str(exception)>"
instead. generate_streaming_completion's own except-block used to yield
str(error) directly; separately, every consumer of the generator
(rag_retrieval_node.py, api_streaming.py's conversational path) only
special-cased the one literal "Error: No model configuration found" string,
so any other "Error: " chunk -- including a raw auth failure -- passed
through untouched.
"""

import ast
import inspect
from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.services.litellm_service import (
    LiteLLMService,
    _user_facing_error_message,
)

# The exact exception text reported live (str(litellm.AuthenticationError)),
# minus the "Error: " prefix generate_streaming_completion itself adds --
# that prefix came from the old bug, not from litellm.
REAL_WORLD_AUTH_ERROR = (
    "litellm.AuthenticationError: AuthenticationError: OpenAIException - "
    "Incorrect API key provided: thk_live_L-tG99lkA62PUG-CbXYOLQxheZKcv8mj"
    "vdSDx1vzolZ3uX7HTUqSpbYfw_WTyrDa. You can find your API key at "
    "https://platform.openai.com/account/api-keys."
)


def test_user_facing_error_message_strips_key_and_url():
    """_user_facing_error_message must never let a key or provider URL through,
    regardless of how litellm phrases the underlying error."""
    result = _user_facing_error_message(REAL_WORLD_AUTH_ERROR)
    assert "thk_live" not in result
    assert "platform.openai.com" not in result
    assert "Incorrect API key" not in result
    assert result == "Temporary error. Please try again."


@pytest.mark.asyncio
async def test_generate_streaming_completion_sanitizes_exception():
    service = LiteLLMService()
    fake_config = {
        "name": "Primary",
        "model": "openai/deepseek-v4-flash",
        "provider": "openai",
        "api_key": "thk_live_fake_key_for_test",
        "max_tokens": 2000,
    }

    async def _raise(*args, **kwargs):
        raise Exception(REAL_WORLD_AUTH_ERROR)

    with patch.object(
        LiteLLMService, "_get_model_config", new=AsyncMock(return_value=fake_config)
    ), patch("ee.modules.ai.services.litellm_service.acompletion", new=_raise):
        chunks = [
            chunk
            async for chunk in service.generate_streaming_completion(
                messages=[{"role": "user", "content": "hi"}],
                model_id="primary_override",
            )
        ]

    assert len(chunks) == 1
    (only_chunk,) = chunks
    assert only_chunk.startswith("Error: ")
    assert "thk_live" not in only_chunk
    assert "platform.openai.com" not in only_chunk
    assert "AuthenticationError" not in only_chunk
    assert only_chunk == "Error: Temporary error. Please try again."


def test_supervisor_next_step_label_matches_actual_kb_routing():
    """Regression: a user asking a pure knowledge-base question saw
    "Generating SQL query... 17s" in the live progress UI, even though the
    backend was correctly routing to rag_retrieval the whole time (confirmed
    via logs: "Supervisor: routed to rag (ds_type=knowledge_base,
    has_kb=True)"). _next_step_label's entry for "supervisor" used to be a
    single static string that assumed NL2SQL was always next; it must now
    reflect the actual routing_decision.primary_agent."""
    from ee.modules.ai.api_streaming import _next_step_label

    assert _next_step_label("supervisor", False, "rag") == "Searching knowledge base…"
    assert _next_step_label("supervisor", False, "hybrid_rag") == "Searching documents…"
    assert _next_step_label("supervisor", False, "graceful_response") == "Preparing response…"
    # Real NL2SQL routing is unaffected -- still gets the SQL-appropriate label.
    assert _next_step_label("supervisor", False, "nl2sql") == "Generating SQL query…"
    # No routing info available (e.g. an older/partial state_update): falls
    # back to the previous unconditional default rather than showing nothing.
    assert _next_step_label("supervisor", False, None) == "Generating SQL query…"
    # Unrelated nodes are untouched by the new supervisor-specific branch.
    assert _next_step_label("nl2sql", False, "rag") == "Validating SQL…"


def test_supervisor_node_complete_payload_carries_routing_primary_agent():
    """Regression for a bug in the FIRST fix attempt at the "Generating SQL
    query..." mislabel: _next_step_label itself was correctly made
    routing-aware, but its only source of truth -- state_update.get(
    'execution_metadata') -- is never populated for a "supervisor"
    node_complete event. langgraph_orchestrator.py's node_complete_payload is
    a deliberately minimal dict (only node/label/stage/percentage/message/
    timestamp/trace_id, plus a couple of node-specific extras like sql_query
    and supervisor_narration) -- execution_metadata was never one of those
    extras, so the routing lookup was always empty and the label silently
    fell back to the SQL default, live, even after the "fix". Confirmed via
    a real user reproduction: the progress UI still showed "Generating SQL
    query... 18s" for a pure KB question after the first fix was deployed.

    The real fix adds a dedicated routing_primary_agent field to the
    supervisor's node_complete_payload (mirroring the existing sql_query /
    supervisor_narration extras), and api_streaming.py now reads that field
    directly instead of digging into execution_metadata. This test pins the
    orchestrator side of that contract at the source level -- a full
    behavioral test would require driving execute_streaming() end-to-end
    (LangGraph checkpointer, DB session, real node execution), which is out
    of proportion for a payload-shape guarantee; see
    test_supervisor_next_step_label_matches_actual_kb_routing above for the
    behavioral coverage of the consuming side."""
    import inspect

    from ee.modules.ai.services import langgraph_orchestrator

    source = inspect.getsource(langgraph_orchestrator)
    idx = source.index('node_complete_payload = {')
    # The relevant block is the node_complete construction plus its
    # node-specific extras, ending at the yield right after it.
    end_idx = source.index('yield node_complete_payload', idx)
    block = source[idx:end_idx]

    assert 'node_name == "supervisor"' in block
    assert 'routing_decision' in block
    assert 'node_complete_payload["routing_primary_agent"]' in block


def test_conversational_stream_filters_any_error_prefixed_chunk_not_just_the_literal():
    """Structural guard on api_streaming.py's conversational path: it must
    treat any "Error: " chunk as a failure signal, not only the one literal
    "Error: No model configuration found" string (the original bug). A full
    functional test would require standing up the FastAPI streaming route
    end-to-end (DB session, auth, ConversationService, SSE response); this
    pins the fixed logic at the source level instead, the same discipline
    already used elsewhere in this suite for equivalent SQL-string guards."""
    from ee.modules.ai import api_streaming

    source = inspect.getsource(api_streaming)
    # ast.parse is a cheap sanity check that the file is syntactically intact
    # (this test would otherwise happily pass against a broken file, since
    # inspect.getsource on a module still returns text even if some other
    # part of it fails to import at runtime under different conditions).
    ast.parse(source)

    assert 'chunk.startswith("Error: ")' in source
    # The old bug's exact-string guard must not be the (only) check anymore.
    assert 'chunk != "Error: No model configuration found"' not in source
