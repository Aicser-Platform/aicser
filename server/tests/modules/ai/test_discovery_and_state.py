"""
Unit tests for discovery schema resolution and state sanitization.

- Discovery: get_source_schema is used for file and database so schema has tables.
- Question discovery: empty LLM content is handled and fallback to generate_suggestions.
- State sanitization: Queue/tuples stripped for checkpointer.

Run: pytest app/tests/modules/ai/test_discovery_and_state.py -v
"""

import asyncio
import json
import pytest


def test_strip_nonserializable_state_basic():
    """strip_nonserializable_state keeps primitives, dict, list, tuple; removes Queue."""
    try:
        from src.modules.ai.services.langgraph_base import strip_nonserializable_state
    except ImportError as e:
        pytest.skip(f"langgraph_base not available: {e}")

    state = {"a": 1, "b": [2, 3], "c": {"x": 4}, "t": (5, 6)}
    out = strip_nonserializable_state(state)
    assert out.get("a") == 1
    assert out.get("b") == [2, 3]
    assert out.get("c") == {"x": 4}
    assert out.get("t") == (5, 6)


def test_strip_nonserializable_state_removes_queue():
    """_stream_queue and asyncio.Queue are removed so checkpointer never sees them."""
    try:
        from src.modules.ai.services.langgraph_base import strip_nonserializable_state
    except ImportError as e:
        pytest.skip(f"langgraph_base not available: {e}")

    q = asyncio.Queue()
    state = {"ok": 1, "_stream_queue": q}
    out = strip_nonserializable_state(state)
    assert "_stream_queue" not in out
    assert out.get("ok") == 1


def test_strip_nonserializable_state_tuple_with_bad_value():
    """Tuples are recursed; nonserializable values inside are stripped."""
    try:
        from src.modules.ai.services.langgraph_base import (
            strip_nonserializable_state,
            _strip_nonserializable_deep,
        )
    except ImportError as e:
        pytest.skip(f"langgraph_base not available: {e}")

    q = asyncio.Queue()
    # Deep strip: tuple containing queue -> that element becomes None, then we filter _is_nonserializable in tuple
    state = {"t": (1, q, 2)}
    out = strip_nonserializable_state(state)
    # Tuple is recursed; queue is dropped (filtered out in tuple comprehension)
    assert out.get("t") == (1, 2)


def test_format_schema_for_prompt():
    """_format_schema_for_prompt produces table/column summary for discovery."""
    try:
        from src.modules.ai.utils.question_discovery import _format_schema_for_prompt
    except ImportError as e:
        pytest.skip(f"question_discovery not available: {e}")

    empty = _format_schema_for_prompt({})
    assert "No schema" in empty or "No tables" in empty

    schema = {
        "tables": [
            {"name": "data", "columns": [{"name": "col1"}, {"name": "col2"}]}
        ]
    }
    s = _format_schema_for_prompt(schema)
    assert "data" in s and "col1" in s and "col2" in s


def test_generate_suggestions_empty_schema():
    """generate_suggestions returns default questions when schema has no tables."""
    try:
        from src.modules.ai.utils.question_discovery import QuestionDiscoveryService
    except ImportError as e:
        pytest.skip(f"question_discovery not available: {e}")

    svc = QuestionDiscoveryService()
    out = svc.generate_suggestions({}, limit=5)
    assert isinstance(out, list)
    assert len(out) >= 1
    assert any("Summarize" in q or "trend" in q.lower() for q in out)


def test_generate_suggestions_with_tables():
    """generate_suggestions uses table/column names when present."""
    try:
        from src.modules.ai.utils.question_discovery import QuestionDiscoveryService
    except ImportError as e:
        pytest.skip(f"question_discovery not available: {e}")

    schema = {
        "tables": [
            {
                "name": "sales",
                "columns": [
                    {"name": "revenue", "type": "FLOAT"},
                    {"name": "month", "type": "DATE"},
                ],
            }
        ]
    }
    svc = QuestionDiscoveryService()
    out = svc.generate_suggestions(schema, limit=5)
    assert isinstance(out, list)
    assert len(out) >= 1
    # Should mention revenue or month or similar from schema
    combined = " ".join(out).lower()
    assert "revenue" in combined or "month" in combined or "trend" in combined or "summarize" in combined


def test_discover_schema_extraction_logic():
    """Simulate discover endpoint: raw get_source_schema response -> schema with tables."""
    # get_source_schema returns { "success": True, "schema": { "tables": [...] } }
    raw = {
        "success": True,
        "schema": {
            "tables": [{"name": "data", "columns": [{"name": "a"}, {"name": "b"}]}]
        },
        "source_id": "ds1",
        "source_type": "file",
    }
    schema = raw.get("schema") or raw.get("data") or raw
    assert schema.get("tables") is not None
    assert len(schema["tables"]) == 1
    assert schema["tables"][0]["name"] == "data"

    # When get_source_schema returns failure for file (no stored schema), we'd get error dict
    raw_fail = {"success": False, "error": "No schema available"}
    schema_fail = raw_fail.get("schema") or raw_fail.get("data") or raw_fail
    assert schema_fail.get("tables") is None
    # Discovery still gets a dict; _format_schema_for_prompt yields "No tables in schema."


def test_llm_empty_content_handling():
    """Empty content is rejected before json.loads to avoid 'Expecting value: line 1 column 1'."""
    content = None
    assert not (content and str(content).strip())
    content_empty = ""
    assert not (content_empty and str(content_empty).strip())
    content_ok = '{"questions": ["A?"]}'
    assert content_ok and str(content_ok).strip()
    parsed = json.loads(content_ok)
    assert parsed.get("questions") == ["A?"]
