"""Drafting a semantic model from a schema, without an AI model."""

from ee.modules.ai.services.semantic_layer import auto_generate_semantic_layer


def test_uploaded_file_with_flat_columns_drafts_metrics_on_its_own_name():
    """Uploads store one flat column list with generic types; drafting must still find the table,
    treat `number` as numeric, and average scores and rates instead of summing them."""
    schema = {
        "columns": [
            {"name": "loan_id", "type": "string"},
            {"name": "branch_province", "type": "string"},
            {"name": "credit_score", "type": "number"},
            {"name": "loan_amount_usd", "type": "number"},
            {"name": "interest_rate_pct", "type": "number"},
        ]
    }

    draft = auto_generate_semantic_layer(schema, data_source_name="loans", db_type="file")
    metrics = {m["name"]: m["expression"] for m in draft["metrics"]}

    assert metrics == {
        "total_loans": "COUNT(*)",
        "average_credit_score": "AVG(loans.credit_score)",
        "loan_amount_usd": "SUM(loans.loan_amount_usd)",
        "average_interest_rate_pct": "AVG(loans.interest_rate_pct)",
    }
    assert [d["expression"] for d in draft["dimensions"]] == ["loans.branch_province"]
