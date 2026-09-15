"""Parallel chart+insight merge must keep both branches' metadata and plan status."""

from ee.modules.ai.nodes.chart_builder_node import should_skip_chart_by_plan
from ee.modules.ai.orchestrator.graph_builder import (
    isolate_workflow_branch,
    merge_execution_metadata,
    merge_execution_plans,
)


def test_isolate_workflow_branch_copies_metadata_not_query_result_identity_for_nested():
    state = {
        "query_result": [{"n": 1}],
        "execution_metadata": {"needs_chart": True, "mode_parameters": {"k": 1}},
        "execution_plan": [{"id": "visualize", "status": "active"}],
    }
    branch = isolate_workflow_branch(state)
    branch["execution_metadata"]["chart_sampled"] = True
    branch["execution_metadata"]["mode_parameters"]["k"] = 9
    branch["execution_plan"][0]["status"] = "complete"
    assert state["execution_metadata"].get("chart_sampled") is None
    assert state["execution_metadata"]["mode_parameters"]["k"] == 1
    assert state["execution_plan"][0]["status"] == "active"
    assert branch["query_result"] is state["query_result"]


def test_merge_execution_metadata_keeps_chart_and_insight_keys():
    merged = merge_execution_metadata(
        {"sql_band": "simple"},
        {"chart_sampled": True, "chart_description": "bar"},
        {"generation_method": "llm", "data_facts": ["x"]},
    )
    assert merged["chart_sampled"] is True
    assert merged["chart_description"] == "bar"
    assert merged["generation_method"] == "llm"
    assert merged["sql_band"] == "simple"


def test_merge_execution_plans_complete_wins_over_active():
    merged = merge_execution_plans(
        [{"id": "visualize", "status": "active"}, {"id": "narrate", "status": "active"}],
        [{"id": "visualize", "status": "complete"}],
        [{"id": "visualize", "status": "active"}, {"id": "narrate", "status": "complete"}],
    )
    by_id = {s["id"]: s["status"] for s in merged}
    assert by_id["visualize"] == "complete"
    assert by_id["narrate"] == "complete"


def test_should_not_skip_chart_for_multi_row_ranking():
    assert should_skip_chart_by_plan(needs_chart=False, is_kpi=False, row_count=10) is False
    assert should_skip_chart_by_plan(needs_chart=False, is_kpi=False, row_count=1) is True
    assert should_skip_chart_by_plan(needs_chart=False, is_kpi=True, row_count=1) is False
    assert should_skip_chart_by_plan(needs_chart=True, is_kpi=False, row_count=10) is False
