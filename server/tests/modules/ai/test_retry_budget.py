"""Shared wall-clock budget must stop retries before they overrun the turn."""

import time

from ee.modules.ai.config.workflow_config import WorkflowConfig
from ee.modules.ai.schemas.graph_state import (
    DEFAULT_RETRY_LIMITS,
    COMPLEX_RETRY_LIMITS,
    can_retry,
    remaining_workflow_budget_s,
)


def test_retry_caps_are_below_the_old_retry_as_quality_limits():
    assert DEFAULT_RETRY_LIMITS["sql_correction"] <= 2
    assert DEFAULT_RETRY_LIMITS["post_query_correction"] <= 2
    assert DEFAULT_RETRY_LIMITS["total_retries"] <= 10
    assert COMPLEX_RETRY_LIMITS["sql_correction"] <= 3
    assert COMPLEX_RETRY_LIMITS["total_retries"] <= 14


def test_standard_deadline_is_not_the_unused_ten_second_slo():
    assert WorkflowConfig.workflow_deadline_s("standard") == WorkflowConfig.WORKFLOW_DEADLINE_STANDARD_S
    assert WorkflowConfig.workflow_deadline_s("standard") >= 60
    assert WorkflowConfig.workflow_deadline_s("standard") > WorkflowConfig.SLO_SIMPLE_ANALYZE_S
    assert WorkflowConfig.workflow_deadline_s("executive_report") == WorkflowConfig.EXECUTIVE_REPORT_WORKFLOW_DEADLINE_S
    assert WorkflowConfig.workflow_deadline_s("conversational") == WorkflowConfig.WORKFLOW_DEADLINE_CHAT_S


def test_can_retry_denies_when_remaining_budget_is_under_fifteen_seconds():
    state = {
        "execution_metadata": {
            "mode": "standard",
            "unified_retry_state": {"sql_correction": 0, "total_retries": 0},
            "workflow_deadline_s": 180,
            "workflow_started_at_ts": time.time() - 170,
        }
    }
    remaining = remaining_workflow_budget_s(state)
    assert remaining is not None and remaining < 15
    assert can_retry(state, "sql_correction") is False


def test_can_retry_allows_when_budget_and_lane_remain():
    state = {
        "execution_metadata": {
            "mode": "standard",
            "unified_retry_state": {"sql_correction": 0, "total_retries": 0},
            "workflow_deadline_s": 180,
            "workflow_started_at_ts": time.time(),
        }
    }
    assert can_retry(state, "sql_correction") is True
