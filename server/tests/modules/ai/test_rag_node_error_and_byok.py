"""Regression tests for two bugs found via a live user report on the KB chat
flow, both in rag_retrieval_node.py's direct-answer synthesis path:

1. BYOK not hydrated: LiteLLMService() was constructed fresh with no call to
   hydrate_user_byok_models, so a user with (for example) a Gemini BYOK key
   selected got "Model byok_google not configured; using default
   primary_override" and silently ran on the platform default instead of the
   model they explicitly picked. api_streaming.py's conversational path
   already hydrates before its own answer-generation call; this node didn't.

2. Raw error leaked to the end user: generate_streaming_completion signals a
   failure by yielding "Error: <str(exception)>" instead of raising (a
   generator can't propagate an exception after it's already started
   yielding). This node only special-cased the one literal "Error: No model
   configuration found" string -- every other "Error: " chunk (an auth
   failure, in the reported case: the raw litellm.AuthenticationError text,
   including a partially-masked API key and a misleading
   platform.openai.com URL) got appended to answer_chunks and shown to the
   user verbatim, as if it were the assistant's actual response.
"""

from unittest.mock import AsyncMock, MagicMock, patch

import pytest


def _fake_chunk(chunk_id="c1", doc_id="d1", filename="doc.pdf", score=0.9):
    chunk = MagicMock()
    chunk.chunk_id = chunk_id
    chunk.document_id = doc_id
    chunk.document_filename = filename
    chunk.content = "Some retrieved passage about the document."
    chunk.score = score
    chunk.token_count = 20
    chunk.metadata = {}
    return chunk


async def _fake_stream_error(*args, **kwargs):
    yield "Error: AuthenticationError: OpenAIException - Incorrect API key provided: thk_live***yrDa. You can find your API key at https://platform.openai.com/account/api-keys."


async def _fake_stream_ok(*args, **kwargs):
    yield "The document "
    yield "says X."


def _make_state(**overrides):
    state = {
        "query": "what are the details of the docs",
        "data_source_id": "ds-1",
        "user_id": "user-123",
        "organization_id": "org-456",
        "agent_context": {"model_id": "byok_google"},
        "execution_metadata": {},
    }
    state.update(overrides)
    return state


@pytest.fixture
def rag_node_env():
    """Common patch set: DB session, chunk retrieval, and audit logging
    mocked out so the node runs its real synthesis logic against a
    controlled LLM response."""
    mock_session = AsyncMock()
    mock_cm = AsyncMock()
    mock_cm.__aenter__.return_value = mock_session
    mock_cm.__aexit__.return_value = None

    patches = [
        patch("src.db.session.async_session", return_value=mock_cm),
        patch(
            "src.modules.knowledge.services.rag_retrieval_service.RAGRetrievalService.retrieve",
            new=AsyncMock(return_value=[_fake_chunk()]),
        ),
        patch("src.shared.middleware.audit_logger.log_audit_event", new=AsyncMock()),
    ]
    for p in patches:
        p.start()
    yield
    for p in patches:
        p.stop()


@pytest.mark.asyncio
async def test_byok_is_hydrated_before_answer_synthesis(rag_node_env):
    from ee.modules.ai.nodes.rag_retrieval_node import rag_retrieval_node

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.hydrate_user_byok_models",
        new=AsyncMock(),
    ) as mock_hydrate, patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_streaming_completion",
        new=_fake_stream_ok,
    ):
        state = _make_state()
        await rag_retrieval_node(state)

    mock_hydrate.assert_awaited_once_with("user-123", "org-456")


@pytest.mark.asyncio
async def test_raw_auth_error_never_reaches_the_answer(rag_node_env):
    from ee.modules.ai.nodes.rag_retrieval_node import rag_retrieval_node

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.hydrate_user_byok_models",
        new=AsyncMock(),
    ), patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_streaming_completion",
        new=_fake_stream_error,
    ), patch(
        "ee.modules.ai.nodes.rag_retrieval_node.node_llm",
        new=AsyncMock(return_value={"success": False, "error": "Temporary error. Please try again.", "fallback": True}),
    ):
        state = _make_state()
        result = await rag_retrieval_node(state)

    message = result.get("message", "")
    assert "thk_live" not in message
    assert "AuthenticationError" in message or "platform.openai.com" not in message
    assert "platform.openai.com" not in message
    assert "Incorrect API key" not in message
    # Falls through to the safe generic message since the non-streaming
    # fallback also failed (no content/text in its result dict).
    assert "couldn't generate a complete answer" in message


@pytest.mark.asyncio
async def test_successful_stream_is_unaffected(rag_node_env):
    """Control case: the fix must not break the normal, working path."""
    from ee.modules.ai.nodes.rag_retrieval_node import rag_retrieval_node

    with patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.hydrate_user_byok_models",
        new=AsyncMock(),
    ), patch(
        "ee.modules.ai.services.litellm_service.LiteLLMService.generate_streaming_completion",
        new=_fake_stream_ok,
    ):
        state = _make_state()
        result = await rag_retrieval_node(state)

    assert result["message"] == "The document says X."
    # update_progress(..., "complete") is the last write to current_stage on
    # the success path, superseding the earlier "rag_complete" set right
    # after streaming finishes.
    assert result["current_stage"] == "complete"
