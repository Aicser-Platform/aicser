"""Task 8b: multi-metric specs + parameterized compilation."""

import pytest

from ee.modules.semantic.compiler import SemanticQueryCompiler
from ee.modules.semantic.query_spec import SemanticFilter, SemanticQuerySpec

METRICS = [
    {"name": "total_revenue", "expression": "SUM(amount_usd)", "metric_type": "simple"},
    {"name": "order_count", "expression": "COUNT(*)", "metric_type": "simple"},
]
DIMENSIONS = [{"name": "country", "expression": "ship_country"}]
SCHEMA = {"tables": [{"name": "orders", "schema": "public"}]}


def _compiler():
    return SemanticQueryCompiler(
        metrics=METRICS, dimensions=DIMENSIONS, join_paths=[], schema_info=SCHEMA
    )


def test_single_metric_keeps_metric_value_alias():
    spec = SemanticQuerySpec(
        data_source_id="ds", metric="total_revenue", dimensions=["country"]
    )
    sql = _compiler().compile(spec).sql
    assert "SUM(amount_usd) AS metric_value" in sql


def test_two_metrics_aliased_by_name():
    spec = SemanticQuerySpec(
        data_source_id="ds",
        metrics=["total_revenue", "order_count"],
        dimensions=["country"],
    )
    sql = _compiler().compile(spec).sql
    assert "SUM(amount_usd) AS total_revenue" in sql
    assert "COUNT(*) AS order_count" in sql
    assert "GROUP BY ship_country" in sql


def test_order_by_second_metric_name_allowed():
    spec = SemanticQuerySpec(
        data_source_id="ds",
        metrics=["total_revenue", "order_count"],
        dimensions=["country"],
        order_by="order_count",
        order_dir="asc",
    )
    sql = _compiler().compile(spec).sql
    assert "ORDER BY order_count ASC" in sql


def test_unknown_metric_in_list_gets_availability_error():
    spec = SemanticQuerySpec(
        data_source_id="ds", metrics=["total_revenue", "nope"], dimensions=[]
    )
    with pytest.raises(ValueError, match="available metrics"):
        _compiler().compile(spec)


def test_parameterize_emits_placeholders_and_params():
    spec = SemanticQuerySpec(
        data_source_id="ds",
        metric="total_revenue",
        dimensions=["country"],
        filters=[SemanticFilter(field="country", operator="eq", value="Cambodia")],
    )
    compiled = _compiler().compile(spec, parameterize=True)
    assert ":sp_0" in compiled.sql
    assert compiled.params == {"sp_0": "Cambodia"}
    assert "'Cambodia'" not in compiled.sql


def test_parameterize_keeps_injection_out_of_sql_text():
    hostile = "KH'; DROP TABLE x;--"
    spec = SemanticQuerySpec(
        data_source_id="ds",
        metric="total_revenue",
        dimensions=[],
        filters=[SemanticFilter(field="country", operator="eq", value=hostile)],
    )
    compiled = _compiler().compile(spec, parameterize=True)
    assert "DROP TABLE" not in compiled.sql
    assert compiled.params["sp_0"] == hostile


def test_backcompat_single_metric_field_still_works_unparameterized():
    spec = SemanticQuerySpec(
        data_source_id="ds",
        metric="total_revenue",
        dimensions=["country"],
        filters=[SemanticFilter(field="country", operator="eq", value="Cambodia")],
    )
    sql = _compiler().compile(spec).sql
    assert "country = 'Cambodia'" in sql


def test_metric_table_ownership_selects_non_first_schema_table():
    compiler = SemanticQueryCompiler(
        metrics=[
            {
                "name": "total_payments",
                "expression": "SUM(fact_payments.amount_usd)",
                "metric_type": "simple",
                "table_name": "fact_payments",
            }
        ],
        dimensions=[],
        join_paths=[],
        schema_info={
            "tables": [
                {"name": "dim_customer", "schema": "accounting"},
                {"name": "fact_payments", "schema": "accounting"},
            ]
        },
    )
    sql = compiler.compile(SemanticQuerySpec(data_source_id="ds", metric="total_payments")).sql
    assert "FROM accounting.fact_payments AS fact_payments" in sql
    assert "FROM accounting.dim_customer" not in sql


