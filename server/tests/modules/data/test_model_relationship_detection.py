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

