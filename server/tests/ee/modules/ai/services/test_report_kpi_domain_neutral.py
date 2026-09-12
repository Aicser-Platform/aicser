"""Regression tests: executive report KPI sections must not SUM a per-entity,
non-additive column (score/rate/ratio/...), and must not rank e-commerce
vocabulary above a genuinely additive metric just because it matched a fixed
word list.

Root cause: rank_numeric_columns_for_kpi's HIGH_VALUE_KPI list scored
"score", "rating", "rate", "ratio", "percentage", "pct", and "margin" at the
SAME top tier as "revenue"/"amount" - and _sql_kpi unconditionally computed
SUM() for every selected metric. A column like "conversion_rate" or
"satisfaction_score" could be ranked #1 and shown as a meaningless
"total_conversion_rate" KPI tile - the exact same class of bug already fixed
in the dashboard PESD pipeline's _pick_metrics/validate_widgets (see
test_dashboard_pick_metrics_domain_neutral.py and
test_dashboard_widget_meaningful_kpis.py), now fixed here too by reusing the
same centralized _is_non_additive_column classifier instead of a second,
divergent word list.
"""

from ee.modules.ai.config.report_templates import (
    build_section_sql,
    is_identifier_like_kpi_column,
    rank_numeric_columns_for_kpi,
)
from ee.modules.ai.nodes.executive_report_execution_node import _extract_kpi_values


def test_non_additive_columns_no_longer_win_the_top_tier():
    ranked = rank_numeric_columns_for_kpi(
        ["user_id", "conversion_rate", "revenue_usd", "satisfaction_score"]
    )
    assert ranked[0] == "revenue_usd"
    assert ranked.index("revenue_usd") < ranked.index("conversion_rate")
    assert ranked.index("revenue_usd") < ranked.index("satisfaction_score")
    assert ranked[-1] == "user_id"


def test_non_additive_column_is_still_a_valid_kpi_when_its_the_only_one():
    """Not excluded, just deprioritized - a rate-shaped column must still
    surface when nothing else is available."""
    ranked = rank_numeric_columns_for_kpi(["pass_rate"])
    assert ranked == ["pass_rate"]


def test_extract_kpi_values_drops_identifier_shaped_structured_aliases():
    """Live bug: a report showed "Total Enrollment ID" (sum) / "Avg Enrollment
    ID" (average) / "Total Student ID" / "Total Section ID" / "Total Status ID"
    as KPI tiles. rank_numeric_columns_for_kpi/_sql_kpi already correctly drop
    IDs from the deterministic SQL template, but _extract_kpi_values (which
    parses whatever SQL result actually came back, including non-template
    LLM-generated SQL) trusted a "total_X"/"avg_X" alias unconditionally with
    no check on whether X itself is an identifier."""
    row = {
        "total_records": 120,
        "total_enrollment_id": 7300,
        "avg_enrollment_id": 60.50,
        "total_student_id": 4100,
        "total_section_id": 780,
        "total_status_id": 300,
        "total_revenue": 45230.75,
    }
    kpis = _extract_kpi_values(row)
    labels = {k["label"] for k in kpis}
    assert labels == {"Total Records", "Total Revenue"}


def test_extract_kpi_values_drops_raw_identifier_columns_in_fallback_pool():
    """Same bug, non-template-aliased shape: an LLM-generated query with a raw
    (non total_/avg_-prefixed) identifier column name must not fall through to
    the fallback "any numeric column" pool either."""
    row = {"revenue": 1000.0, "student_id": 42}
    kpis = _extract_kpi_values(row)
    labels = {k["label"] for k in kpis}
    assert "Student Id" not in labels
    assert any("Revenue" in label for label in labels)


def test_is_identifier_like_kpi_column_matches_the_reported_columns():
    for col in ("enrollment_id", "student_id", "section_id", "status_id", "user_id", "id"):
        assert is_identifier_like_kpi_column(col), col


def test_kpi_sql_without_time_col_is_unchanged_all_time_aggregate():
    """No temporal column -> no behavior change from before time_col existed."""
    sql = build_section_sql("kpi", table="orders", metrics=["revenue_usd"], dialect="duckdb")
    assert "comparison_" not in sql
    assert "WITH bounds" not in sql
    assert "SUM(revenue_usd)" in sql or 'SUM("revenue_usd")' in sql


