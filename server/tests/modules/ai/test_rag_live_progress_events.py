"""Regression test: rag_retrieval_node's mid-run progress checkpoints must
push a live SSE event, not just mutate state.

Root cause this guards against: rag_retrieval_node is a single LangGraph
node under stream_mode="updates" — the graph only yields a state delta once
a node RETURNS, so update_progress()'s plain state mutation is invisible to
the client for the node's entire run (confirmed live: a real SSE capture of
a full RAG turn showed exactly two events — "routed_to_rag" (~18%, the
supervisor's own hand-off) and "complete" (100%) — nothing for the Search/
Rank/Synthesize span in between, even though the node internally progresses
through all three). For a slow call (embedding search plus an LLM synthesis
call, worse under provider retries), the client had no real signal for that
whole span and fell back to its own stall-detection heuristics using the
stale "routed_to_rag" text — reported live as a stray leftover "Analyzing
query intent..." line and the stepper appearing to "go back to Search"
(really: placeholder rotation cycling with no fresh signal to reset it).
Fixed by also pushing each checkpoint directly to the stream queue, the same
mechanism business_journey_nodes.py already uses for its own long-running
node.
"""

import asyncio

import pytest

from ee.modules.ai.nodes.rag_retrieval_node import _emit_rag_progress
from ee.modules.ai.utils.stream_queue_context import set_stream_queue


@pytest.mark.asyncio
async def test_emit_rag_progress_sets_state_and_pushes_to_queue():
    queue: asyncio.Queue = asyncio.Queue()
    set_stream_queue(queue)
    state = {}

    await _emit_rag_progress(state, 40.0, "Ranking 5 relevant passages...", "rag_ranking")

    assert state["progress_percentage"] == 40.0
    assert state["progress_message"] == "Ranking 5 relevant passages..."
    assert state["current_stage"] == "rag_ranking"

    assert not queue.empty()
    event_kind, payload = queue.get_nowait()
    assert event_kind == "progress"
    assert payload["stage"] == "rag_ranking"
    assert payload["message"] == "Ranking 5 relevant passages..."
    assert payload["raw_percentage"] == 40.0


@pytest.mark.asyncio
async def test_emit_rag_progress_never_raises_without_a_queue():
    set_stream_queue(None)
    state = {}

    await _emit_rag_progress(state, 30.0, "Searching knowledge base...", "rag_retrieval")

    assert state["progress_percentage"] == 30.0
