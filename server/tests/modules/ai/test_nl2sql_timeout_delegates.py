"""Regression test: nl2sql_node's fast-path SQL-generation call must not
pass a fixed WorkflowConfig.SQL_TIMEOUT_STANDARD/FILE timeout (40.0/60.0s),
found live via the integration smoke suite after fixing the
skill_executor_node service-wiring bug: with schema/services finally
reaching nl2sql_node, the next failure was `nl2sql_node timed out after
45.0s` — the node-level wrapper alone wasn't the whole story. The fast-path
LLM call (and its two truncation-retry calls) explicitly passed
timeout=_timeout, where _timeout was a fixed 40.0/60.0 read from
WorkflowConfig — silently re-breaking the local-vs-cloud timeout fix already
applied at generate_completion's own default (see test_local_model_timeout.py):
an explicit non-None timeout kwarg always wins over that default's
llm_call_budget.timeout_for() resolution, so a local model's fast-path SQL
generation (sql_max_tokens defaults to 32768, mapping to a 180s local budget)
was still being killed at 40s.

Fixed by setting _timeout = None unconditionally, so generate_completion
resolves it itself via timeout_for(max_tokens, is_local) — the same
delegation pattern already used by executive_report_planner_node/
execution_node/synthesis_node this session.

This is a source-scan guard, not a full nl2sql_node invocation test — the
function has ~40 real dependencies (schema RAG, embedding scoring, few-shot
retrieval, validation) that make a realistic in-process fixture impractical;
the actual end-to-end behavior is covered by
tests/integration/test_mode_smoke.py::test_real_analytical_question_produces_real_data.
"""

import pathlib
import re


def _nl2sql_source() -> str:
    path = (
        pathlib.Path(__file__).resolve().parents[3]
        / "ee"
        / "modules"
        / "ai"
        / "nodes"
        / "nl2sql_node.py"
    )
    return path.read_text(encoding="utf-8")


def test_fast_path_timeout_is_none_not_a_fixed_workflow_config_value():
    text = _nl2sql_source()
    assert "_timeout = None" in text
    assert "_timeout = WorkflowConfig.SQL_TIMEOUT_FILE if _is_file_src_tokens else WorkflowConfig.SQL_TIMEOUT_STANDARD" not in text


def test_node_level_wrapper_timeout_exceeds_single_call_local_budget():
    """The outer @handle_node_errors(timeout_seconds=...) ceiling must stay
    above the largest single llm_call_budget.timeout_for() tier (180s local,
    see test_llm_call_budget.py) or a correctly-budgeted local-model call
    gets killed by the outer wrapper before the inner budget ever matters —
    exactly what a 45s (then 120s) outer cap did."""
    text = _nl2sql_source()
    match = re.search(
        r'@handle_node_errors\(retry_on_error=True, max_retries=1, timeout_seconds=([\d.]+)\)\s*\nasync def nl2sql_node\(',
        text,
    )
    assert match, "nl2sql_node's @handle_node_errors decorator not found in expected form"
    outer_timeout = float(match.group(1))
    assert outer_timeout > 180.0


def test_standard_mode_workflow_slo_exceeds_nl2sql_node_level_timeout():
    """The whole-workflow SLO deadline (langgraph_orchestrator.py) for
    "standard" mode must stay above nl2sql_node's own node-level timeout, or
    the workflow force-ends before a legitimately slow (e.g. local-model)
    nl2sql attempt — or its AgentExecutor fallback — can ever finish. Found
    live: a hallucination-triggered fallback path took 185.9s and got cut
    off by a still-150s workflow SLO after the node-level cap had already
    been raised to 200s, producing "query returned no results" for a request
    that was still legitimately in flight."""
    nl2sql_text = _nl2sql_source()
    node_match = re.search(
        r'@handle_node_errors\(retry_on_error=True, max_retries=1, timeout_seconds=([\d.]+)\)\s*\nasync def nl2sql_node\(',
        nl2sql_text,
    )
    assert node_match
    node_timeout = float(node_match.group(1))

    orch_path = (
        pathlib.Path(__file__).resolve().parents[3]
        / "ee"
        / "modules"
        / "ai"
        / "services"
        / "langgraph_orchestrator.py"
    )
    orch_text = orch_path.read_text(encoding="utf-8")
    slo_match = re.search(r'_workflow_deadline_s\s*=\s*\(\s*([\d.]+)\s*\n\s*if analysis_mode == "standard"', orch_text)
    assert slo_match, "standard-mode workflow SLO deadline not found in expected form"
    standard_slo = float(slo_match.group(1))

    assert standard_slo > node_timeout
