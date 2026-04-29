from src.modules.ai.utils.workflow_decisions import (
    response_finalizer_route,
    post_execution_route,
    error_correction_route,
    post_query_brain_route,
    mode_requirements_gate_route,
    clarification_route,
    multi_query_execution_route,
    multi_step_execution_route,
    insight_engine_route,
)


def _should_fail_fast(state):
    return bool(state.get("critical_failure"))


def _make_retry_fns(allowed_by_lane):
    retry_counters = {}

    def _can_retry(state, lane):
        return bool(allowed_by_lane.get(lane, False))

    def _increment_retry(state, lane):
        retry_counters[lane] = retry_counters.get(lane, 0) + 1
        state.setdefault("execution_metadata", {})
        state["execution_metadata"][f"{lane}_retries"] = retry_counters[lane]

    return _can_retry, _increment_retry


def _advance_plan_step(state, step, status, detail):
    state.setdefault("plan_steps", [])
    state["plan_steps"].append({"step": step, "status": status, "detail": detail})


def _get_retry_state(state):
    return dict(state.get("unified_retry_state") or {})


def _execution_strategy_for(state):
    analytics_type = str(state.get("analytics_type", "descriptive") or "descriptive")
    return "proceed_deep" if analytics_type in ("diagnostic", "predictive", "prescriptive", "animate") else "proceed_standard"


def _sanitize_rows(rows):
    return [{"_sanitized": True, **r} for r in rows]


def test_response_finalizer_route_approved():
    state = {
        "global_evaluation": {"main": {"decision": "approved"}},
        "output_evaluation": {"decision": "approved"},
    }
    assert response_finalizer_route(state) == "approved"


def test_response_finalizer_route_chart_error_sets_correction_context():
    state = {
        "global_evaluation": {"main": {"decision": "chart_error"}},
        "output_evaluation": {
            "decision": "chart_error",
            "reason": "Axis mismatch",
            "chart_issues": ["xAxis missing labels"],
        },
    }
    route = response_finalizer_route(state)
    assert route == "chart_error"
    ctx = state.get("correction_context")
    assert isinstance(ctx, dict)
    assert ctx.get("error_type") == "chart"
    assert ctx.get("instruction") == "Axis mismatch"
    assert ctx.get("flagged_issues") == ["xAxis missing labels"]


def test_response_finalizer_route_llm_down_degrades():
    state = {
        "global_evaluation": {"main": {"decision": "needs_regeneration"}},
        "output_evaluation": {"decision": "needs_regeneration"},
        "llm_service_down": True,
    }
    assert response_finalizer_route(state) == "degraded_pass"


def test_response_finalizer_route_missing_evaluation_degrades():
    state = {}
    assert response_finalizer_route(state) == "degraded_pass"


def test_response_finalizer_route_unknown_decision_degrades():
    state = {
        "global_evaluation": {"main": {"decision": "unknown_decision"}},
        "output_evaluation": {"decision": "unknown_decision"},
    }
    assert response_finalizer_route(state) == "degraded_pass"


def test_post_execution_route_has_data_prioritizes_completion():
    can_retry, increment_retry = _make_retry_fns({"query_execution": True, "sql_correction": True})
    state = {
        "query_result": [{"a": 1}, {"a": 2}],
        "error": "stale error",
        "query_execution_error": "stale exec error",
        "current_stage": "query_executed",
    }
    route = post_execution_route(
        state,
        should_fail_fast_fn=_should_fail_fast,
        can_retry_fn=can_retry,
        increment_retry_fn=increment_retry,
        advance_plan_step_fn=_advance_plan_step,
    )
    assert route == "has_data"
    assert state.get("current_stage") == "results_ready_for_evaluation"
    assert state.get("query_result_row_count") == 2
    assert state.get("error") is None
    assert state.get("query_execution_error") is None


def test_post_execution_route_truncated_sql_skips_sql_correction_lane():
    """Truncated / hopeless SQL must not route to error_correction (preserves sql_correction budget)."""
    can_retry, increment_retry = _make_retry_fns({"query_execution": True, "sql_correction": True})
    state = {
        "query_result": None,
        "query_execution_error": "Truncated SQL cannot be executed",
        "error": "SQL appears truncated",
        "sql_query": 'SELECT "broken',
        "current_stage": "query_execution_failed",
        "execution_metadata": {"mode": "complex", "unified_retry_state": {"sql_correction": 0, "total_retries": 0}},
    }
    route = post_execution_route(
        state,
        should_fail_fast_fn=_should_fail_fast,
        can_retry_fn=can_retry,
        increment_retry_fn=increment_retry,
        advance_plan_step_fn=_advance_plan_step,
    )
    assert route == "unrecoverable_sql"
    assert state.get("current_stage") == "unrecoverable_sql_shape"
    assert "retry_exhausted_diagnostic" not in (state.get("execution_metadata") or {})


