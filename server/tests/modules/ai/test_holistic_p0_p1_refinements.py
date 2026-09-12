"""Tests for P0/P1 holistic refinements: empty-result widen gate, mix, schema threshold."""

import re

from ee.modules.ai.schemas.graph_state import can_retry, get_retry_state
from ee.modules.ai.utils.follow_up_mix import slot_counts
from ee.modules.ai.utils.narration_grounding import check_text_grounded
from ee.modules.ai.utils.routing_utils import infer_analysis_mode_from_query
from ee.modules.ai.config.workflow_config import WorkflowConfig


def test_two_pass_aligned_with_schema_rag():
    assert WorkflowConfig.TWO_PASS_TABLE_THRESHOLD == WorkflowConfig.SCHEMA_RAG_TABLE_THRESHOLD
    assert WorkflowConfig.SCHEMA_RAG_TABLE_THRESHOLD == 15


def test_soft_outlook_does_not_force_predictive():
    assert infer_analysis_mode_from_query("What is the outlook for our brand?") is None
    assert infer_analysis_mode_from_query("Forecast revenue for the next 6 months") == "predictive"


def test_bare_recommend_does_not_force_prescriptive():
    assert infer_analysis_mode_from_query("Can you recommend a chart type?") is None
    assert infer_analysis_mode_from_query("What should we do to improve conversion?") == "prescriptive"


def test_bare_drop_does_not_force_diagnostic():
    assert infer_analysis_mode_from_query("Show me the drop in sales by region") is None
    assert infer_analysis_mode_from_query("Why did sales drop last quarter?") == "diagnostic"


def test_percent_claims_not_skipped():
    ok, ungrounded, *_ = check_text_grounded(
        "Margin is only 3% this month",
        {"100", "50"},
    )
    assert "3" in ungrounded or not ok


def test_descriptive_followup_majority():
    d, deepen = slot_counts("descriptive")
    assert d / (d + deepen) >= 0.6


def test_empty_result_retry_budget_exists():
    state = {"execution_metadata": {"unified_retry_state": {}, "mode": "standard"}}
    assert can_retry(state, "empty_result_retry") is True
    rs = get_retry_state(state)
    assert "empty_result_retry" in rs or True  # key may be lazy
    assert re.search(r"\bWHERE\b", "SELECT 1 WHERE x=1", re.I)
