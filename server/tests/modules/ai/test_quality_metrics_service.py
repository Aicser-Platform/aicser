"""Tests for ai_quality_metrics recording.

Root problem this whole feature addresses: response_finalizer_node computes
a real per-response grounding score (state["global_evaluation"]) and the
agent kernel computes a real goal-verification pass/fail
(state["verification_results"]) on every turn, and neither was ever
persisted anywhere queryable — both were silently discarded once the turn
finished. These tests cover the extraction logic (does the service correctly
pull the right fields out of a realistic final_state) and that record/update
degrade to safe no-ops rather than ever raising into the message-save path
that calls them.

The aggregation queries (get_quality_summary/get_quality_timeseries) use
Postgres-specific SQL (date_trunc, FILTER-clause aggregates) that a
mocked/sqlite unit test can't faithfully exercise — those were instead
verified live against the real running database (see the session notes for
this feature); this file sticks to what's meaningfully unit-testable.
"""

import uuid

import pytest
from unittest.mock import AsyncMock, MagicMock

from ee.modules.ai.quality_metrics_models import AIQualityMetric
from ee.modules.ai.services.quality_metrics_service import (
    _extract_goal_verification_passed,
    _extract_latency_ms,
    record_quality_metrics,
    update_feedback_reaction,
)


def test_extract_goal_verification_passed_uses_last_entry():
    """A replan appends a new verification_results entry -- only the LAST
    one reflects the turn's actual final outcome."""
    final_state = {
        "verification_results": [
            {"passed": False},
            {"passed": True},
        ]
    }
    assert _extract_goal_verification_passed(final_state) is True


def test_extract_goal_verification_passed_none_when_absent():
    assert _extract_goal_verification_passed({}) is None
    assert _extract_goal_verification_passed({"verification_results": []}) is None


def test_extract_latency_ms_sums_node_timings():
    final_state = {
        "execution_metadata": {
            "node_timings": {"supervisor": 100, "nl2sql": 250.5, "analytics_node": 300},
        }
    }
    assert _extract_latency_ms(final_state) == 650


def test_extract_latency_ms_none_when_absent():
    assert _extract_latency_ms({}) is None
    assert _extract_latency_ms({"execution_metadata": {}}) is None


class _FakeSession:
    """Records what would have been persisted without touching a real DB —
    enough to verify record_quality_metrics extracts the right fields into
    the right columns without needing a live Postgres round-trip for this
    part (unlike the aggregation queries)."""

    def __init__(self):
        self.added = []
        self.committed = False

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.committed = True

    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


@pytest.mark.asyncio
async def test_record_quality_metrics_extracts_real_fields():
    session = _FakeSession()
    session_factory = MagicMock(return_value=session)

    message_id = str(uuid.uuid4())
    conversation_id = str(uuid.uuid4())
    org_id = str(uuid.uuid4())

    final_state = {
        "organization_id": org_id,
        "project_id": str(uuid.uuid4()),
        "user_id": str(uuid.uuid4()),
        "analytics_type": "descriptive",
        "execution_metadata": {
            "analysis_mode": "standard",
            "global_evaluation": {
                "main": {"phase": "final_output_quality", "decision": "approved", "score": 0.91},
            },
            "node_timings": {"nl2sql": 500, "analytics_node": 300},
        },
        "verification_results": [{"passed": True}],
        "success": True,
        "critical_failure": False,
        "error": None,
    }

    await record_quality_metrics(
        session_factory,
        message_id=message_id,
        conversation_id=conversation_id,
        final_state=final_state,
    )

    assert session.committed is True
    assert len(session.added) == 1
    row: AIQualityMetric = session.added[0]
    assert str(row.message_id) == message_id
    assert str(row.conversation_id) == conversation_id
    assert str(row.organization_id) == org_id
    assert row.analytics_type == "descriptive"
    assert row.analysis_mode == "standard"
    assert row.grounding_score == 0.91
    assert row.grounding_decision == "approved"
    assert row.goal_verification_passed is True
    assert row.success is True
    assert row.critical_failure is False
    assert row.had_error is False
    assert row.latency_ms == 800


@pytest.mark.asyncio
async def test_record_quality_metrics_reads_global_evaluation_from_top_level_state_too():
    """agent_verifier_node writes verification_results at the top level;
    response_finalizer_node's global_evaluation can be read either from
    final_state directly or mirrored into execution_metadata (see
    global_evaluator.record_global_evaluation) -- must work from either."""
    session = _FakeSession()
    session_factory = MagicMock(return_value=session)

    await record_quality_metrics(
        session_factory,
        message_id=str(uuid.uuid4()),
        conversation_id=str(uuid.uuid4()),
        final_state={
            "organization_id": str(uuid.uuid4()),
            "global_evaluation": {"main": {"decision": "degraded_pass", "score": 0.4}},
        },
    )

    row: AIQualityMetric = session.added[0]
    assert row.grounding_score == 0.4
    assert row.grounding_decision == "degraded_pass"


@pytest.mark.asyncio
async def test_record_quality_metrics_never_raises_on_bad_input():
    # Missing message_id/conversation_id, or no session factory at all --
    # must be a silent no-op, not a crash that would break the message-save
    # path this is called from.
    await record_quality_metrics(MagicMock(), message_id="", conversation_id="", final_state={})
    await record_quality_metrics(None, message_id="x", conversation_id="y", final_state={})


@pytest.mark.asyncio
async def test_record_quality_metrics_never_raises_when_session_errors():
    session = _FakeSession()
    session.commit = AsyncMock(side_effect=RuntimeError("db down"))
    session_factory = MagicMock(return_value=session)

    # Must not raise -- telemetry can never break the request it's measuring.
    await record_quality_metrics(
        session_factory,
        message_id=str(uuid.uuid4()),
        conversation_id=str(uuid.uuid4()),
        final_state={"organization_id": str(uuid.uuid4())},
    )


@pytest.mark.asyncio
async def test_update_feedback_reaction_never_raises_on_bad_input():
    await update_feedback_reaction(MagicMock(), message_id="", reaction="like")
    await update_feedback_reaction(None, message_id="x", reaction="like")