def test_dimension_table_ownership_uses_modeled_join_and_qualified_physical_table():
    compiler = SemanticQueryCompiler(
        metrics=[
            {
                "name": "total_payments",
                "expression": "SUM(fact_payments.amount_usd)",
                "metric_type": "simple",
                "table_name": "fact_payments",
            }
        ],
        dimensions=[
            {
                "name": "vendor_name",
                "expression": "dim_vendor.vendor_name",
                "table_name": "dim_vendor",
            }
        ],
        join_paths=[
            {
                "from_table": "fact_payments",
                "from_column": "vendor_id",
                "to_table": "dim_vendor",
                "to_column": "vendor_id",
                "join_type": "LEFT",
            }
        ],
        schema_info={
            "tables": [
                {"name": "fact_payments", "schema": "accounting"},
                {"name": "dim_vendor", "schema": "accounting"},
            ]
        },
    )
    spec = SemanticQuerySpec(
        data_source_id="ds", metric="total_payments", dimensions=["vendor_name"]
    )
    sql = compiler.compile(spec).sql
    assert "FROM accounting.fact_payments AS fact_payments" in sql
    assert "LEFT JOIN accounting.dim_vendor AS dim_vendor" in sql
    assert "ON fact_payments.vendor_id = dim_vendor.vendor_id" in sql


def test_joined_dimension_with_camel_case_foreign_key_is_quoted_and_aliased():
    compiler = SemanticQueryCompiler(
        metrics=[
            {
                "name": "total_questions",
                "expression": 'SUM(subject."questionCount")',
                "metric_type": "simple",
                "table_name": "subject",
                "type_params": {"source": 'public."Subject"', "table": "subject"},
            }
        ],
        dimensions=[
            {
                "id": "dim-university-name",
                "name": "name",
                "expression": "university.name",
                "table_name": "university",
            }
        ],
        join_paths=[
            {
                "from_table": "subject",
                "from_column": "universityId",
                "to_table": "university",
                "to_column": "id",
                "join_type": "LEFT",
            }
        ],
        schema_info={
            "tables": [
                {"name": "Subject", "schema": "public"},
                {"name": "University", "schema": "public"},
            ]
        },
    )
    sql = compiler.compile(
        SemanticQuerySpec(data_source_id="ds", metric="total_questions", dimensions=["dim-university-name"])
    ).sql
    assert 'FROM public."Subject" AS subject' in sql
    assert 'LEFT JOIN public."University" AS university' in sql
    assert 'ON subject."universityId" = university.id' in sql


def test_global_join_cycle_does_not_block_single_table_metric():
    compiler = SemanticQueryCompiler(
        metrics=[
            {
                "name": "total_payments",
                "expression": "SUM(fact_payments.amount_usd)",
                "metric_type": "simple",
                "table_name": "fact_payments",
            }
        ],
        dimensions=[],
        join_paths=[
            {
                "from_table": "fact_payments",
                "from_column": "date_key",
                "to_table": "dim_date",
                "to_column": "date_key",
                "join_type": "LEFT",
            },
            {
                "from_table": "fact_journal",
                "from_column": "date_key",
                "to_table": "dim_date",
                "to_column": "date_key",
                "join_type": "LEFT",
            },
            {
                "from_table": "fact_journal",
                "from_column": "date_key",
                "to_table": "fact_payments",
                "to_column": "date_key",
                "join_type": "LEFT",
            },
        ],
        schema_info={
            "tables": [
                {"name": "fact_payments", "schema": "accounting"},
                {"name": "dim_date", "schema": "accounting"},
                {"name": "fact_journal", "schema": "accounting"},
            ]
        },
    )
    sql = compiler.compile(SemanticQuerySpec(data_source_id="ds", metric="total_payments")).sql
    assert "FROM accounting.fact_payments AS fact_payments" in sql
    assert "JOIN" not in sql


def test_single_physical_table_strips_stale_logical_prefixes():
    compiler = SemanticQueryCompiler(
        metrics=[
            {
                "name": "revenue_usd",
                "expression": "SUM(fact_monthly_financials.revenue_usd)",
                "metric_type": "simple",
                "table_name": "fact_monthly_financials",
            }
        ],
        dimensions=[
            {
                "name": "category",
                "expression": "dim_product.category",
                "table_name": "dim_product",
            }
        ],
        join_paths=[],
        dialect="file",
        schema_info={
            "columns": [
                {"name": "revenue_usd", "type": "number"},
                {"name": "category", "type": "string"},
            ]
        },
    )
    spec = SemanticQuerySpec(data_source_id="ds", metric="revenue_usd", dimensions=["category"])
    sql = compiler.compile(spec).sql
    assert 'FROM "data"' in sql
    assert "SUM(revenue_usd) AS metric_value" in sql
    assert "dim_product.category" not in sql
    assert "GROUP BY category" in sql


