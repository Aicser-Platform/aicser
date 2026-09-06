"""Regression test: a node decorated with handle_node_errors() must never let
an exception reach the client with a completely blank response.

Root cause this guards against: on exception, the decorator set
state["error"] but left message/narration/executive_summary untouched. In
the agent-kernel subgraph specifically, a plan/verify failure with no plan
routes straight to graph END (route_after_agent_verifier), bypassing
artifact_quality_gate -- the one place the success path gets its own
"never emit empty" protection. Live-reproduced this session as "status
shows, then disappears completely, no response, then an error later" under
a real LLM provider outage. Fixed at the single source (the decorator
itself) rather than patched into each of the 5 node families that use it,
so every one of them gets the same guarantee without duplicating the logic.
"""

import pytest

from ee.modules.ai.services.langgraph_base import handle_node_errors


@pytest.mark.asyncio
async def test_exception_sets_a_real_fallback_message():
    @handle_node_errors()
    async def _boom(state):
        raise RuntimeError("provider rate limit exceeded")

    state = {"query": "what is the current APPU?"}
    out = await _boom(state)

    assert out["error"]
    assert (out.get("message") or "").strip()
    assert (out.get("narration") or "").strip()
    assert (out.get("executive_summary") or "").strip()
    assert "provider rate limit exceeded" in out["message"]


@pytest.mark.asyncio
async def test_timeout_sets_a_real_fallback_message():
    @handle_node_errors(timeout_seconds=0.01)
    async def _slow(state):
        import asyncio

        await asyncio.sleep(1)
        return state

    out = await _slow({"query": "slow query"})

    assert out["error"]
    assert (out.get("message") or "").strip()
    assert (out.get("narration") or "").strip()


@pytest.mark.asyncio
async def test_fallback_never_overwrites_a_real_message_already_set():
    """A node that partially succeeded before failing (or a stale-but-real
    message from earlier in the turn) must not be clobbered by the generic
    fallback -- additive only."""

    @handle_node_errors()
    async def _boom(state):
        state["message"] = "Here are the 3 rows I already found before the second step failed."
        raise RuntimeError("second step failed")

    out = await _boom({})

    assert out["message"] == "Here are the 3 rows I already found before the second step failed."


@pytest.mark.asyncio
async def test_success_path_is_unaffected():
    @handle_node_errors()
    async def _ok(state):
        state["message"] = "real answer"
        return state

    out = await _ok({})

    assert out["message"] == "real answer"
    assert "error" not in out
