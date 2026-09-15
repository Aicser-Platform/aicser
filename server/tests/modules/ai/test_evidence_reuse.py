"""Evidence reuse: depth operators skip NL2SQL unless the user asks for new facts."""

from ee.modules.ai.utils.evidence import (
    match_governed_metric,
    query_needs_new_sql,
    sanitize_requested_skill,
    should_reuse_evidence,
)


def test_client_chip_reuses_last_rows():
    assert should_reuse_evidence(
        query="Why did this happen?",
        analysis_mode="diagnostic",
        analytics_type="diagnostic",
        client_reuse=True,
        has_rows=True,
    )


def test_first_turn_does_not_reuse_without_rows():
    assert not should_reuse_evidence(
        query="Why did this happen?",
        analysis_mode="diagnostic",
        analytics_type="diagnostic",
        client_reuse=False,
        has_rows=False,
    )


def test_new_scope_forces_fresh_sql():
    assert query_needs_new_sql("compare revenue versus last year")
    assert not should_reuse_evidence(
        query="compare revenue versus last year",
        analysis_mode="diagnostic",
        analytics_type="diagnostic",
        client_reuse=True,
        has_rows=True,
    )


def test_pinned_diagnose_short_follow_up_reuses():
    assert should_reuse_evidence(
        query="why did this happen?",
        analysis_mode="diagnostic",
        analytics_type="diagnostic",
        client_reuse=False,
        has_rows=True,
    )


def test_depth_short_new_question_does_not_blindly_reuse():
    """≤14-word depth asks without pronouns/phrases must hit the warehouse."""
    assert not should_reuse_evidence(
        query="top customers by loan amount",
        analysis_mode="predictive",
        analytics_type="predictive",
        client_reuse=False,
        has_rows=True,
    )


def test_chart_type_only_reviz_detected():
    from ee.modules.ai.utils.evidence import is_chart_type_only_reviz

    assert is_chart_type_only_reviz("show as bar chart")
    assert not is_chart_type_only_reviz("forecast that as a line")


def test_plain_analyze_does_not_reuse_a_new_metric_question():
    assert not should_reuse_evidence(
        query="how much loan amount per top 10 customers",
        analysis_mode="standard",
        analytics_type="descriptive",
        client_reuse=False,
        has_rows=True,
    )


def test_forecast_that_phrase_reuses():
    assert should_reuse_evidence(
        query="forecast that for the next 6 months",
        analysis_mode="auto",
        analytics_type="descriptive",
        client_reuse=False,
        has_rows=True,
    )


def test_forecast_that_on_ranking_does_not_reuse():
    ranking = [{"customer": "acme", "amount": 10}] * 8
    assert not should_reuse_evidence(
        query="forecast that for the next 6 months",
        analysis_mode="auto",
        analytics_type="descriptive",
        client_reuse=False,
        has_rows=True,
        query_result=ranking,
    )


def test_ranking_follow_up_after_forecast_does_not_reuse_monthly_series():
    monthly = [{"period": f"2024-{m:02d}-01", "value": 100 + m} for m in range(1, 13)]
    assert query_needs_new_sql("Which name has the highest current_balance?")
    assert not should_reuse_evidence(
        query="Which name has the highest current_balance?",
        analysis_mode="predictive",
        analytics_type="predictive",
        client_reuse=False,
        has_rows=True,
        query_result=monthly,
    )


def test_skill_allowlist():
    assert sanitize_requested_skill("create_alert") == "create_alert"
    assert sanitize_requested_skill("drop_table") is None
    assert sanitize_requested_skill("  SAVE_CHART ") == "save_chart"


def test_unique_metric_match():
    metrics = [
        {"name": "loan_amount", "expression": "SUM(amount)"},
        {"name": "customer_count", "expression": "COUNT(*)"},
    ]
    hit = match_governed_metric("show loan amount by region", metrics)
    assert hit and hit["name"] == "loan_amount"
    assert match_governed_metric("show totals", metrics) is None
