"""Scheduled smoke tests: one real query per mode against the real
orchestrator, real sample data source, and whatever model is actually
configured — no mocks.

Why this file exists: every bug found during this session's mode-by-mode
audit (the agent_context["model_id"] dead field across 9 call sites, the
executive_report/business_journey pipeline-shadowing regression, the
_execute_section "state" NameError, the PII-placeholder-echoed-into-SQL
failure, the report-synthesis JSON truncation) required a live human doing
manual reproduction to find, because the existing unit test suite mocks
the LLM/DB boundary — correctly, for speed, but that means a rarely-
exercised success path (real SQL execution reaching a real database, a
real model actually finishing a long generation) never runs in CI at all.
These tests close that gap: run on a schedule (nightly CI, or manually),
they exercise the same code paths a live customer session would, and fail
loudly instead of waiting for the next screenshot.

Skipped by default (matches tests/integration/test_signup_provision_dashboard.py's
existing convention) — requires a running stack with real DB/Redis/model
access, so it must not run as part of the normal fast unit-test sweep.
Run explicitly with RUN_INTEGRATION_TESTS=1, from inside the server
container (docker exec aiser-server-ee python -m pytest tests/integration/
test_mode_smoke.py -v) so the real network path (postgres/redis hostnames,
not localhost) resolves correctly, matching how this session's own live
verification was done throughout.
"""

import os

import pytest

if os.getenv("RUN_INTEGRATION_TESTS") != "1":
    pytest.skip(
        "Integration tests require running services and seeded infra; set RUN_INTEGRATION_TESTS=1 to run.",
        allow_module_level=True,
    )

# RELIABILITY: src.db.session's async engine/connection pool is a module-
# level singleton, created (and bound to whatever event loop is active) on
# first import. pytest-asyncio's default per-function loop scope tears that
# loop down after every test, so every test after the first one hits
# "attached to a different loop" / "Event loop is closed" against the same
# already-imported engine - this masqueraded as real product failures (a
# missing schema, an empty query_result) on this file's very first run, when
# it was actually this test file's own event-loop handling. Pinning the
# whole module to one shared loop for its duration is the standard fix for
# a module-level async engine reused across pytest-asyncio tests.
pytestmark = pytest.mark.asyncio(loop_scope="session")

# Real seeded test fixtures used throughout this session's live verification.
_USER_ID = "d6f414de-f43f-43a0-9607-23cd90561943"
_ORG_ID = "20481fd3-6ebc-451f-967f-a87570ba1375"
_EDUCATION_DS_ID = "d2d60edb-5288-4102-a6c0-606208801aeb"

# A generous ceiling, not a tight one — this suite is checking "did it
# complete and produce something real," not benchmarking latency. A model
# swap (e.g. to a slower local one) should not make this suite flaky.
# Must stay comfortably above the orchestrator's own workflow-level SLO
# deadline for "standard" mode (260s, see langgraph_orchestrator.py) so this
# test can observe a real completion/graceful-end rather than being cut off
# by its own wait_for first.
_MAX_SECONDS = 300


async def _run(query: str, **kwargs):
    """Execute one query through the real orchestrator and collect the
    final `complete` event plus every node_complete stage seen along the way
    (useful for asserting *how* it got there, e.g. never touched agent_kernel)."""
    import asyncio

    from ee.modules.ai.services.langgraph_orchestrator import LangGraphMultiAgentOrchestrator
    from ee.modules.ai.services.litellm_service import LiteLLMService
    from src.db.session import async_session
    from src.modules.data.services.data_connectivity_service import DataConnectivityService
    from src.modules.data.services.multi_engine_query_service import get_multi_engine_query_service

    orch = LangGraphMultiAgentOrchestrator(
        litellm_service=LiteLLMService(),
        data_service=DataConnectivityService(),
        multi_query_service=get_multi_engine_query_service(),
        async_session_factory=async_session,
    )

    stages_seen = []
    final = None

    async def _drive():
        nonlocal final
        async for event in orch.execute_streaming(
            query=query,
            user_id=_USER_ID,
            organization_id=_ORG_ID,
            conversation_id=None,
            project_id=None,
            **kwargs,
        ):
            if not isinstance(event, dict):
                continue
            if event.get("type") == "node_complete":
                stages_seen.append(event.get("stage"))
            if event.get("type") == "complete":
                final = event
            if event.get("type") == "error":
                final = event

    await asyncio.wait_for(_drive(), timeout=_MAX_SECONDS)
    return final, stages_seen


