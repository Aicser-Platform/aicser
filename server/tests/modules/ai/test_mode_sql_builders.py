"""Schema-grounded SQL contracts for Forecast / Diagnose / Optimise."""

from ee.modules.ai.utils.mode_sql_builders import (
    build_mode_contract_sql,
    build_predictive_history_sql,
    build_simple_count_sql,
    find_forecast_source,
    forecast_sql_columns_bind,
    infer_time_metric_from_schema,
    inner_sql_is_forecast_shape,
    pick_timeseries_columns_from_result,
    reconcile_timeseries_fields,
    resolve_mode_fields,
    result_is_forecast_ready,
    sql_already_forecast_shaped,
)


BANKING_SCHEMA = {
    "tables": [
        {
            "schema": "banking",
            "name": "loans",
            "columns": [
                {"name": "loan_id", "type": "uuid"},
                {"name": "disbursed_at", "type": "timestamp"},
                {"name": "amount", "type": "numeric"},
                {"name": "branch_id", "type": "uuid"},
                {"name": "product", "type": "text"},
            ],
        },
        {
            "schema": "banking",
            "name": "customers",
            "columns": [
                {"name": "customer_id", "type": "uuid"},
                {"name": "region", "type": "text"},
            ],
        },
    ]
}


CROSS_TABLE_FORECAST_SCHEMA = {
    "tables": [
        {
            "schema": "banking",
            "name": "loan",
            "columns": [
                {"name": "loan_id", "type": "uuid", "is_primary_key": True},
                {"name": "disbursement_date", "type": "timestamp"},
            ],
        },
        {
            "schema": "banking",
            "name": "collateral",
            "columns": [
                {"name": "collateral_id", "type": "uuid"},
                {"name": "loan_id", "type": "uuid", "is_foreign_key": True},
                {"name": "value_amount", "type": "numeric"},
            ],
        },
    ]
}


def test_forecast_sql_uses_connected_schema_not_from_data():
    sql = build_predictive_history_sql(
        BANKING_SCHEMA,
        time_column="disbursed_at",
        target_metric="amount",
        metric_aggregation="sum",
        time_granularity="month",
        db_type="postgresql",
        data_source_type="postgres",
    )
    assert sql is not None
    lower = sql.lower()
    assert "banking" in lower and "loans" in lower
    assert "as period" in lower and "as value" in lower
    assert "group by 1" in lower
    assert "generate_series" not in lower
    assert 'from "data"' not in lower


def test_forecast_sql_skips_rewrite_when_already_shaped():
    existing = (
        'SELECT date_trunc(\'month\', "disbursed_at") AS period, SUM("amount") AS value '
        'FROM "banking"."loans" GROUP BY 1 ORDER BY 1 ASC'
    )
    assert sql_already_forecast_shaped(existing, "amount") is True
    assert inner_sql_is_forecast_shape(existing) is True


def test_result_period_value_is_forecast_ready_even_when_schema_names_differ():
    rows = [{"period": f"2024-{m:02d}-01", "value": 100 + m} for m in range(1, 8)]
    assert result_is_forecast_ready(rows) is True
    time_col, metric = pick_timeseries_columns_from_result(rows)
    assert time_col == "period"
    assert metric == "value"


def test_ranking_table_is_not_forecast_ready():
    rows = [{"customer": f"c{i}", "amount": 1000 * i} for i in range(1, 12)]
    assert result_is_forecast_ready(rows) is False


def test_simple_count_customers_no_llm():
    sql = build_simple_count_sql(
        "how many customers",
        BANKING_SCHEMA,
        db_type="postgresql",
        data_source_type="postgres",
    )
    assert sql is not None
    lower = sql.lower()
    assert "count(" in lower
    assert "customers" in lower
    assert "group by" not in lower