def test_post_execution_route_transient_error_retries_execute_lane():
    can_retry, increment_retry = _make_retry_fns({"query_execution": True, "sql_correction": True})
    state = {
        "query_result": None,
        "query_execution_error": "Database timeout while reading",
        "current_stage": "query_execution_failed",
    }
    route = post_execution_route(
        state,
        should_fail_fast_fn=_should_fail_fast,
        can_retry_fn=can_retry,
        increment_retry_fn=increment_retry,
        advance_plan_step_fn=_advance_plan_step,
    )
    assert route == "retry_execute"
    assert state.get("current_stage") == "query_execution_retry"
    assert "Transient execution issue" in str(state.get("progress_message", ""))


def test_post_execution_route_budget_exhausted_with_force_guard():
    can_retry, increment_retry = _make_retry_fns(
        {"query_execution": False, "sql_correction": False, "force_execute": True}
    )
    state = {
        "query_result": None,
        "query_execution_error": "syntax error near FROM",
        "sql_query": "SELECT * FROM sales",
        "execution_metadata": {
            "mode": "standard",
            "unified_retry_state": {"sql_correction": 4, "total_retries": 3},
        },
    }
    route = post_execution_route(
        state,
        should_fail_fast_fn=_should_fail_fast,
        can_retry_fn=can_retry,
        increment_retry_fn=increment_retry,
        advance_plan_step_fn=_advance_plan_step,
    )
    assert route == "error_exhausted"
    assert state.get("current_stage") == "execution_failed_budget_exhausted"
    diag = (state.get("execution_metadata") or {}).get("retry_exhausted_diagnostic") or {}
    assert diag.get("primary_reason") in ("sql_correction_limit", "lane_and_total", "total_retries_circuit_breaker")
    assert diag.get("raw_error_preview")
    ufm = str(state.get("user_facing_message") or "")
    assert ufm
    assert "automatic" in ufm.lower() or "sql" in ufm.lower()


def test_error_correction_route_proceed_with_data_on_failed_correction():
    can_retry, increment_retry = _make_retry_fns({"chart_correction": True, "force_execute": True})
    state = {
        "current_stage": "sql_correction_failed",
        "query_result": [{"region": "APAC", "value": 10}],
        "error": "some correction error",
        "correction_context": {"instruction": "fix sql"},
        "execution_metadata": {"mode": "standard"},
        "unified_retry_state": {"total_retries": 1},
    }
    route = error_correction_route(
        state,
        should_fail_fast_fn=_should_fail_fast,
        get_retry_state_fn=_get_retry_state,
        can_retry_fn=can_retry,
        increment_retry_fn=increment_retry,
        default_retry_limits={"total_retries": 8},
        complex_retry_limits={"total_retries": 12},
    )
    assert route == "proceed_with_data"
    assert state.get("current_stage") == "proceed_with_data"
    assert state.get("error") is None
    assert state.get("correction_context") is None


def test_error_correction_route_force_execute_guard():
    can_retry, increment_retry = _make_retry_fns({"chart_correction": False, "force_execute": True})
    state = {
        "current_stage": "error_corrected",
        "query_result": [],
        "sql_query": "SELECT count(*) FROM t",
        "execution_metadata": {"mode": "standard"},
        "unified_retry_state": {"total_retries": 1},
        "error": "still failed",
        "error_code": "SQL_EXEC",
    }
    route = error_correction_route(
        state,
        should_fail_fast_fn=_should_fail_fast,
        get_retry_state_fn=_get_retry_state,
        can_retry_fn=can_retry,
        increment_retry_fn=increment_retry,
        default_retry_limits={"total_retries": 8},
        complex_retry_limits={"total_retries": 12},
    )
    assert route == "force_execute"
    assert state.get("current_stage") == "force_execute_sql"
    assert "Executing SQL query" in str(state.get("progress_message", ""))


def test_error_correction_route_chart_corrected_requires_retry_budget():
    can_retry, increment_retry = _make_retry_fns({"chart_correction": True, "force_execute": False})
    state = {
        "current_stage": "chart_corrected",
        "echarts_config": {"series": []},
        "execution_metadata": {"mode": "standard"},
        "unified_retry_state": {"total_retries": 0},
    }
    route = error_correction_route(
        state,
        should_fail_fast_fn=_should_fail_fast,
        get_retry_state_fn=_get_retry_state,
        can_retry_fn=can_retry,
        increment_retry_fn=increment_retry,
        default_retry_limits={"total_retries": 8},
        complex_retry_limits={"total_retries": 12},
    )
    assert route == "chart_corrected"


