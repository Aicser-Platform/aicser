"""Considerations: every answer states what it assumed, noticed and skipped — in plain words."""

from ee.modules.ai.utils.considerations import build_considerations, degradation_note


def _rows(n=12):
    return [{"period": f"2024-{m:02d}-01", "value": 100 + m} for m in range(1, n + 1)]


def test_assumptions_come_from_resolved_fields_and_rows():
    state = {
        "execution_metadata": {"mode_parameters": {"target_metric": "principal_amount", "metric_aggregation": "sum",
                                                   "focus_dimension": "branch_name"}},
        "analytics_metadata": {},
        "query_result": [dict(r, branch_name=f"B{i % 2}") for i, r in enumerate(_rows())],
    }
    items = build_considerations(state)
    texts = [i["text"] for i in items]
    assert "Measured total principal amount." in texts
    assert "Compared by branch name." in texts
    assert any(t.startswith("Used data from 2024-01-01 to 2024-12-01") for t in texts)
    assert all(i.get("prompt") for i in items if i["kind"] == "assumption")


def test_skipped_forecast_explains_why():
    state = {"execution_metadata": {}, "analytics_metadata": {"predictive_skipped": True},
             "query_result": [{"branch": "A", "value": 1}, {"branch": "B", "value": 2}]}
    item = next(i for i in build_considerations(state) if i["kind"] == "skipped")
    assert "time series" in item["text"]


def test_brief_assumptions_gaps_and_review_lead():
    state = {
        "execution_metadata": {"decision_review": {"band": "surface", "summary": "Solid enough to act on with care."},
                               "result_caveats": ["Some rows repeat after a join."]},
        "analytics_metadata": {},
        "decision_brief": {"assumptions": [{"assumption": "Top branch = Branch 5 by total principal",
                                            "change_prompt": "Use Branch 4 instead"}],
                           "information_gaps": [{"question": "What budget is available?", "impact": "sizes the expansion"}]},
    }
    items = build_considerations(state)
    assert items[0]["kind"] == "review"
    kinds = [i["kind"] for i in items]
    assert {"assumption", "gap", "caveat"} <= set(kinds)
    gap = next(i for i in items if i["kind"] == "gap")
    assert gap["prompt"] and "sizes the expansion" in gap["text"]


def test_degradation_note_has_no_internal_ids():
    note = degradation_note({"original_analytics_type": "diagnostic_prescriptive_predictive",
                             "mode_degraded_to": "descriptive", "degradation_reason": "mode_requirements_not_met"})
    assert "Decide" in note and "Analyze" in note
    assert "_" not in note


def test_internal_aliases_never_reach_the_user():
    state = {
        "execution_metadata": {"mode_parameters": {"target_metric": "value", "focus_dimension": "focus_dimension"}},
        "analytics_metadata": {},
        "query_result": _rows(),
    }
    texts = " ".join(i["text"] for i in build_considerations(state))
    assert "value" not in texts.lower().replace("values", "") and "focus dimension" not in texts.lower()


def test_bare_name_gets_its_table_and_grouping_only_when_grouped():
    mp = {"target_metric": "principal_amount", "focus_dimension": "name", "focus_dimension_table": "banking.branches"}
    grouped = [{"period": f"2024-{m:02d}-01", "focus_dimension": f"Branch {b}", "value": 1}
               for m in range(1, 4) for b in (1, 2)]
    texts = [i["text"] for i in build_considerations({"execution_metadata": {"mode_parameters": mp},
                                                       "analytics_metadata": {}, "query_result": grouped})]
    assert "Compared by branch name." in texts
    single = [i["text"] for i in build_considerations({"execution_metadata": {"mode_parameters": mp},
                                                       "analytics_metadata": {}, "query_result": _rows()})]
    assert not any(t.startswith("Compared by") for t in single)


def test_ai_search_without_documents_is_flagged_not_silent():
    from ee.modules.ai.utils.mode_quality import apply_mode_degradation

    state = {"execution_metadata": {}, "analytics_metadata": {}, "query_result": []}
    apply_mode_degradation(state, from_mode="ai_search", to_mode="descriptive",
                           reason="no documents are connected to search, so this answer comes from your data")
    state["execution_metadata"]["considerations_extra"] = [{"kind": "gap", "text": "Connect the documents you want searched."}]
    items = build_considerations(state)
    changed = next(i for i in items if i["kind"] == "changed")
    assert "AI Search" in changed["text"] and "Analyze" in changed["text"]
    assert any(i["kind"] == "gap" and "Connect the documents" in i["text"] for i in items)


def test_measure_comes_from_executed_sql_not_planner_params():
    state = {
        "execution_metadata": {"mode_parameters": {"target_metric": "current_balance"}},
        "analytics_metadata": {"column_display_names": {"focus_dimension": "Branches Name"}},
        "sql_query": 'SELECT d."name" AS focus_dimension, SUM(f."principal_amount") AS value FROM loans f',
        "query_result": [{"focus_dimension": "B1", "value": 1}, {"focus_dimension": "B2", "value": 2}],
    }
    texts = [i["text"] for i in build_considerations(state)]
    assert "Measured total principal amount." in texts
    assert not any("current_balance" in t or "current balance" in t for t in texts)


def test_metric_guard_change_is_disclosed():
    state = {"execution_metadata": {"metric_guard": {"column": "customer_id", "from": "sum", "to": "count_distinct"}},
             "analytics_metadata": {}, "query_result": []}
    item = next(i for i in build_considerations(state) if i["kind"] == "changed")
    assert "customer id" in item["text"] and "counting distinct instead of adding up" in item["text"]