def test_simple_count_customers_with_loan_amount_filter():
    schema = {
        "tables": [
            {
                "schema": "banking",
                "name": "loans",
                "columns": [
                    {"name": "loan_id", "type": "uuid", "is_primary_key": True},
                    {"name": "customer_id", "type": "uuid"},
                    {"name": "amount", "type": "numeric"},
                ],
            },
            {
                "schema": "banking",
                "name": "customers",
                "columns": [
                    {"name": "customer_id", "type": "uuid", "is_primary_key": True},
                    {"name": "region", "type": "text"},
                ],
            },
        ]
    }
    sql = build_simple_count_sql(
        "how many customers with loan amount > 100$",
        schema,
        db_type="postgresql",
        data_source_type="postgres",
    )
    assert sql is not None
    lower = sql.lower()
    assert "count(distinct" in lower
    assert "customer_id" in lower
    assert "amount" in lower
    assert "> 100" in sql
    assert "loans" in lower


def test_simple_count_skips_breakdown_questions():
    assert build_simple_count_sql("how many customers by region", BANKING_SCHEMA) is None


def test_simple_fact_class_not_just_one_count_question():
    from ee.modules.ai.utils.mode_sql_builders import build_simple_fact_sql
    from ee.modules.ai.utils.query_intent_principles import is_simple_fact_query

    assert is_simple_fact_query("how many customers with loan amount > 100$")
    assert is_simple_fact_query("number of customers")
    assert is_simple_fact_query("what is the total loan amount")
    assert is_simple_fact_query("what's the average loan amount")
    assert is_simple_fact_query("max loan amount")
    assert not is_simple_fact_query("how many customers by region")
    assert not is_simple_fact_query("how much collateral amount by branch")
    assert not is_simple_fact_query("forecast loan amount next 6 months")
    assert not is_simple_fact_query("why did loan defaults rise")
    assert not is_simple_fact_query("build a dashboard of customers")

    total = build_simple_fact_sql(
        "what is the total loan amount",
        BANKING_SCHEMA,
        db_type="postgresql",
        data_source_type="postgres",
    )
    assert total is not None
    assert "sum(" in total.lower()
    assert "amount" in total.lower()
    assert "loans" in total.lower()

    avg = build_simple_fact_sql(
        "what's the average loan amount",
        BANKING_SCHEMA,
        db_type="postgresql",
        data_source_type="postgres",
    )
    assert avg is not None
    assert "avg(" in avg.lower()

    mx = build_simple_fact_sql(
        "max loan amount",
        BANKING_SCHEMA,
        db_type="postgresql",
        data_source_type="postgres",
    )
    assert mx is not None
    assert "max(" in mx.lower()

    assert build_simple_fact_sql("how many customers by region", BANKING_SCHEMA) is None


def test_descriptive_sql_instruction_matches_asked_grain():
    from ee.modules.ai.utils.query_intent_principles import (
        descriptive_output_format,
        descriptive_sql_instruction,
    )
    from ee.modules.ai.nodes.supervisor.delegation import build_delegation_context

    by_branch = descriptive_sql_instruction("how much collateral amount by branch")
    assert "GROUP BY only the requested dimension" in by_branch
    assert "Do NOT add a time column" in by_branch

    trend = descriptive_sql_instruction("collateral amount by branch over time")
    assert "time grain" in trend.lower()

    ctx = build_delegation_context("how much collateral amount by branch", "descriptive", 2)
    assert "Do NOT add a time column" in ctx["sql_instruction"]
    assert "rank" in ctx["output_format"].lower()
    assert descriptive_output_format("how much collateral amount by branch") == ctx["output_format"]