def test_kpi_sql_with_time_col_windows_primary_metric_and_adds_comparison():
    sql = build_section_sql(
        "kpi", table="orders", metrics=["revenue_usd"], dialect="duckdb",
        time_col="order_date", window_days=30,
    )
    assert sql is not None
    # Anchored to the data's own most recent timestamp, not wall-clock "now".
    assert "MAX(order_date)" in sql or 'MAX("order_date")' in sql
    assert "AS total_revenue_usd" in sql
    assert "AS comparison_total_revenue_usd" in sql
    # Two distinct windows: current (> current_floor) and prior (between the
    # two floors) -- both must reference the metric column being aggregated.
    assert sql.count("revenue_usd") >= 4
    assert "30 days" in sql and "60 days" in sql


def test_kpi_sql_with_time_col_non_additive_primary_uses_avg_not_sum():
    """A rate/score-shaped primary metric must window-scope with AVG, matching
    the same additive/non-additive distinction the all-time path already makes
    (a SUM of a percentage is meaningless with or without a time window)."""
    sql = build_section_sql(
        "kpi", table="surveys", metrics=["satisfaction_score"], dialect="duckdb",
        time_col="response_date",
    )
    assert sql is not None
    assert "AS avg_satisfaction_score" in sql
    assert "AS comparison_avg_satisfaction_score" in sql
    assert "AVG(CASE" in sql


def test_kpi_sql_with_time_col_clickhouse_uses_clickhouse_interval_syntax():
    sql = build_section_sql(
        "kpi", table="events", metrics=["revenue"], dialect="clickhouse",
        time_col="event_ts",
    )
    assert sql is not None
    assert "INTERVAL 30 DAY" in sql
    assert "INTERVAL 60 DAY" in sql
    assert "INTERVAL '30 days'" not in sql  # not the postgres/duckdb spelling


def test_stat_chart_data_mapping_picks_up_comparison_column():
    """Regression for the render-side half of the trend badge: chart_service.py
    must recognize `comparison_<primary>` and surface it as comparisonValue,
    without a comparisonLabel (StatWidget.tsx supplies the i18n'd fallback)."""
    from src.modules.charts.services.v2.chart_service import ChartService

    rows = [{
        "total_revenue_usd": 34000.0,
        "comparison_total_revenue_usd": 30500.0,
        "total_records": 812,
    }]
    out = ChartService._map_sql_rows_to_chart_data(None, rows, chart_type="stat", chart_query={})
    assert out["value"] == 34000.0
    assert out["comparisonValue"] == 30500.0
    assert "comparisonLabel" not in out


def test_stat_chart_data_mapping_ignores_comparison_column_when_none():
    """A row where the comparison window had no data (NULL) must not surface
    a bogus comparisonValue of None -- no trend badge is more honest than a
    fake 0% or a crash on the frontend's Number(null) math."""
    from src.modules.charts.services.v2.chart_service import ChartService

    rows = [{"total_revenue_usd": 34000.0, "comparison_total_revenue_usd": None}]
    out = ChartService._map_sql_rows_to_chart_data(None, rows, chart_type="stat", chart_query={})
    assert out["value"] == 34000.0
    assert "comparisonValue" not in out


def test_kpi_sql_selects_the_business_metric_before_total_records():
    """Live bug: every AI-generated stat/KPI tile displayed a raw row count
    instead of the chosen business metric. The renderer for this raw-SQL
    path (chart_service.py's stat-widget mapping) has no yMetrics/value/y
    column to key off -- kpi sections never get a structured chart_query --
    so it falls back to `columns[0]`, literally the first SELECT column.
    _sql_kpi used to always put `COUNT(*) AS total_records` first, so no
    matter how correctly rank_numeric_columns_for_kpi picked the metric, the
    rendered number was always the row count. The real metric must lead the
    SELECT list; total_records is still present, just no longer first."""
    sql = build_section_sql("kpi", table="orders", metrics=["revenue_usd"], dialect="duckdb")
    assert sql is not None
    select_clause = sql.split(" FROM ")[0]
    columns = [c.strip() for c in select_clause[len("SELECT "):].split(",")]
    assert "total_records" not in columns[0]
    assert "revenue_usd" in columns[0]
    assert any("total_records" in c for c in columns[1:])
    for col in ("revenue", "score", "conversion_rate", "payment_amount"):
        assert not is_identifier_like_kpi_column(col), col


