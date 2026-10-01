"""Tests for clarification_utils normalization (resume payloads)."""

from ee.modules.ai.utils.clarification_utils import normalize_clarification_choices


def test_normalize_selected_fields_key():
    raw = {"selected_fields": {"objective_metric": "revenue", "lever_dimension": "region"}}
    out = normalize_clarification_choices(raw)
    assert out == {"objective_metric": "revenue", "lever_dimension": "region"}


def test_normalize_choices_still_works():
    raw = {"choices": {"time_column": "order_date", "target_metric": "sales"}}
    out = normalize_clarification_choices(raw)
    assert out == {"time_column": "order_date", "target_metric": "sales"}


def test_role_keyword_bonus_matches_words_not_substrings():
    """"count" (a target_metric keyword) inside "country" used to win the bonus."""
    from ee.modules.ai.utils.clarification_utils import _score_candidate_for_role

    assert _score_candidate_for_role("country", "forecast next quarter", "target_metric") == 0
    assert _score_candidate_for_role("total_amount", "forecast next quarter", "target_metric") == 0.5
    assert _score_candidate_for_role("subtotal", "forecast next quarter", "target_metric") == 0.5


ECOM_METRICS = ["quantity", "unit_price", "discount_pct", "total_amount", "price", "stock_quantity"]
ECOM_DIMS = ["first_name", "last_name", "email", "phone", "country", "city", "status", "payment_method",
             "product_name", "category", "brand"]


def test_revenue_question_picks_the_money_column():
    from ee.modules.ai.utils.clarification_utils import best_candidate_for_role

    q = "Forecast monthly order revenue for the next 3 months"
    assert best_candidate_for_role(ECOM_METRICS, q, "target_metric") == "total_amount"
    assert best_candidate_for_role(ECOM_METRICS, "How many units sold per month?", "target_metric") == "quantity"


def test_status_values_point_at_the_status_column():
    from ee.modules.ai.utils.clarification_utils import best_candidate_for_role

    q = "Why are so many orders cancelled or refunded?"
    assert best_candidate_for_role(ECOM_DIMS, q, "focus_dimension") == "status"


def test_person_fields_are_not_a_default_breakdown():
    from ee.modules.ai.utils.clarification_utils import best_candidate_for_role

    pick = best_candidate_for_role(ECOM_DIMS, "How can we increase average order value?", "lever_dimension")
    assert pick not in ("first_name", "last_name", "email", "phone")
    # ...unless the question asks for it
    assert best_candidate_for_role(ECOM_DIMS, "Revenue by email domain", "focus_dimension") == "email"


GOLD_DIMS = ["status", "payment_method", "product_name", "category", "brand", "country", "city",
             "is_return", "is_revenue", "is_cancelled_or_refunded"]


def test_boolean_flags_are_never_the_breakdown():
    from ee.modules.ai.utils.clarification_utils import best_candidate_for_role

    q = "Why are so many orders cancelled or refunded?"
    assert best_candidate_for_role(GOLD_DIMS, q, "focus_dimension") == "status"
    assert not best_candidate_for_role(GOLD_DIMS, "How can we increase average order value?", "lever_dimension").startswith("is_")


def test_full_column_name_in_question_beats_partial_match():
    from ee.modules.ai.utils.clarification_utils import best_candidate_for_role

    q = "Revenue by product category: where should we focus next quarter?"
    assert best_candidate_for_role(GOLD_DIMS, q, "focus_dimension") == "category"
    assert best_candidate_for_role(GOLD_DIMS, q, "lever_dimension") == "category"
