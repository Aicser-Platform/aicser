"""Regression tests: dashboard headline-metric selection must not be skewed
toward any one industry's vocabulary.

Root cause: _pick_metrics scored numeric columns against a fixed priority
tuple of e-commerce/ad-tech words ("revenue", "sales", "clicks",
"impressions", "orders", "users", ...). Any numeric column outside that
vocabulary - a hospital's "bed_count", a school's "enrollment_total", a
logistics firm's "shipment_amount" - lost the tie-break to whichever column
happened to share a word with that list, purely because of the word chosen
by the schema author, not because of anything about the data itself.

Fixed by replacing the business-vocabulary list with (a) the user's own
prompt wording, already present and kept as the strongest signal, (b)
structural unit/quantity naming shapes (amount/total/count/qty/value/
currency-code suffixes) that recur across schemas regardless of industry,
and (c) a demotion for per-entity, non-additive-looking columns reusing the
same _is_non_additive_column classifier already used for KPI aggregation
correction elsewhere in this module - so the two guardrails agree with each
other instead of keeping two divergent domain-word lists.
"""

from ee.modules.ai.services.dashboard_pesd_service import _pick_metrics


def _fact_table(*column_specs):
    return {
        "name": "fact",
        "columns": [{"name": name, "type": "DOUBLE"} for name in column_specs],
    }


def test_no_single_vocabulary_word_is_required_to_win():
    """A logistics-flavored schema has none of the old e-commerce words
    (revenue/sales/clicks/orders/users) yet still has one column that is
    clearly the intended headline metric by naming shape alone."""
    table = _fact_table("shipment_id", "shipment_amount", "carrier_rating")
    picked = _pick_metrics(table, prompt="build a logistics dashboard", limit=1)
    assert picked == ["shipment_amount"]


def test_healthcare_schema_prefers_measure_shaped_column_over_rate_column():
    table = _fact_table("visit_count", "readmission_rate")
    picked = _pick_metrics(table, prompt="patient visits dashboard", limit=1)
    assert picked == ["visit_count"]


def test_education_schema_prefers_measure_shaped_column_over_score_column():
    table = _fact_table("enrollment_total", "score")
    picked = _pick_metrics(table, prompt="school performance dashboard", limit=1)
    assert picked == ["enrollment_total"]


def test_user_wording_beats_naming_shape_regardless_of_domain():
    """The strongest signal stays the user's own words - even a column with
    no measure-shaped suffix wins if the user explicitly asked about it."""
    table = _fact_table("shipment_amount", "delay_minutes")
    picked = _pick_metrics(table, prompt="show me delay minutes trend", limit=1)
    assert picked == ["delay_minutes"]


def test_e_commerce_wording_still_works_it_is_no_longer_hardcoded_though():
    """Sanity check: e-commerce-named columns aren't penalized, they just no
    longer get a free ride from a hardcoded list - "revenue_usd" still wins
    here via the currency-suffix structural signal, same as any other
    industry's "_usd" column would."""
    table = _fact_table("revenue_usd", "customer_satisfaction_score")
    picked = _pick_metrics(table, prompt="quarterly business review", limit=1)
    assert picked == ["revenue_usd"]


def test_non_additive_column_is_not_excluded_only_deprioritized():
    """When it's the ONLY numeric column, a score/rate-shaped column must
    still be returned - non-additive just means "prefer something else if
    available", not "never surface this"."""
    table = _fact_table("satisfaction_score")
    picked = _pick_metrics(table, prompt="cx dashboard", limit=4)
    assert picked == ["satisfaction_score"]


def test_schema_order_is_the_neutral_tiebreak_with_no_other_signal():
    table = _fact_table("alpha_metric", "beta_metric")
    picked = _pick_metrics(table, prompt="", limit=2)
    assert picked == ["alpha_metric", "beta_metric"]
