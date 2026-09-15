"""Regression tests: a certified semantic-layer metric must actually govern
a widget's aggregation, not just appear as prompt text an LLM is free to
ignore.

Root cause: the platform's semantic layer (server/ee/modules/semantic/,
semantic_layer_db.py) is a real, working feature with certified metric
definitions, but dashboard generation only ever used it as soft LLM prompt
guidance (_load_semantic_hints, "CERTIFIED METRICS (prefer these for
KPIs)") -- nothing downstream enforced it. validate_widgets, the
deterministic backstop every dashboard widget already passes through
regardless of which upstream path produced it, had no awareness of
certified metrics at all.

Fixed by matching a widget's field against certified_metrics' expression
(e.g. "AVG(scores.value)" certifies that "value" is always averaged) via
_certified_aggregation_for_field, and applying that as the authoritative
aggregation -- overriding both the widget's original aggregation and the
name-token heuristic (_is_non_additive_column) below it, since a human
certification outranks a guess.
"""

from ee.modules.ai.services.dashboard_widget_validator import (
    _certified_aggregation_for_field,
    validate_widgets,
)

_SCHEMA = {
    "tables": [
        {
            "name": "orders",
            "columns": [
                {"name": "region", "type": "VARCHAR"},
                {"name": "amount", "type": "DOUBLE"},
                {"name": "discount_pct", "type": "DOUBLE"},
                {"name": "score", "type": "DOUBLE"},
            ],
        }
    ]
}


def _certified(name, expression):
    return {"name": name, "expression": expression, "certified": True}


def _stat_widget(name, field, aggregation, table="orders"):
    return {
        "name": name,
        "chart_type": "stat",
        "chart_query": {"tableName": table, "yMetrics": [{"field": field, "aggregation": aggregation}]},
    }


class TestCertifiedAggregationMatching:
    def test_matches_a_bare_column_wrapped_in_an_aggregation(self):
        metrics = [_certified("Avg Discount", "AVG(orders.discount_pct)")]
        assert _certified_aggregation_for_field("discount_pct", metrics) == "avg"

    def test_matches_case_insensitively_and_normalizes_average_to_avg(self):
        metrics = [_certified("Avg Discount", "average(discount_pct)")]
        assert _certified_aggregation_for_field("discount_pct", metrics) == "avg"

    def test_ignores_uncertified_metrics(self):
        metrics = [{"name": "Draft", "expression": "AVG(discount_pct)", "certified": False}]
        assert _certified_aggregation_for_field("discount_pct", metrics) is None

    def test_no_match_returns_none_and_defers_to_heuristic(self):
        metrics = [_certified("Total Revenue", "SUM(amount)")]
        assert _certified_aggregation_for_field("discount_pct", metrics) is None

    def test_no_certified_metrics_at_all_is_a_safe_no_op(self):
        assert _certified_aggregation_for_field("amount", None) is None
        assert _certified_aggregation_for_field("amount", []) is None


class TestValidateWidgetsEnforcesCertifiedAggregation:
    def test_certified_average_overrides_a_sum_even_though_name_looks_additive(self):
        """"discount_pct" isn't in the non-additive name-token set, so the
        heuristic alone would leave SUM in place - the certified definition
        must still win."""
        widgets = [_stat_widget("Discount", "discount_pct", "sum")]
        certified = [_certified("Discount Rate", "AVG(orders.discount_pct)")]

        kept, dropped = validate_widgets(widgets, _SCHEMA, certified_metrics=certified)

        assert not dropped
        assert kept[0]["chart_query"]["yMetrics"][0]["aggregation"] == "avg"

    def test_certified_sum_overrides_the_non_additive_heuristic(self):
        """A column the heuristic would guess is non-additive, but which is
        explicitly certified as summable, must keep SUM - certification
        outranks the guess in both directions."""
        widgets = [_stat_widget("Total Score", "score", "sum")]
        certified = [_certified("Total Score", "SUM(score)")]

        kept, dropped = validate_widgets(widgets, _SCHEMA, certified_metrics=certified)

        assert kept[0]["chart_query"]["yMetrics"][0]["aggregation"] == "sum"

    def test_no_certified_metrics_falls_back_to_existing_heuristic_behavior(self):
        """Backward compatible: omitting certified_metrics must behave
        exactly as before this feature existed."""
        widgets = [_stat_widget("Total Score", "score", "sum")]
        kept, dropped = validate_widgets(widgets, _SCHEMA)
        assert kept[0]["chart_query"]["yMetrics"][0]["aggregation"] == "avg"

    def test_certified_metric_for_unrelated_field_does_not_interfere(self):
        widgets = [_stat_widget("Total Amount", "amount", "sum")]
        certified = [_certified("Discount Rate", "AVG(discount_pct)")]

        kept, dropped = validate_widgets(widgets, _SCHEMA, certified_metrics=certified)

        assert kept[0]["chart_query"]["yMetrics"][0]["aggregation"] == "sum"
