"""Regression tests for the animate-mode deterministic SQL fallback.

When the LLM path fails (no BYOK / provider outage), animate mode must still
produce valid SQL for the data source. The fallback must never reference a
column that does not exist in the FROM clause (join when the category lives
in another table), and must pick a dialect-correct time truncation.
"""

import os

os.environ.setdefault("AISER_EDITION", "enterprise")
os.environ["DEBUG"] = "false"


def _hospitality_schema():
    """Mirror of the sample_duckdb hospitality schema that reproduced the bug:
    time + metric live in `reviews`, but the category (`name`) lives in `hotels`.
    """
    return {
        "connection_database": "hospitality",
        "tables": [
            {
                "name": "hotels",
                "schema": "hospitality",
                "columns": [
                    {"name": "hotel_id", "type": "BIGINT"},
                    {"name": "name", "type": "VARCHAR"},
                    {"name": "city", "type": "VARCHAR"},
                    {"name": "star_rating", "type": "BIGINT"},
                ],
            },
            {
                "name": "reviews",
                "schema": "hospitality",
                "columns": [
                    {"name": "review_id", "type": "BIGINT"},
                    {"name": "hotel_id", "type": "BIGINT"},
                    {"name": "guest_id", "type": "BIGINT"},
                    {"name": "rating", "type": "BIGINT"},
                    {"name": "reviewed_at", "type": "DATE"},
                ],
            },
        ],
    }


def _single_table_schema():
    return {
        "connection_database": "sales_db",
        "tables": [
            {
                "name": "orders",
                "schema": "public",
                "columns": [
                    {"name": "order_date", "type": "DATE"},
                    {"name": "region", "type": "VARCHAR"},
                    {"name": "revenue", "type": "DOUBLE"},
                ],
            },
        ],
    }


def test_cross_table_category_emits_join():
    """Category column in another table must produce a JOIN, not an unbound column."""
    from ee.modules.ai.nodes.nl2sql_node import _build_animate_deterministic_sql

    sql = _build_animate_deterministic_sql(
        schema_info=_hospitality_schema(),
        delegation_context={
            "time_column": "reviewed_at",
            "target_metric": "rating",
            "focus_dimension": "name",
        },
        db_type="duckdb",
        data_source_type="sample_duckdb",
    )
    assert sql is not None
    lowered = sql.lower()
    assert "join" in lowered, f"expected a JOIN for cross-table category, got: {sql}"
    assert "hotel_id" in lowered, f"expected hotel_id join key, got: {sql}"
    assert "hotels" in lowered and "reviews" in lowered
    # The category must be selected from the joined dimension table alias,
    # never bare (which binds against the fact table and fails).
    assert '."name"' in sql or ".name" in lowered.replace('"', "")


def test_single_table_stays_single_table():
    from ee.modules.ai.nodes.nl2sql_node import _build_animate_deterministic_sql

    sql = _build_animate_deterministic_sql(
        schema_info=_single_table_schema(),
        delegation_context={
            "time_column": "order_date",
            "target_metric": "revenue",
            "focus_dimension": "region",
        },
        db_type="postgresql",
        data_source_type="database",
    )
    assert sql is not None
    lowered = sql.lower()
    assert "join" not in lowered
    assert "date_trunc" in lowered
    assert "order_date" in lowered and "region" in lowered and "revenue" in lowered


def test_category_missing_everywhere_substitutes_fact_table_dimension():
    """If the hinted category resolves nowhere, fall back to a text column
    from the fact table rather than emitting an unbound column."""
    from ee.modules.ai.nodes.nl2sql_node import _build_animate_deterministic_sql

    schema = _single_table_schema()
    sql = _build_animate_deterministic_sql(
        schema_info=schema,
        delegation_context={
            "time_column": "order_date",
            "target_metric": "revenue",
            "focus_dimension": "nonexistent_column",
        },
        db_type="postgresql",
        data_source_type="database",
    )
    assert sql is not None
    assert "nonexistent_column" not in sql
    assert "region" in sql.lower()


def test_missing_time_or_metric_returns_none():
    """Never guess SQL when the fact table cannot bind time + metric."""
    from ee.modules.ai.nodes.nl2sql_node import _build_animate_deterministic_sql

    sql = _build_animate_deterministic_sql(
        schema_info=_single_table_schema(),
        delegation_context={
            "time_column": "no_such_time",
            "target_metric": "no_such_metric",
            "focus_dimension": "region",
        },
        db_type="postgresql",
        data_source_type="database",
    )
    assert sql is None


def test_metric_aggregation_matches_semantics():
    """Rating/score-like metrics use AVG; amount-like metrics use SUM."""
    from ee.modules.ai.nodes.nl2sql_node import _build_animate_deterministic_sql

    rating_sql = _build_animate_deterministic_sql(
        schema_info=_hospitality_schema(),
        delegation_context={
            "time_column": "reviewed_at",
            "target_metric": "rating",
            "focus_dimension": "city",
        },
        db_type="duckdb",
        data_source_type="sample_duckdb",
    )
    assert rating_sql is not None
    assert "avg(" in rating_sql.lower()

    revenue_sql = _build_animate_deterministic_sql(
        schema_info=_single_table_schema(),
        delegation_context={
            "time_column": "order_date",
            "target_metric": "revenue",
            "focus_dimension": "region",
        },
        db_type="postgresql",
        data_source_type="database",
    )
    assert revenue_sql is not None
    assert "sum(" in revenue_sql.lower()


def test_mysql_uses_backtick_quoting_and_date_format():
    from ee.modules.ai.nodes.nl2sql_node import _build_animate_deterministic_sql

    schema = {
        "connection_database": "shop",
        "tables": [
            {
                "name": "sales",
                "schema": "",
                "columns": [
                    {"name": "sold_at", "type": "DATETIME"},
                    {"name": "product", "type": "VARCHAR"},
                    {"name": "amount", "type": "DECIMAL"},
                ],
            },
        ],
    }
    sql = _build_animate_deterministic_sql(
        schema_info=schema,
        delegation_context={
            "time_column": "sold_at",
            "target_metric": "amount",
            "focus_dimension": "product",
        },
        db_type="mysql",
        data_source_type="database",
    )
    assert sql is not None
    assert "`sold_at`" in sql
    assert "date_format" in sql.lower()