def test_sql_kpi_uses_average_not_sum_for_non_additive_primary_metric():
    sql = build_section_sql("kpi", "grades", metrics=["score", "revenue_usd"])
    assert 'AVG("score")' in sql
    assert 'SUM("score")' not in sql
    assert 'SUM("revenue_usd")' in sql


def test_sql_kpi_keeps_sum_for_genuinely_additive_metric():
    sql = build_section_sql("kpi", "orders", metrics=["order_amount"])
    assert 'SUM("order_amount")' in sql
    assert 'AVG("order_amount")' in sql


def test_sql_kpi_secondary_non_additive_metric_gets_average_only():
    sql = build_section_sql(
        "kpi", "grades", metrics=["revenue_usd", "satisfaction_score", "units"]
    )
    # revenue_usd (additive, primary): total + avg
    assert 'SUM("revenue_usd")' in sql
    # satisfaction_score (non-additive, secondary slot): avg only, no total
    assert 'AVG("satisfaction_score")' in sql
    assert 'total_satisfaction_score' not in sql


def test_no_single_vocabulary_word_required_for_a_manufacturing_schema():
    """Domain-agnostic sanity check mirroring the dashboard fix: a schema
    with none of the old e-commerce words still ranks its measure-shaped
    column above its rate-shaped one."""
    ranked = rank_numeric_columns_for_kpi(["defect_rate", "units_produced"])
    assert ranked[0] == "units_produced"


# ── Root-cause fix: cached LLM column classification as an ADDITIONAL signal ──
# The user flagged that real enterprise schemas may use naming conventions
# (EMPNO, TXN_REF, ...) the LOW_VALUE_KPI word list can never anticipate. The
# fix threads a cached, per-data-source LLM column classification (see
# ee/modules/ai/services/column_semantic_classifier.py) through
# is_identifier_like_kpi_column as an optional, additional override -- never
# required, never able to override a positive word-list match, only able to
# ADD an identifier verdict the static heuristic missed. These tests exercise
# that override directly on the canonical function and its two callers
# (rank_numeric_columns_for_kpi, _extract_kpi_values) that every KPI-scoring
# site in this pipeline shares.

def test_llm_signal_catches_an_enterprise_column_name_the_word_list_cannot():
    """"txn_ref" matches no word in LOW_VALUE_KPI (not even via the
    substring check -- "no", "id", "code" etc. don't appear in it) -- the
    heuristic alone would treat it as a legitimate metric. A confident
    cached LLM verdict closes that gap."""
    assert not is_identifier_like_kpi_column("txn_ref")
    llm = {"txn_ref": {"classification": "identifier", "confidence": 0.9, "reasoning": "internal transaction reference"}}
    assert is_identifier_like_kpi_column("txn_ref", llm)


def test_llm_signal_below_confidence_threshold_is_ignored():
    """An LLM verdict that isn't confident enough must not override the
    heuristic -- matches data_profiler.py's identical confidence-gating
    behavior for the same underlying cache."""
    llm = {"txn_ref": {"classification": "identifier", "confidence": 0.2, "reasoning": "not sure"}}
    assert not is_identifier_like_kpi_column("txn_ref", llm)


def test_llm_signal_cannot_override_a_positive_word_list_match():
    """The word list is the always-available floor: a confident LLM verdict
    that disagrees ("student_id" is really a metric) can never flip an
    already-true heuristic match back to False."""
    llm = {"student_id": {"classification": "metric", "confidence": 0.99, "reasoning": "wrong"}}
    assert is_identifier_like_kpi_column("student_id", llm)


def test_llm_signal_lookup_is_case_insensitive_and_missing_entries_fall_through():
    """Cache keys are lowercased column names (see
    get_cached_column_classifications); a column absent from the cache falls
    straight through to the heuristic-only result."""
    llm = {"txn_ref": {"classification": "identifier", "confidence": 0.8, "reasoning": "transaction reference"}}
    assert is_identifier_like_kpi_column("TXN_REF", llm)
    assert not is_identifier_like_kpi_column("revenue", llm)