def test_post_query_brain_route_correction_needed():
    state = {"current_stage": "post_query_correction_needed", "query_result": [{"a": 1}]}
    route = post_query_brain_route(
        state,
        should_fail_fast_fn=_should_fail_fast,
        execution_strategy_for_fn=_execution_strategy_for,
    )
    assert route == "correction_needed"


def test_post_query_brain_route_unrecoverable_with_data_promotes():
    state = {
        "current_stage": "post_query_unrecoverable",
        "query_result": [{"a": 1}],
        "analytics_type": "diagnostic",
        "error": "semantic mismatch",
    }
    route = post_query_brain_route(
        state,
        should_fail_fast_fn=_should_fail_fast,
        execution_strategy_for_fn=_execution_strategy_for,
    )
    assert route == "proceed_deep"
    assert state.get("current_stage") == "post_query_approved"
    assert state.get("error") is None


def test_post_query_brain_route_no_data_unrecoverable():
    state = {"current_stage": "post_query_unrecoverable", "query_result": []}
    route = post_query_brain_route(
        state,
        should_fail_fast_fn=_should_fail_fast,
        execution_strategy_for_fn=_execution_strategy_for,
    )
    assert route == "unrecoverable"


def test_mode_requirements_gate_route_critical_failure():
    state = {"critical_failure": True, "current_stage": "mode_requirements_not_met"}
    assert mode_requirements_gate_route(state, auto_execution_enabled=True) == "graceful_response"


def test_mode_requirements_gate_route_auto_degrades_with_data():
    state = {
        "current_stage": "mode_requirements_not_met",
        "query_result": [{"value": 10}],
        "analytics_type": "predictive",
        "execution_metadata": {"trace_id": "t1"},
    }
    route = mode_requirements_gate_route(state, auto_execution_enabled=True)
    assert route == "proceed"
    assert state.get("analytics_type") == "descriptive"
    assert state.get("current_stage") == "mode_requirements_auto_proceed"
    meta = state.get("execution_metadata") or {}
    assert meta.get("mode_degraded") is True
    assert meta.get("degradation_reason") == "mode_requirements_not_met"


def test_mode_requirements_gate_route_no_auto_but_has_data():
    state = {
        "current_stage": "mode_requirements_not_met",
        "query_result": [{"value": 10}],
        "analytics_type": "diagnostic",
    }
    route = mode_requirements_gate_route(state, auto_execution_enabled=False)
    assert route == "proceed"
    assert state.get("analytics_type") == "descriptive"
    assert state.get("current_stage") == "mode_requirements_passed"


def test_mode_requirements_gate_route_no_data_clarifies():
    state = {"current_stage": "mode_requirements_not_met", "query_result": []}
    assert mode_requirements_gate_route(state, auto_execution_enabled=True) == "clarify"


def test_clarification_route_validation_failed_loops_back():
    state = {"clarification_validation_failed": True}
    assert clarification_route(state) == "clarification"
    assert "clarification_validation_failed" not in state


def test_clarification_route_with_response_goes_to_nl2sql():
    state = {"clarification_response": {"time_column": "order_date"}}
    assert clarification_route(state) == "nl2sql"


def test_clarification_route_with_data_proceeds():
    state = {
        "query_result": [{"a": 1}],
        "needs_clarification": True,
    }
    route = clarification_route(state)
    assert route == "proceed"
    assert state.get("current_stage") == "clarification_fallback_with_data"
    assert "Building chart and insights" in str(state.get("progress_message", ""))
    assert "needs_clarification" not in state


def test_clarification_route_without_data_graceful():
    state = {"query_result": []}
    assert clarification_route(state) == "graceful_response"


def test_multi_query_execution_route_complete_proceeds():
    state = {"current_stage": "multi_query_complete"}
    assert (
        multi_query_execution_route(
            state,
            sanitize_query_result_rows_fn=_sanitize_rows,
        )
        == "proceed"
    )


def test_multi_query_execution_route_critical_failure_failed():
    state = {"critical_failure": True, "current_stage": "multi_query_complete"}
    assert (
        multi_query_execution_route(
            state,
            sanitize_query_result_rows_fn=_sanitize_rows,
        )
        == "failed"
    )


def test_multi_query_execution_route_unexpected_stage_proceeds_with_warning():
    state = {"current_stage": "unexpected_stage", "execution_metadata": {}}
    assert (
        multi_query_execution_route(
            state,
            sanitize_query_result_rows_fn=_sanitize_rows,
        )
        == "proceed"
    )
    w = (state.get("execution_metadata") or {}).get("warnings") or []
    assert any("unexpected multi_query stage" in str(x).lower() for x in w)