def test_unjoined_dimension_returns_readable_compile_error():
    compiler = SemanticQueryCompiler(
        metrics=[
            {
                "name": "revenue_usd",
                "expression": "SUM(fact_monthly_financials.revenue_usd)",
                "metric_type": "simple",
                "table_name": "fact_monthly_financials",
            }
        ],
        dimensions=[
            {
                "name": "category",
                "expression": "fact_bank_transactions.category",
                "table_name": "fact_bank_transactions",
            }
        ],
        join_paths=[],
        dialect="file",
        schema_info={
            "tables": [
                {
                    "name": "fact_monthly_financials",
                    "columns": [{"name": "revenue_usd", "type": "number"}],
                },
                {
                    "name": "fact_bank_transactions",
                    "columns": [{"name": "category", "type": "string"}],
                },
            ]
        },
    )
    spec = SemanticQuerySpec(data_source_id="ds", metric="revenue_usd", dimensions=["category"])
    with pytest.raises(ValueError, match="unjoined_table:fact_bank_transactions"):
        compiler.compile(spec)


def test_dimensionless_metrics_from_unjoined_fact_tables_compile_as_scalar_totals():
    compiler = SemanticQueryCompiler(
        metrics=[
            {
                "name": "account_code",
                "expression": "SUM(fact_journal.account_code)",
                "metric_type": "simple",
                "table_name": "fact_journal",
            },
            {
                "name": "amount_paid_usd",
                "expression": "SUM(fact_invoices.amount_paid_usd)",
                "metric_type": "simple",
                "table_name": "fact_invoices",
            },
            {
                "name": "amount_usd",
                "expression": "SUM(fact_payments.amount_usd)",
                "metric_type": "simple",
                "table_name": "fact_payments",
            },
            {
                "name": "ar_balance_usd",
                "expression": "SUM(fact_monthly_financials.ar_balance_usd)",
                "metric_type": "simple",
                "table_name": "fact_monthly_financials",
            },
        ],
        dimensions=[],
        join_paths=[],
        dialect="file",
        schema_info={
            "tables": [
                {
                    "name": "fact_journal",
                    "schema": "main",
                    "columns": [{"name": "account_code", "type": "number"}],
                },
                {
                    "name": "fact_invoices",
                    "schema": "main",
                    "columns": [{"name": "amount_paid_usd", "type": "number"}],
                },
                {
                    "name": "fact_payments",
                    "schema": "main",
                    "columns": [{"name": "amount_usd", "type": "number"}],
                },
                {
                    "name": "fact_monthly_financials",
                    "schema": "main",
                    "columns": [{"name": "ar_balance_usd", "type": "number"}],
                },
            ]
        },
    )
    spec = SemanticQuerySpec(
        data_source_id="ds",
        metrics=["account_code", "amount_paid_usd", "amount_usd", "ar_balance_usd"],
        dimensions=[],
        filters=[],
        limit=500,
    )
    compiled = compiler.compile(spec)
    assert compiled.explain["metric_type"] == "multi_scalar"
    assert "(SELECT SUM(account_code) FROM main.fact_journal AS fact_journal) AS account_code" in compiled.sql
    assert "(SELECT SUM(amount_paid_usd) FROM main.fact_invoices AS fact_invoices) AS amount_paid_usd" in compiled.sql
    assert "(SELECT SUM(amount_usd) FROM main.fact_payments AS fact_payments) AS amount_usd" in compiled.sql
    assert (
        "(SELECT SUM(ar_balance_usd) FROM main.fact_monthly_financials AS fact_monthly_financials) AS ar_balance_usd"
        in compiled.sql
    )
    assert "JOIN" not in compiled.sql
    assert compiled.sql.endswith("LIMIT 500")


def test_metric_physical_source_uses_semantic_alias_and_quotes_table():
    compiler = SemanticQueryCompiler(
        metrics=[
            {
                "name": "total_selected_index",
                "expression": 'SUM(attempt_answer."selectedIndex")',
                "metric_type": "simple",
                "type_params": {
                    "table": "attempt_answer",
                    "source": 'public."AttemptAnswer"',
                },
            }
        ],
        dimensions=[],
        join_paths=[],
        dialect="postgresql",
        schema_info={
            "tables": [
                {
                    "name": "AttemptAnswer",
                    "schema": "public",
                    "columns": [{"name": "selectedIndex", "type": "integer"}],
                }
            ]
        },
    )
    sql = compiler.compile(
        SemanticQuerySpec(data_source_id="ds", metric="total_selected_index")
    ).sql
    assert 'FROM public."AttemptAnswer" AS attempt_answer' in sql
    assert 'SUM(attempt_answer."selectedIndex") AS metric_value' in sql
