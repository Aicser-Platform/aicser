"""Relationship inference for CE data modeling."""

from src.modules.data.model_service import _detect_relationship_candidates


def test_detects_shared_key_fact_dimension_relationships():
    schema = {
        "tables": [
            {
                "name": "fact_marketing_campaign",
                "row_count": 1000,
                "columns": [
                    {"name": "fact_id", "type": "int"},
                    {"name": "device_key", "type": "int"},
                    {"name": "channel_key", "type": "int"},
                    {"name": "clicks", "type": "int"},
                    {"name": "conversions", "type": "int"},
                ],
            },
            {
                "name": "dim_device",
                "row_count": 3,
                "columns": [
                    {"name": "device_key", "type": "int"},
                    {"name": "device", "type": "varchar"},
                ],
            },
            {
                "name": "dim_channel",
                "row_count": 6,
                "columns": [
                    {"name": "channel_key", "type": "int"},
                    {"name": "channel", "type": "varchar"},
                ],
            },
        ]
    }

    relationships = _detect_relationship_candidates(schema)
    keys = {
        (r["from_table"], r["from_column"], r["to_table"], r["to_column"], r["source"])
        for r in relationships
    }

    assert (
        "fact_marketing_campaign",
        "device_key",
        "dim_device",
        "device_key",
        "shared_key",
    ) in keys
    assert (
        "fact_marketing_campaign",
        "channel_key",
        "dim_channel",
        "channel_key",
        "shared_key",
    ) in keys



def test_pipeline_audit_columns_are_not_join_keys():
    """Every pipeline Silver/Gold table carries _load_id; matching on it joined
    order_items to customers by load batch, and the served tables don't have it."""
    from src.modules.data.model_service import _detect_relationship_candidates

    audit = [{"name": "_load_id", "type": "varchar"}, {"name": "_ingested_at", "type": "timestamp"}]
    schema = {
        "tables": [
            {"name": "order_items", "columns": [
                {"name": "order_id", "type": "int"}, {"name": "quantity", "type": "int"}, *audit]},
            {"name": "orders", "columns": [
                {"name": "order_id", "type": "int"}, {"name": "order_date", "type": "date"}, *audit]},
            {"name": "customers", "columns": [
                {"name": "customer_id", "type": "int"}, {"name": "first_name", "type": "varchar"}, *audit]},
        ]
    }

    relationships = _detect_relationship_candidates(schema)

    assert not any("_load_id" in (r["from_column"], r["to_column"]) for r in relationships)
    assert {(r["from_table"], r["to_table"]) for r in relationships} == {("order_items", "orders")}


def test_schema_qualified_banking_entity_pk():
    schema = {
        "tables": [
            {
                "name": "banking.customers",
                "row_count": 500,
                "columns": [
                    {"name": "id", "type": "int"},
                    {"name": "full_name", "type": "varchar"},
                ],
            },
            {
                "name": "banking.loans",
                "row_count": 5000,
                "columns": [
                    {"name": "loan_id", "type": "int"},
                    {"name": "customer_id", "type": "int"},
                    {"name": "branch_id", "type": "int"},
                ],
            },
            {
                "name": "banking.branches",
                "row_count": 40,
                "columns": [
                    {"name": "branch_id", "type": "int"},
                    {"name": "name", "type": "varchar"},
                ],
            },
        ]
    }
    relationships = _detect_relationship_candidates(schema)
    pairs = {(r["from_table"], r["from_column"], r["to_table"], r["to_column"]) for r in relationships}
    assert ("banking.loans", "customer_id", "banking.customers", "id") in pairs
    assert ("banking.loans", "branch_id", "banking.branches", "branch_id") in pairs


def test_cross_source_same_key_column():
    from src.modules.data.model_service import _detect_cross_source_candidates

    sources = [
        (
            "ds-enrollment",
            {
                "tables": [
                    {
                        "name": "enrollment",
                        "row_count": 1000,
                        "columns": [{"name": "student_id", "type": "int"}, {"name": "status", "type": "varchar"}],
                    }
                ]
            },
        ),
        (
            "ds-students",
            {
                "tables": [
                    {
                        "name": "students",
                        "row_count": 200,
                        "columns": [{"name": "student_id", "type": "int"}, {"name": "name", "type": "varchar"}],
                    }
                ]
            },
        ),
    ]
    cross = _detect_cross_source_candidates(sources)
    assert any(
        r["from_column"] == "student_id" and r["to_column"] == "student_id" for r in cross
    )


def test_uploaded_files_with_flat_columns_link_across_sources():
    """Uploads store one flat column list (no `tables`); detection reads each as one table named
    after the source, so two uploads sharing loan_id are linked."""
    import types

    from src.modules.data.model_service import _detect_cross_source_candidates, _detection_schema

    loans = types.SimpleNamespace(name="loans", schema={"columns": [{"name": "loan_id", "type": "string"}, {"name": "amount", "type": "number"}]})
    payments = types.SimpleNamespace(name="loan_payments", schema={"columns": [{"name": "loan_id", "type": "string"}, {"name": "paid", "type": "number"}]})

    assert _detection_schema(loans)["tables"][0]["name"] == "loans"
    found = _detect_cross_source_candidates([("a", _detection_schema(loans)), ("b", _detection_schema(payments))])
    assert any(c["from_table"] == "loans" and c["to_table"] == "loan_payments" and c["from_column"] == "loan_id" for c in found)
