"""LangGraph routing tests for dashboard PESD subgraph."""

import pytest

pytest.importorskip("langgraph")

from src.modules.ai.config.workflow_config import get_effective_analytics_type


def test_dashboard_mode_analytics_type():
    assert get_effective_analytics_type(None, "dashboard") == "descriptive"


def test_executive_report_analytics_type():
    assert get_effective_analytics_type(None, "executive_report") == "executive_report"


def test_query_cache_digest_only_standard_mode():
    from src.modules.ai.utils.tenant_cache import build_query_cache_digest

    assert build_query_cache_digest("q", "ds", "dashboard", "descriptive") == ""
    assert build_query_cache_digest("q", "ds", "standard", "descriptive")
