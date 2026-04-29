"""Tests for clarification_utils normalization (resume payloads)."""

from src.modules.ai.utils.clarification_utils import normalize_clarification_choices


def test_normalize_selected_fields_key():
    raw = {"selected_fields": {"objective_metric": "revenue", "lever_dimension": "region"}}
    out = normalize_clarification_choices(raw)
    assert out == {"objective_metric": "revenue", "lever_dimension": "region"}


def test_normalize_choices_still_works():
    raw = {"choices": {"time_column": "order_date", "target_metric": "sales"}}
    out = normalize_clarification_choices(raw)
    assert out == {"time_column": "order_date", "target_metric": "sales"}
