"""AI formula suggestions are only returned when they use real columns and allowed operations."""

from ee.modules.ai.formula_router import ColumnIn, validate_suggestion

COLS = [ColumnIn(name="revenue_usd", type="DOUBLE"), ColumnIn(name="cogs_usd", type="DOUBLE"), ColumnIn(name="invoice_id")]


def test_valid_margin_is_kept_as_percentage():
    out = validate_suggestion({"type": "change", "numerator": {"field": "revenue_usd", "aggregation": "sum"},
                               "denominator": {"field": "cogs_usd", "aggregation": "SUM"}, "multiplier": 100,
                               "label": "Markup"}, COLS)
    assert out == {"type": "change", "numerator": {"field": "revenue_usd", "aggregation": "sum"},
                   "denominator": {"field": "cogs_usd", "aggregation": "sum"}, "multiplier": 100,
                   "label": "Markup", "format": "percent"}


def test_invented_columns_or_operations_are_rejected():
    assert validate_suggestion({"type": "ratio", "numerator": {"field": "profit"}, "denominator": {"field": "cogs_usd"}}, COLS) is None
    assert validate_suggestion({"type": "log", "numerator": {"field": "revenue_usd"}, "denominator": {"field": "cogs_usd"}}, COLS) is None
    assert validate_suggestion("not json", COLS) is None


def test_multiplier_only_applies_to_percent_operations():
    out = validate_suggestion({"type": "difference", "numerator": {"field": "revenue_usd"},
                               "denominator": {"field": "cogs_usd"}, "multiplier": 100}, COLS)
    assert out["multiplier"] == 1 and out["format"] == "auto"
