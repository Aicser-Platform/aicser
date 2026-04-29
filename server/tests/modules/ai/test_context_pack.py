"""Golden-style checks for context pack shape (trust / eval replay)."""

from src.modules.ai.services.context_pack import (
    CONTEXT_PACK_VERSION,
    build_context_pack_conversational,
    build_context_pack_from_final_state,
)


def test_build_context_pack_from_final_state_minimal():
    state = {
        "data_source_id": "ds-1",
        "data_source_name": "Demo",
        "data_source_type": "database",
        "sql_query": "SELECT 1 AS a",
        "query_result": [{"a": 1}],
        "query_result_row_count": 1,
        "data_source_schema": {"tables": [{"name": "t1", "columns": [{"name": "id"}]}]},
        "semantic_context_pack": {
            "hint_injected": True,
            "metric_names": ["revenue"],
            "dimension_names": ["region"],
        },
        "execution_metadata": {"model": "gpt-test", "trace_id": "tr-1"},
        "analytics_type": "descriptive",
        "current_stage": "complete",
    }
    pack = build_context_pack_from_final_state(state, query="How is revenue by region?", project_id="p1")
    assert pack["version"] == CONTEXT_PACK_VERSION
    assert pack["project_id"] == "p1"
    assert pack["query_preview"].startswith("How is revenue")
    assert pack["data_source"]["id"] == "ds-1"
    assert pack["schema_snapshot"]["structure_hash"] != "none"
    assert "t1" in (pack["schema_snapshot"]["tables_sample"] or [])
    assert pack["semantic_layer"]["hint_injected"] is True
    assert pack["semantic_layer"]["metric_names"] == ["revenue"]
    assert pack["sql"]["fingerprint"] is not None
    assert pack["sql"]["executed"] is True
    assert pack["model"]["id"] == "gpt-test"


def test_build_context_pack_conversational():
    pack = build_context_pack_conversational(query="Hello", model_id="m1", ai_engine="Conversational")
    assert pack["version"] == CONTEXT_PACK_VERSION
    assert pack["data_source"] is None
    assert pack["semantic_layer"]["hint_injected"] is False
    assert pack["workflow"]["mode"] == "Conversational"
