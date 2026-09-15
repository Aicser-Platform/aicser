"""Supervisor clarification module smoke tests."""


def test_require_mode_confirmation_descriptive_empty_schema():
    from ee.modules.ai.nodes.supervisor.clarification import require_mode_confirmation

    result = require_mode_confirmation({}, "descriptive", "show total revenue")
    assert result is None or isinstance(result, dict)


def test_option_labels_always_include_table():
    from ee.modules.ai.nodes.supervisor.clarification import _option_value_and_label

    pairs = [("loans", "principal_amount"), ("payments", "principal_amount")]
    val, lbl = _option_value_and_label("loans", "principal_amount", pairs)
    assert val == "loans.principal_amount"
    assert "loans" in lbl
    assert "Principal Amount" in lbl
    val2, lbl2 = _option_value_and_label("payments", "principal_amount", pairs)
    assert val2 == "payments.principal_amount"
    assert val != val2
    assert "payments" in lbl2


def _two_table_schema():
    return {
        "tables": [
            {
                "name": "loans",
                "columns": [
                    {"name": "principal_amount", "type": "numeric"},
                    {"name": "branch_name", "type": "text"},
                ],
            },
            {
                "name": "payments",
                "columns": [
                    {"name": "principal_amount", "type": "numeric"},
                    {"name": "channel", "type": "text"},
                ],
            },
        ]
    }


def test_require_mode_confirmation_decision_intelligence_has_metric_and_lever():
    from ee.modules.ai.nodes.supervisor.clarification import require_mode_confirmation

    result = require_mode_confirmation(
        _two_table_schema(),
        "decision_intelligence",
        "What should we decide next?",
    )
    assert result and result.get("selections")
    types = {s.get("field_type") for s in result["selections"]}
    assert "objective_metric" in types
    assert "lever_dimension" in types
    metric = next(s for s in result["selections"] if s["field_type"] == "objective_metric")
    values = {o["value"] for o in metric["options"]}
    assert "loans.principal_amount" in values
    assert "payments.principal_amount" in values
    for o in metric["options"]:
        assert o.get("table")
        assert " · " in o["label"]


def test_require_mode_confirmation_prescriptive_and_composite_share_fields():
    from ee.modules.ai.nodes.supervisor.clarification import require_mode_confirmation

    schema = _two_table_schema()
    for mode in (
        "prescriptive",
        "diagnostic_prescriptive",
        "diagnostic_prescriptive_predictive",
    ):
        result = require_mode_confirmation(schema, mode, "how can we improve principal amount")
        types = {s.get("field_type") for s in (result or {}).get("selections") or []}
        assert "objective_metric" in types, mode
        assert "lever_dimension" in types, mode


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
