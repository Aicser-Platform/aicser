"""Supervisor clarification module smoke tests."""


def test_require_mode_confirmation_descriptive_empty_schema():
    from ee.modules.ai.nodes.supervisor.clarification import require_mode_confirmation

    result = require_mode_confirmation({}, "descriptive", "show total revenue")
    assert result is None or isinstance(result, dict)


def test_build_delegation_context_predictive_horizon():
    from ee.modules.ai.nodes.supervisor.delegation import build_delegation_context

    ctx = build_delegation_context(
        "forecast sales for next 6 months",
        "predictive",
        3,
        data_source_id="ds-1",
        db_type="postgres",
    )
    assert ctx["analytics_type"] == "predictive"
    assert ctx.get("forecast_periods")