def test_diagnose_and_optimise_sql_bind_schema_columns():
    diag = build_mode_contract_sql(
        "diagnostic",
        BANKING_SCHEMA,
        {"time_column": "disbursed_at", "target_metric": "amount", "focus_dimension": "product"},
        db_type="postgresql",
        data_source_type="postgres",
    )
    assert diag is not None
    assert "focus_dimension" in diag.lower()
    assert "product" in diag.lower()

    presc = build_mode_contract_sql(
        "prescriptive",
        BANKING_SCHEMA,
        {"target_metric": "amount", "lever_dimension": "product"},
        db_type="postgresql",
        data_source_type="postgres",
    )
    assert presc is not None
    assert "as option" in presc.lower()
    assert "product" in presc.lower()


def test_forecast_join_when_time_and_metric_on_different_tables():
    """disbursement_date on loan + value_amount on collateral — need a JOIN, not a broken single FROM."""
    src = find_forecast_source(CROSS_TABLE_FORECAST_SCHEMA, "disbursement_date", "value_amount")
    assert src is not None
    assert src["kind"] == "join"

    sql = build_predictive_history_sql(
        CROSS_TABLE_FORECAST_SCHEMA,
        time_column="disbursement_date",
        target_metric="value_amount",
        metric_aggregation="sum",
        time_granularity="month",
        db_type="duckdb",
        data_source_type="file",
    )
    assert sql is not None
    lower = sql.lower()
    assert "join" in lower
    assert "loan" in lower and "collateral" in lower
    assert "disbursement_date" in lower and "value_amount" in lower
    assert "as period" in lower and "as value" in lower


def test_forecast_shaped_sql_with_unbound_column_is_detected():
    """LLM emitted period/value shape but referenced a column not on the FROM table."""
    broken = (
        'SELECT date_trunc(\'MONTH\', TRY_CAST("disbursement_date" AS TIMESTAMP)) AS period, '
        'SUM("value_amount") AS value FROM "collateral" GROUP BY 1 ORDER BY 1'
    )
    assert sql_already_forecast_shaped(broken, "value_amount") is True
    assert forecast_sql_columns_bind(
        broken,
        CROSS_TABLE_FORECAST_SCHEMA,
        time_column="disbursement_date",
        target_metric="value_amount",
    ) is False


def test_joined_forecast_sql_columns_bind():
    ok = (
        'SELECT date_trunc(\'month\', t."disbursement_date") AS period, '
        'SUM(m."value_amount") AS value '
        'FROM "loan" t JOIN "collateral" m ON t."loan_id" = m."loan_id" '
        "GROUP BY 1 ORDER BY 1 ASC"
    )
    assert forecast_sql_columns_bind(
        ok,
        CROSS_TABLE_FORECAST_SCHEMA,
        time_column="disbursement_date",
        target_metric="value_amount",
    ) is True
    # Same statement without field hints — aliases must not be scraped as columns.
    assert forecast_sql_columns_bind(ok, CROSS_TABLE_FORECAST_SCHEMA) is True


def test_infer_time_metric_prefers_co_located_pair():
    time_col, metric = infer_time_metric_from_schema(BANKING_SCHEMA)
    assert time_col == "disbursed_at"
    assert metric == "amount"


ACCOUNTS_WITHOUT_DATE = {
    "tables": [
        {
            "schema": "banking",
            "name": "accounts",
            "columns": [
                {"name": "account_id", "type": "uuid", "is_primary_key": True},
                {"name": "customer_id", "type": "uuid"},
                {"name": "current_balance", "type": "numeric"},
                {"name": "available_balance", "type": "numeric"},
            ],
        },
        {
            "schema": "banking",
            "name": "loans",
            "columns": [
                {"name": "loan_id", "type": "uuid", "is_primary_key": True},
                {"name": "customer_id", "type": "uuid"},
                {"name": "disbursement_date", "type": "timestamp"},
                {"name": "amount", "type": "numeric"},
            ],
        },
    ]
}


def test_forecast_sql_on_accounts_does_not_bind_loan_date():
    sql = (
        'SELECT DATE_TRUNC(\'MONTH\', "disbursement_date") AS period, '
        'SUM("current_balance") AS value FROM "banking"."accounts" GROUP BY 1'
    )
    assert forecast_sql_columns_bind(sql, ACCOUNTS_WITHOUT_DATE) is False


