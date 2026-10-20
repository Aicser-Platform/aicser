import os

os.environ.setdefault("AISER_EDITION", "enterprise")

from src.modules.pipeline.relationship_publish import (
    _persistable,
    _payload_from_raw,
    relationships_from_wizard_state,
)


def test_relationships_from_wizard_state():
    state = {
        "semanticConfig": {
            "relationshipsByTable": {
                "orders": [
                    {
                        "factTable": "orders",
                        "factColumn": "customer_id",
                        "dimensionTable": "customers",
                        "dimensionColumn": "id",
                        "type": "foreign_key",
                        "verified": True,
                    }
                ]
            }
        }
    }
    rels = relationships_from_wizard_state(state)
    assert "orders" in rels
    assert len(rels["orders"]) == 1


def test_relationships_from_wizard_state_empty():
    assert relationships_from_wizard_state(None) == {}
    assert relationships_from_wizard_state({}) == {}


def test_persistable_skips_date_dimension():
    assert _persistable({"type": "date_dimension", "dimensionTable": "dim_date"}) is False
    assert _persistable(
        {
            "factTable": "orders",
            "factColumn": "id",
            "dimensionTable": "customers",
            "dimensionColumn": "id",
            "type": "foreign_key",
        }
    ) is True


def test_payload_from_raw():
    payload = _payload_from_raw(
        {
            "factColumn": "customer_id",
            "dimensionTable": "customers",
            "dimensionColumn": "id",
            "verified": True,
        },
        "orders",
    )
    assert payload["from_table"] == "orders"
    assert payload["assume_integrity"] is True
