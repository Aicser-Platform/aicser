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
