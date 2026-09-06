"""Regression test: executive report section statistics now include robust
outlier detection, not just sum/avg/median/concentration.

Before this, _compute_data_statistics computed decent concentration
(top-3 share) and period-over-period trend context, but had no anomaly
detection at all -- despite the system prompt's own type_guidance for
"diagnostic" sections explicitly asking the LLM to "explain what the
outliers or anomalies suggest," nothing upstream ever measured which value
was actually anomalous. Reuses insight_statistics.compute_outliers (the
same module wired into dashboard post-execution insight generation) so both
surfaces share one statistical foundation instead of two divergent ones.
"""

from ee.modules.ai.nodes.executive_report_execution_node import _compute_data_statistics


def test_flags_a_genuine_outlier_for_diagnostic_sections():
    rows = [
        {"carrier": "Acme Air", "delay_minutes": 5},
        {"carrier": "Blue Sky", "delay_minutes": 6},
        {"carrier": "Cargo Co", "delay_minutes": 4},
        {"carrier": "Delta Line", "delay_minutes": 95},
    ]
    stats = _compute_data_statistics(rows, ["carrier", "delay_minutes"], "diagnostic")
    assert "Outlier" in stats
    assert "Delta Line" in stats


def test_no_outlier_line_for_a_flat_distribution():
    rows = [
        {"region": "East", "sales": 100},
        {"region": "West", "sales": 102},
        {"region": "North", "sales": 98},
    ]
    stats = _compute_data_statistics(rows, ["region", "sales"], "breakdown")
    assert "Outlier" not in stats


def test_outlier_detection_skipped_for_kpi_sections():
    """Scoped like the dashboard equivalent: a single-row KPI scorecard has
    no meaningful outlier concept."""
    rows = [{"revenue": 500000}]
    stats = _compute_data_statistics(rows, ["revenue"], "kpi")
    assert "Outlier" not in stats


def test_existing_concentration_and_summary_stats_are_unaffected():
    rows = [
        {"segment": "Enterprise", "revenue": 700},
        {"segment": "SMB", "revenue": 200},
        {"segment": "Startup", "revenue": 100},
    ]
    stats = _compute_data_statistics(rows, ["segment", "revenue"], "breakdown")
    assert "Top-3 concentration" in stats
    assert "sum=" in stats