def test_reconcile_mismatched_time_metric_is_queryable():
    """Ontology/LLM pair must become a join or a co-located pair — never unexecutable."""
    time_col, metric = reconcile_timeseries_fields(
        ACCOUNTS_WITHOUT_DATE, "disbursement_date", "current_balance"
    )
    assert time_col and metric
    src = find_forecast_source(ACCOUNTS_WITHOUT_DATE, time_col, metric)
    assert src is not None
    sql = build_predictive_history_sql(
        ACCOUNTS_WITHOUT_DATE,
        time_column=time_col,
        target_metric=metric,
        db_type="duckdb",
        data_source_type="file",
    )
    assert sql is not None
    assert forecast_sql_columns_bind(sql, ACCOUNTS_WITHOUT_DATE) is True
    # Must not keep the live-failing grain: date on loans, FROM accounts only.
    if "accounts" in sql.lower() and "disbursement_date" in sql.lower():
        assert "join" in sql.lower()


def test_resolve_mode_fields_does_not_keep_unexecutable_profiler_pair():
    fields = resolve_mode_fields(
        {"time_column": "disbursement_date", "target_metric": "current_balance"},
        None,
        ACCOUNTS_WITHOUT_DATE,
    )
    src = find_forecast_source(
        ACCOUNTS_WITHOUT_DATE, fields["time_column"], fields["target_metric"]
    )
    assert src is not None


def test_ensure_predictive_sql_shape_rewrites_unbound_from_clause():
    from ee.modules.ai.nodes.nl2sql_node import _ensure_predictive_sql_shape

    broken = (
        'SELECT DATE_TRUNC(\'MONTH\', "disbursement_date") AS period, '
        'SUM("current_balance") AS value FROM "banking"."accounts" GROUP BY 1'
    )
    out = _ensure_predictive_sql_shape(
        broken,
        ACCOUNTS_WITHOUT_DATE,
        {"time_column": "disbursement_date", "target_metric": "current_balance"},
        "duckdb",
        "file",
    )
    assert forecast_sql_columns_bind(out, ACCOUNTS_WITHOUT_DATE) is True
    if "accounts" in out.lower() and "disbursement_date" in out.lower():
        assert "join" in out.lower()


HOSPITALITY_SCHEMA = {
    "connection_database": "hospitality",
    "tables": [
        {
            "name": "hotels",
            "schema": "hospitality",
            "columns": [
                {"name": "hotel_id", "type": "BIGINT"},
                {"name": "name", "type": "VARCHAR"},
                {"name": "city", "type": "VARCHAR"},
            ],
        },
        {
            "name": "reviews",
            "schema": "hospitality",
            "columns": [
                {"name": "review_id", "type": "BIGINT"},
                {"name": "hotel_id", "type": "BIGINT"},
                {"name": "rating", "type": "BIGINT"},
                {"name": "reviewed_at", "type": "DATE"},
            ],
        },
    ],
}


def test_resolve_mode_fields_drops_hallucinated_dimension():
    fields = resolve_mode_fields(
        {
            "time_column": "disbursed_at",
            "target_metric": "amount",
            "focus_dimension": "not_a_column",
        },
        None,
        BANKING_SCHEMA,
    )
    assert fields["focus_dimension"] != "not_a_column"
    assert fields["focus_dimension"] in ("product", "region")


def test_diagnostic_joins_cross_table_dimension():
    from ee.modules.ai.utils.mode_sql_builders import build_diagnostic_breakdown_sql

    sql = build_diagnostic_breakdown_sql(
        HOSPITALITY_SCHEMA,
        time_column="reviewed_at",
        target_metric="rating",
        focus_dimension="name",
        metric_aggregation="avg",
        db_type="duckdb",
        data_source_type="sample_duckdb",
    )
    assert sql is not None
    lowered = sql.lower()
    assert "join" in lowered
    assert "hotel_id" in lowered
    assert "name" in lowered
    assert "rating" in lowered


