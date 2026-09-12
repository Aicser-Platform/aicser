"""Warehouse field names must win over engine aliases like value/period."""

from ee.modules.ai.utils.display_labels import (
    attach_column_display_names,
    display_name_for_column,
    pick_metric_source_name,
)


def test_pick_metric_ignores_value_alias():
    assert (
        pick_metric_source_name(
            {"target_metric": "current_balance"},
            {"target_metric": "value"},
        )
        == "current_balance"
    )


def test_display_name_maps_value_alias():
    names = attach_column_display_names(
        {"target_metric": "value"},
        mode_params={"target_metric": "loan_amount", "time_column": "disbursed_at"},
    )
    assert names["column_display_names"]["value"] == "loan_amount"
    assert names["column_display_names"]["period"] == "disbursed_at"
    assert display_name_for_column("value", names["column_display_names"]) == "loan amount"
    assert display_name_for_column("period", names["column_display_names"]) == "disbursed at"
