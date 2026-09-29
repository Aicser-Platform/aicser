"""A good dashboard plan with near-miss fields is repaired, and one bad widget doesn't sink the plan."""

from ee.modules.ai.services.dashboard_llm_planner import _repair_plan_dict, _validate_plan_leniently


def test_metric_synonym_and_missing_filter_label_are_repaired():
    raw = {"pages": [{"widgets": [{"computed": {"numerator": {"metric": "npl_amount", "agg": "sum"},
                                                "denominator": {"column": "principal", "agg": "sum"}}}]}],
           "global_filters": [{"type": "select", "field": "branch_name"}]}
    out = _repair_plan_dict(raw)
    comp = out["pages"][0]["widgets"][0]["computed"]
    assert comp["numerator"]["field"] == "npl_amount" and comp["denominator"]["field"] == "principal"
    assert out["global_filters"][0]["label"] == "Branch Name"


def test_invalid_filter_is_dropped_not_the_whole_plan():
    raw = {"dashboard_title": "Loans", "pages": [],
           "global_filters": [{"type": "select"}]}  # no field, no label — unrepairable
    plan = _validate_plan_leniently(raw)
    assert plan.dashboard_title == "Loans" and plan.global_filters == []


def test_other_tables_field_is_reached_through_the_foreign_key():
    from ee.modules.ai.services.dashboard_llm_planner import _foreign_key_for

    cols = ["loan_id", "branch_id", "category_id", "principal_amount", "npl_flag"]
    assert _foreign_key_for("branches.name", cols) == "branch_id"
    assert _foreign_key_for("branch", cols) == "branch_id"
    assert _foreign_key_for("categories.name", cols) == "category_id"
    assert _foreign_key_for("customers.name", cols) is None  # not reachable → widget dropped, never mislabeled