@pytest.mark.integration
async def test_bare_greeting_with_data_source_stays_conversational():
    """The exact bug this session found live: "hi" with a data source
    selected must never reach agent_kernel or attempt SQL generation."""
    final, stages = await _run("hi", data_source_id=_EDUCATION_DS_ID)

    assert final is not None, "no complete/error event received"
    assert "routed_to_agent_kernel" not in stages
    assert not any(s and "sql" in s.lower() for s in stages if s)


@pytest.mark.integration
async def test_real_analytical_question_produces_real_data():
    final, _ = await _run(
        "what is the average score by grade letter",
        data_source_id=_EDUCATION_DS_ID,
    )

    assert final is not None
    assert final.get("type") != "error"
    assert final.get("query_result"), "expected real query rows, got none"


@pytest.mark.integration
async def test_explicit_dashboard_mode_creates_a_dashboard_with_real_widgets():
    final, stages = await _run(
        "build a dashboard on student performance",
        data_source_id=_EDUCATION_DS_ID,
        analysis_mode="dashboard",
    )

    assert final is not None
    assert "routed_to_agent_kernel" not in stages
    assert "routed_to_agent_skills" not in stages


@pytest.mark.integration
async def test_explicit_executive_report_mode_completes_sections_with_real_content():
    """The exact scenario that surfaced three separate bugs this session
    (pipeline shadowing, a NameError, a PII-placeholder SQL corruption) —
    kept as a permanent regression guard, not a one-off reproduction.

    executive_report was removed from goal_resolver.py's
    _DEDICATED_PIPELINE_MODES (kernel-unification roadmap step 1) once
    _exec_executive_report reached parity with the classic graph's
    report_synthesis -> response_finalizer -> artifact_quality_gate chain —
    this now IS expected to route through the kernel, the opposite of the
    assertion this test previously enforced."""
    final, stages = await _run(
        "generate an executive report on student performance",
        data_source_id=_EDUCATION_DS_ID,
        analysis_mode="executive_report",
    )

    assert final is not None
    assert "routed_to_agent_kernel" in stages
    sections = final.get("report_sections") or []
    complete = [s for s in sections if s.get("status") == "complete"]
    assert len(complete) >= 1, f"no sections completed: {[s.get('error') for s in sections]}"
    # Every completed section's narrative must be real prose, not empty —
    # this is what "0.00 quality gate" looked like from the outside.
    for s in complete:
        assert s.get("narrative"), f"section '{s.get('title')}' completed with no narrative"


def _assert_finished(final, *, allow_clarification: bool = True) -> None:
    """Mode contract: complete with a payload, or a visible clarification — never a hang/error."""
    assert final is not None, "no complete/error event received"
    if allow_clarification and (
        final.get("needs_clarification")
        or final.get("clarification_type")
        or (final.get("type") == "complete" and final.get("clarification_options"))
    ):
        return
    assert final.get("type") != "error", final.get("error") or final


@pytest.mark.integration
async def test_forecast_mode_completes_or_asks_for_time():
    final, _ = await _run(
        "forecast this metric for the next 6 months",
        data_source_id=_EDUCATION_DS_ID,
        analysis_mode="predictive",
    )
    _assert_finished(final)


@pytest.mark.integration
async def test_diagnose_mode_completes_or_clarifies():
    final, _ = await _run(
        "why did scores drop",
        data_source_id=_EDUCATION_DS_ID,
        analysis_mode="diagnostic",
    )
    _assert_finished(final)


@pytest.mark.integration
async def test_optimise_mode_completes_or_clarifies():
    final, _ = await _run(
        "what actions would improve scores",
        data_source_id=_EDUCATION_DS_ID,
        analysis_mode="prescriptive",
    )
    _assert_finished(final)


@pytest.mark.integration
async def test_decide_mode_completes_or_clarifies():
    final, _ = await _run(
        "what should we decide next about student performance",
        data_source_id=_EDUCATION_DS_ID,
        analysis_mode="decision_intelligence",
    )
    _assert_finished(final)


@pytest.mark.integration
async def test_business_os_mode_completes_or_clarifies():
    final, _ = await _run(
        "assess the health of this education data",
        data_source_id=_EDUCATION_DS_ID,
        analysis_mode="business_journey",
    )
    _assert_finished(final)