def test_diagnostic_and_prescriptive_compile_from_schema_without_hints():
    diag = build_mode_contract_sql(
        "diagnostic",
        BANKING_SCHEMA,
        {},
        db_type="postgresql",
        data_source_type="postgres",
    )
    assert diag is not None
    lowered = diag.lower()
    assert "amount" in lowered
    assert "product" in lowered or "region" in lowered
    assert "not_a_column" not in lowered

    presc = build_mode_contract_sql(
        "prescriptive",
        BANKING_SCHEMA,
        {},
        db_type="postgresql",
        data_source_type="postgres",
    )
    assert presc is not None
    assert "amount" in presc.lower()
    assert "as option" in presc.lower()


def test_forecast_compiles_from_schema_without_hints():
    sql = build_mode_contract_sql(
        "predictive",
        BANKING_SCHEMA,
        {},
        db_type="postgresql",
        data_source_type="postgres",
    )
    assert sql is not None
    lowered = sql.lower()
    assert "disbursed_at" in lowered
    assert "amount" in lowered
    assert "as period" in lowered and "as value" in lowered


def test_qualified_table_column_hints_compile_for_every_mode():
    from ee.modules.ai.utils.mode_sql_builders import bare_column_name, build_mode_contract_sql

    assert bare_column_name('loans."amount"') == "amount"
    assert bare_column_name("hotels.name") == "name"

    hints = {
        "time_column": "loans.disbursed_at",
        "target_metric": "loans.amount",
        "focus_dimension": "loans.product",
        "lever_dimension": "loans.product",
    }
    for at in ("predictive", "diagnostic", "prescriptive", "animate"):
        sql = build_mode_contract_sql(
            at,
            BANKING_SCHEMA,
            hints,
            db_type="postgresql",
            data_source_type="postgres",
        )
        assert sql, f"{at} compiler returned None for qualified hints"
        assert "loans.amount" not in sql.lower()
        assert "disbursed_at" in sql.lower() or "amount" in sql.lower()
        assert "product" in sql.lower() or at == "predictive"


def test_ensure_rewrites_unbound_diagnostic_and_animate_sql():
    from ee.modules.ai.utils.mode_sql_builders import ensure_mode_contract_sql

    broken = 'SELECT "not_a_col" AS focus_dimension, SUM("also_fake") AS value FROM "loans" GROUP BY 1'
    out = ensure_mode_contract_sql(
        "diagnostic",
        broken,
        BANKING_SCHEMA,
        {},
        db_type="postgresql",
        data_source_type="postgres",
    )
    assert out is not None
    assert "not_a_col" not in out
    assert "also_fake" not in out
    assert "amount" in out.lower()

    broken_an = 'SELECT "ghost_date" AS period, "ghost_cat" AS category, SUM("ghost") AS value FROM "loans" GROUP BY 1, 2'
    out_an = ensure_mode_contract_sql(
        "animate",
        broken_an,
        BANKING_SCHEMA,
        {},
        db_type="postgresql",
        data_source_type="postgres",
    )
    assert out_an is not None
    assert "ghost_date" not in out_an
    assert "as period" in out_an.lower() and "as category" in out_an.lower()


