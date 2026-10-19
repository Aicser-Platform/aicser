from ee.modules.ai.domain_templates.router import PACK_VERSION, _as_config_dict, _pack_payload


def test_as_config_dict_parses_json_and_dicts():
    assert _as_config_dict({"domain_template": "banking"})["domain_template"] == "banking"
    assert _as_config_dict('{"domain_template": "retail"}')["domain_template"] == "retail"
    assert _as_config_dict(None) == {}
    assert _as_config_dict("not-json") == {}


def test_pack_payload_is_pointer_metadata_only():
    payload = _pack_payload(
        {
            "id": "banking",
            "name": "Banking",
            "description": "FIBO",
            "measures": ["npl", "balance"],
            "dimensions": ["region"],
            "ontology_mapping": {"table_concept": {"loans": "Loan"}},
        }
    )
    assert payload["id"] == "banking"
    assert payload["sku"] == "industry"
    assert payload["pack_version"] == PACK_VERSION
    assert payload["has_ontology"] is True
    assert "sql" not in payload
    assert "bytes" not in payload