def test_llm_classifications_none_reproduces_heuristic_only_behavior():
    """None (the default) must be identical to omitting the argument --
    every pre-existing caller before this fix didn't pass it."""
    assert is_identifier_like_kpi_column("student_id") == is_identifier_like_kpi_column("student_id", None)
    assert is_identifier_like_kpi_column("revenue") == is_identifier_like_kpi_column("revenue", None)


def test_rank_numeric_columns_for_kpi_demotes_an_llm_flagged_identifier():
    """"txn_ref" has no word-list match and would otherwise rank as a
    neutral (score 0) column -- ahead of nothing, but not penalised either.
    Once the cached LLM classification flags it as an identifier, ranking
    must demote it below a genuine, unlabeled business measure."""
    llm = {"txn_ref": {"classification": "identifier", "confidence": 0.85, "reasoning": "internal reference code"}}
    ranked = rank_numeric_columns_for_kpi(["txn_ref", "gross_margin_dollars"], llm)
    assert ranked[0] == "gross_margin_dollars"
    assert ranked[-1] == "txn_ref"


def test_extract_kpi_values_drops_llm_flagged_identifier_alias_word_list_misses():
    """Live-bug analogue for an enterprise naming convention: "total_txn_ref"
    is exactly the shape that broke this pipeline before ("total_enrollment_id"),
    except "txn_ref" isn't in LOW_VALUE_KPI at all -- only the LLM signal catches it."""
    row = {"total_records": 50, "total_txn_ref": 184000, "total_revenue": 92000.0}
    # Baseline: without the signal, "Total Txn Ref" slips through as a KPI tile.
    baseline = _extract_kpi_values(row)
    assert {"Total Records", "Total Txn Ref", "Total Revenue"} == {k["label"] for k in baseline}

    llm = {"txn_ref": {"classification": "identifier", "confidence": 0.9, "reasoning": "internal transaction reference"}}
    kpis = _extract_kpi_values(row, llm)
    labels = {k["label"] for k in kpis}
    assert labels == {"Total Records", "Total Revenue"}


def test_extract_kpi_values_llm_signal_is_optional_and_fails_open_to_heuristic():
    """Omitting llm_classifications (or passing None) must reproduce the
    exact pre-fix heuristic-only behavior -- the signal is additive, never
    required."""
    row = {
        "total_records": 120,
        "total_enrollment_id": 7300,
        "total_revenue": 45230.75,
    }
    kpis_default = _extract_kpi_values(row)
    kpis_explicit_none = _extract_kpi_values(row, None)
    assert kpis_default == kpis_explicit_none
    assert {k["label"] for k in kpis_default} == {"Total Records", "Total Revenue"}


def test_fraction_interest_rate_displays_as_percent_not_point_one_one():
    """Sample loans store interest_rate as 0.05–0.17. Showing 0.11% is ungrounded."""
    kpis = _extract_kpi_values({"avg_interest_rate": 0.11, "row_count": 120})
    rate = next(k for k in kpis if "interest" in k["label"].lower())
    assert "0.11" not in rate["value"]
    assert rate["value"].replace(" ", "").endswith("%")
    assert "11" in rate["value"]
    # Column does not say monthly vs annual — do not invent a period.
    assert "month" not in rate["label"].lower()
    assert "year" not in rate["label"].lower()
    assert "annual" not in rate["label"].lower()


def test_percent_point_rate_is_not_multiplied_again():
    kpis = _extract_kpi_values({"avg_churn_rate": 11.5})
    rate = next(k for k in kpis if "churn" in k["label"].lower())
    assert "11.50%" in rate["value"]


def test_annual_in_column_name_is_the_only_period_we_claim():
    kpis = _extract_kpi_values({"avg_annual_interest_rate": 0.11})
    rate = next(k for k in kpis if "interest" in k["label"].lower())
    assert "annual" in rate["label"].lower()
    assert "11" in rate["value"]
    assert "0.11" not in rate["value"]