def test_multi_query_execution_route_failed_with_query_result_degrades():
    state = {
        "current_stage": "multi_query_failed",
        "query_result": [{"k": 1}],
        "analytics_type": "predictive",
        "error": "subquery error",
        "error_code": "SUBQ_FAIL",
        "execution_metadata": {"trace_id": "x"},
    }
    route = multi_query_execution_route(
        state,
        sanitize_query_result_rows_fn=_sanitize_rows,
    )
    assert route == "proceed"
    assert state.get("analytics_type") == "descriptive"
    assert state.get("current_stage") == "multi_query_fallback_to_base"
    assert state.get("error") is None
    assert state.get("error_code") is None
    meta = state.get("execution_metadata") or {}
    assert meta.get("mode_degraded") is True
    assert meta.get("degradation_reason") == "multi_query_failed"


def test_multi_query_execution_route_failed_with_base_dataset_degrades():
    state = {
        "current_stage": "multi_query_failed",
        "query_result": [],
        "analysis_datasets": {"base": {"data": [{"k": 1}]}},
        "analytics_type": "diagnostic",
        "execution_metadata": {"trace_id": "y"},
    }
    route = multi_query_execution_route(
        state,
        sanitize_query_result_rows_fn=_sanitize_rows,
    )
    assert route == "proceed"
    assert state.get("analytics_type") == "descriptive"
    assert state.get("current_stage") == "multi_query_fallback_to_base"
    qr = state.get("query_result")
    assert isinstance(qr, list) and qr and qr[0].get("_sanitized") is True


def test_multi_query_execution_route_failed_without_any_data():
    state = {
        "current_stage": "multi_query_failed",
        "query_result": [],
        "analysis_datasets": {"base": {"data": []}},
    }
    assert (
        multi_query_execution_route(
            state,
            sanitize_query_result_rows_fn=_sanitize_rows,
        )
        == "failed"
    )


def test_multi_step_execution_route_failed():
    state = {"current_stage": "multi_step_failed"}
    assert multi_step_execution_route(state) == "failed"


def test_multi_step_execution_route_proceed():
    state = {"current_stage": "multi_step_complete"}
    assert multi_step_execution_route(state) == "proceed"


def test_insight_engine_route_critical_failure():
    state = {"critical_failure": True}
    assert insight_engine_route(state, should_fail_fast_fn=_should_fail_fast) == "unrecoverable"


def test_insight_engine_route_error_with_chart_degrades_to_proceed():
    state = {
        "error": "insight model failure",
        "executive_summary": "",
        "echarts_config": {"series": []},
    }
    route = insight_engine_route(state, should_fail_fast_fn=_should_fail_fast)
    assert route == "proceed"
    assert state.get("error") is None
    assert "created a chart" in str(state.get("executive_summary", "")).lower()


def test_insight_engine_route_error_without_chart_unrecoverable():
    state = {"error": "insight failure", "executive_summary": "", "echarts_config": None}
    assert insight_engine_route(state, should_fail_fast_fn=_should_fail_fast) == "unrecoverable"


def test_insight_engine_route_summary_or_data_or_chart_proceed():
    with_summary = {"executive_summary": "Revenue increased"}
    assert insight_engine_route(with_summary, should_fail_fast_fn=_should_fail_fast) == "proceed"

    with_data = {"executive_summary": "", "query_result": [{"a": 1}]}
    assert insight_engine_route(with_data, should_fail_fast_fn=_should_fail_fast) == "proceed"

    with_chart = {"executive_summary": "", "query_result": [], "echarts_config": {"series": []}}
    assert insight_engine_route(with_chart, should_fail_fast_fn=_should_fail_fast) == "proceed"

    empty = {"executive_summary": "", "query_result": [], "echarts_config": None}
    assert insight_engine_route(empty, should_fail_fast_fn=_should_fail_fast) == "unrecoverable"


def test_increment_retry_post_query_skips_total_retries():
    from src.modules.ai.schemas.graph_state import increment_retry

    state: dict = {"execution_metadata": {"unified_retry_state": {"total_retries": 5}}}
    increment_retry(state, "post_query_correction", count_toward_total=False)
    rs = state["execution_metadata"]["unified_retry_state"]
    assert rs["post_query_correction"] == 1
    assert rs["total_retries"] == 5


def test_explain_retry_block_flags_total_circuit_breaker():
    from src.modules.ai.schemas.graph_state import DEFAULT_RETRY_LIMITS, explain_retry_block

    cap = int(DEFAULT_RETRY_LIMITS["total_retries"])
    state = {
        "execution_metadata": {
            "mode": "standard",
            "unified_retry_state": {"sql_correction": 0, "total_retries": cap},
        }
    }
    d = explain_retry_block(state, "sql_correction")
    assert d["blocked_by_total"] is True
    assert d["blocked_by_lane"] is False
    assert d["primary_reason"] == "total_retries_circuit_breaker"

