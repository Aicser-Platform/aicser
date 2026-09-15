"""Regression: NL2SQL must fail fast on a hung provider, not sit on
timeout_for(max_tokens=32k) = 90s then retry the same budget on a second
model. Live-reproduced as 'Generating SQL query...' for 2–3 minutes on a
top-10 question while glm-5.3-flash timed out at 90s and qwen started
another 90s attempt.
"""

import pathlib
import re

from ee.modules.ai.config.workflow_config import WorkflowConfig


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


def test_fast_path_uses_short_sql_timeout_not_token_scaled_90s():
    text = _nl2sql_source()
    assert "SQL_TIMEOUT_STANDARD" in text
    assert WorkflowConfig.SQL_TIMEOUT_STANDARD <= 45.0
    assert WorkflowConfig.SQL_TIMEOUT_STANDARD >= 30.0
    assert WorkflowConfig.SQL_MAX_TOKENS_STANDARD <= 8192
    assert WorkflowConfig.SQL_MAX_TOKENS_ENTERPRISE >= WorkflowConfig.SQL_MAX_TOKENS_STANDARD


def test_fast_path_timeout_is_wired_from_adaptive_budget():
    text = _nl2sql_source()
    assert "resolve_sql_gen_budget" in text
    assert "sql_gen_budget" in text
    assert WorkflowConfig.SQL_TIMEOUT_ENTERPRISE <= 90.0
    assert WorkflowConfig.SQL_TIMEOUT_ENTERPRISE > WorkflowConfig.SQL_TIMEOUT_STANDARD


def test_node_level_wrapper_timeout_exceeds_single_call_local_budget():
    """Outer node ceiling must allow elevated retry + local-model headroom."""
    text = _nl2sql_source()
    assert "timeout_seconds=_NL2SQL_NODE_TIMEOUT_S" in text
    match = re.search(
        r'_NL2SQL_NODE_TIMEOUT_S\s*=\s*float\(\s*os\.getenv\(\s*"AISER_NL2SQL_NODE_TIMEOUT_S"\s*,\s*"([\d.]+)"',
        text,
    )
    assert match, "NL2SQL node timeout default not found"
    outer_timeout = float(match.group(1))
    assert outer_timeout >= 180.0
    assert outer_timeout >= WorkflowConfig.SQL_TIMEOUT_ENTERPRISE * 2


def test_standard_mode_workflow_slo_exceeds_nl2sql_node_level_timeout():
    """Whole-workflow deadline must stay above the NL2SQL node ceiling."""
    assert WorkflowConfig.WORKFLOW_DEADLINE_STANDARD_S > WorkflowConfig.NL2SQL_NODE_TIMEOUT_S
    assert WorkflowConfig.NL2SQL_NODE_TIMEOUT_S >= 180.0
