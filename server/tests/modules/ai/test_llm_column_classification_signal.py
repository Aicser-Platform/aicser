"""Regression tests for wiring column_semantic_classifier's cached LLM
per-column classification into the deterministic chart-builder's axis
selection (guaranteed_chart_builder.classify_column/analyze_columns).

Root motivation: the chart builder's classify_column is pure name/value
heuristics, which this session repeatedly found new naming conventions that
fooled ("Prior Month Customer Count", "month_over_month_delta", ...). A
column_semantic_classifier.py service already exists — a single batched LLM
call per data source, cached and keyed by schema fingerprint — and was
already wired into data_profiler.py/analytics_node.py, but never into the
chart-axis-selection path that actually determines what gets plotted. These
tests cover the new llm_hint parameter, not the classifier service itself
(already covered elsewhere).
"""

from ee.modules.ai.utils.guaranteed_chart_builder import (
    ColumnType,
    analyze_columns,
    classify_column,
)


def test_llm_hint_overrides_name_heuristic_when_confident():
    # Without a hint, a name containing "month" some heuristic might read as
    # temporal. With a confident LLM hint saying it's actually a metric, that
    # wins outright — this is exactly the class of naming-convention trap
    # this wiring exists to close, for any column the schema classifier saw.
    values = [1, 2, 3, 4, 5]
    hint = {"classification": "metric", "confidence": 0.92, "reasoning": "numeric measure"}
    col_type, meta = classify_column("suspicious_month_name", values, llm_hint=hint)
    assert col_type == ColumnType.NUMERIC
    assert meta["llm_classification"] == "metric"


def test_llm_hint_below_confidence_threshold_falls_back_to_heuristics():
    values = ["2024-01-01", "2024-02-01", "2024-03-01"]
    low_confidence_hint = {"classification": "metric", "confidence": 0.3}
    # A low-confidence hint claiming "metric" must not override an obvious
    # date-shaped value — falls through to the normal heuristic path.
    col_type, meta = classify_column("order_date", values, llm_hint=low_confidence_hint)
    assert col_type == ColumnType.TEMPORAL
    assert "llm_classification" not in meta


def test_llm_hint_malformed_or_unknown_label_falls_back_to_heuristics():
    values = [10, 20, 30]
    col_type, _meta = classify_column("revenue", values, llm_hint={"classification": "nonsense", "confidence": 0.9})
    assert col_type == ColumnType.NUMERIC  # heuristic still gets this right


def test_all_four_llm_labels_map_to_expected_column_types():
    cases = [
        ("metric", ColumnType.NUMERIC),
        ("dimension", ColumnType.CATEGORICAL),
        ("identifier", ColumnType.CATEGORICAL),
        ("timestamp", ColumnType.TEMPORAL),
    ]
    for label, expected in cases:
        col_type, meta = classify_column(
            "opaque_col_x9",  # a name with zero heuristic signal either way
            [1, 2, 3],
            llm_hint={"classification": label, "confidence": 0.8},
        )
        assert col_type == expected, f"{label} -> expected {expected}, got {col_type} ({meta})"


def test_analyze_columns_looks_up_hints_case_insensitively():
    data = [
        {"Region": "US", "Amount": 100},
        {"Region": "EU", "Amount": 200},
    ]
    llm_classifications = {
        "region": {"classification": "dimension", "confidence": 0.85},
        "amount": {"classification": "metric", "confidence": 0.85},
    }
    analysis = analyze_columns(data, llm_classifications=llm_classifications)
    assert analysis["Region"]["type"] == ColumnType.CATEGORICAL
    assert analysis["Region"]["metadata"]["llm_classification"] == "dimension"
    assert analysis["Amount"]["type"] == ColumnType.NUMERIC


def test_analyze_columns_without_hints_is_unaffected():
    # No llm_classifications passed at all — must behave exactly as before
    # this change (every existing caller that doesn't pass the new param).
    data = [{"month": "2024-01-01", "revenue": 100}]
    analysis = analyze_columns(data)
    assert analysis["month"]["type"] == ColumnType.TEMPORAL
    assert analysis["revenue"]["type"] == ColumnType.NUMERIC


def test_column_role_from_nl2sql_covers_a_sql_computed_alias():
    # The gap llm_hint can't close: a LAG()-based alias has no schema entry
    # at all. column_role comes from the SQL-writing call itself, so it can.
    values = [0.0, 30.0, 15.5]
    col_type, meta = classify_column(
        "month_over_month_delta", values, column_role="comparison_metric"
    )
    assert col_type == ColumnType.NUMERIC
    assert meta["column_role"] == "comparison_metric"


def test_column_role_takes_priority_over_llm_hint_and_heuristics():
    values = ["2024-01-01", "2024-02-01"]
    # Both signals present and disagreeing — column_role (query-specific,
    # wrote the SQL) wins over llm_hint (schema-level cache).
    col_type, meta = classify_column(
        "some_col",
        values,
        llm_hint={"classification": "dimension", "confidence": 0.9},
        column_role="time_axis",
    )
    assert col_type == ColumnType.TEMPORAL
    assert meta["column_role"] == "time_axis"


def test_analyze_columns_threads_column_roles_end_to_end():
    data = [
        {"month": "2024-01-01", "branch": "B1", "customer_count": 2, "prior_month_delta": "—"},
        {"month": "2024-02-01", "branch": "B1", "customer_count": 5, "prior_month_delta": 3.0},
    ]
    column_roles = {
        "month": "time_axis",
        "branch": "group_dimension",
        "customer_count": "primary_metric",
        "prior_month_delta": "comparison_metric",
    }
    analysis = analyze_columns(data, column_roles=column_roles)
    assert analysis["month"]["type"] == ColumnType.TEMPORAL
    assert analysis["branch"]["type"] == ColumnType.CATEGORICAL
    assert analysis["customer_count"]["type"] == ColumnType.NUMERIC
    assert analysis["prior_month_delta"]["type"] == ColumnType.NUMERIC


def test_sql_computed_alias_with_no_schema_entry_still_uses_heuristics():
    # The realistic case: a column that only exists as a SQL alias (LAG()-based
    # comparison, a derived delta, ...) has no entry in the schema-keyed cache
    # at all, so llm_classifications.get(...) is None and this must fall
    # through to the (already-fixed) heuristics rather than erroring.
    data = [
        {"month": "2024-01-01", "customer_count": 10, "month_over_month_delta": 0.0},
        {"month": "2024-02-01", "customer_count": 13, "month_over_month_delta": 30.0},
    ]
    llm_classifications = {"month": {"classification": "timestamp", "confidence": 0.9}}
    analysis = analyze_columns(data, llm_classifications=llm_classifications)
    assert analysis["month"]["type"] == ColumnType.TEMPORAL
    assert analysis["month_over_month_delta"]["type"] == ColumnType.NUMERIC