async def test_error_correction_rebuilds_unbound_forecast_sql_instead_of_dialect():
    from unittest.mock import AsyncMock, patch

    from ee.modules.ai.nodes.error_correction_node import error_correction_node

    broken = (
        'SELECT DATE_TRUNC(\'MONTH\', "disbursement_date") AS period, '
        'SUM("current_balance") AS value FROM "banking"."accounts" GROUP BY 1'
    )
    state = {
        "query": "forecast current balance",
        "analytics_type": "predictive",
        "sql_query": broken,
        "error": (
            'Binder Error: Referenced column "disbursement_date" not found in FROM clause!\n'
            'Candidate bindings: "customer_id", "current_balance", "account_id", "available_balance"'
        ),
        "correction_context": {"error_type": "sql"},
        "data_source_schema": ACCOUNTS_WITHOUT_DATE,
        "data_source_db_type": "duckdb",
        "data_source_type": "file",
        "delegation_context": {
            "time_column": "disbursement_date",
            "target_metric": "current_balance",
        },
        "execution_metadata": {},
    }
    with patch(
        "ee.modules.ai.nodes.error_correction_node._fix_sql_with_llm",
        new_callable=AsyncMock,
    ) as mock_llm:
        out = await error_correction_node(state, litellm_service=object())
    sql = (out.get("sql_query") or "").lower()
    assert sql
    assert forecast_sql_columns_bind(out["sql_query"], ACCOUNTS_WITHOUT_DATE) is True
    mock_llm.assert_not_called()
    if "disbursement_date" in sql and "accounts" in sql:
        assert "join" in sql


async def test_error_correction_compiles_simple_fact_instead_of_fixer_llm():
    from unittest.mock import AsyncMock, patch

    from ee.modules.ai.nodes.error_correction_node import error_correction_node

    schema = {
        "tables": [
            {
                "schema": "banking",
                "name": "loans",
                "columns": [
                    {"name": "loan_id", "type": "uuid", "is_primary_key": True},
                    {"name": "customer_id", "type": "uuid"},
                    {"name": "amount", "type": "numeric"},
                ],
            }
        ]
    }
    state = {
        "query": "how many customers with loan amount > 100$",
        "error": "LLM timed out after 12.0s",
        "sql_query": None,
        "correction_context": {"error_type": "sql"},
        "data_source_schema": schema,
        "data_source_db_type": "postgresql",
        "data_source_type": "postgres",
        "execution_metadata": {},
    }
    with patch(
        "ee.modules.ai.nodes.error_correction_node._correct_sql",
        new_callable=AsyncMock,
    ) as mock_fix:
        out = await error_correction_node(state, litellm_service=None)
    mock_fix.assert_not_called()
    assert out.get("sql_query")
    assert "count(" in out["sql_query"].lower()
    assert "amount" in out["sql_query"].lower()


async def test_error_correction_skips_fixer_llm_after_simple_fact_timeout():
    from unittest.mock import AsyncMock, patch

    from ee.modules.ai.nodes.error_correction_node import error_correction_node

    state = {
        "query": "how many customers with loan amount > 100$",
        "error": "Request timed out",
        "sql_query": None,
        "correction_context": {"error_type": "sql"},
        "data_source_schema": {"tables": []},
        "execution_metadata": {},
    }
    with patch(
        "ee.modules.ai.nodes.error_correction_node._correct_sql",
        new_callable=AsyncMock,
    ) as mock_fix:
        out = await error_correction_node(state, litellm_service=None)
    mock_fix.assert_not_called()
    assert out.get("sql_correction_skip_reason") == "llm_timeout_no_sql"


async def test_error_correction_skips_fixer_llm_after_why_timeout_too():
    from unittest.mock import AsyncMock, patch

    from ee.modules.ai.nodes.error_correction_node import error_correction_node

    state = {
        "query": "why did loan defaults rise last quarter",
        "error": "LLM timed out after 45.0s",
        "sql_query": None,
        "correction_context": {"error_type": "sql"},
        "data_source_schema": {"tables": []},
        "execution_metadata": {},
    }
    with patch(
        "ee.modules.ai.nodes.error_correction_node._correct_sql",
        new_callable=AsyncMock,
    ) as mock_fix:
        out = await error_correction_node(state, litellm_service=None)
    mock_fix.assert_not_called()
    assert out.get("sql_correction_skip_reason") == "llm_timeout_no_sql"
