"""Template library must answer common top-N questions without an LLM."""

from ee.modules.ai.services.template_library import TemplateLibrary


BANKING_SCHEMA = {
    "tables": [
        {
            "name": "banking.accounts",
            "columns": [
                {"name": "account_id"},
                {"name": "customer_id"},
                {"name": "current_balance"},
            ],
        },
        {
            "name": "banking.loans",
            "columns": [
                {"name": "loan_id"},
                {"name": "customer_id"},
                {"name": "loan_amount"},
                {"name": "interest_rate"},
            ],
        },
        {
            "name": "banking.customers",
            "columns": [
                {"name": "customer_id"},
                {"name": "full_name"},
            ],
        },
    ]
}


def test_metric_per_top_n_matches_natural_phrasing() -> None:
    lib = TemplateLibrary()
    hit = lib.match("how much amount loan per top 10 customers", BANKING_SCHEMA, db_type="duckdb")
    assert hit is not None
    assert hit["template_id"] == "metric_per_top_n"
    sql = hit["sql"].lower()
    assert "limit 10" in sql
    assert "loan_amount" in sql
    assert "customer_id" in sql
    assert "banking" in sql
    assert "loans" in sql


def test_top_n_by_metric_does_not_require_a_time_column() -> None:
    lib = TemplateLibrary()
    hit = lib.match("top 10 customers by loan amount", BANKING_SCHEMA, db_type="duckdb")
    assert hit is not None
    assert "limit 10" in hit["sql"].lower()


def test_template_miss_falls_through() -> None:
    lib = TemplateLibrary()
    assert lib.match("why did churn spike last quarter", BANKING_SCHEMA, db_type="duckdb") is None
