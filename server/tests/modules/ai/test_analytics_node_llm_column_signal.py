"""Tests for analytics_node._llm_column_classification_signal -- the piece
that wires column_semantic_classifier's cached LLM column classification
into profile_dataframe (see data_profiler.py's llm_classifications param and
test_data_profiler_llm_column_classification.py).

analytics_node is the chokepoint for this integration: the one caller of
profile_dataframe that already runs async with both data_source_id and
data_source_schema in state on every real query. These tests exercise just
the helper in isolation (analytics_node() itself is a large, deeply-wired
function outside this change's scope to fully harness) -- confirming it
fetches the signal with the right arguments, and fails open on every
input/error edge so a classification-cache problem can never block
analytics.
"""

import pytest

from ee.modules.ai.nodes.analytics_node import _llm_column_classification_signal


@pytest.mark.asyncio
async def test_returns_none_without_data_source_id():
    state = {"data_source_schema": {"tables": [{"name": "orders", "columns": []}]}}
    assert await _llm_column_classification_signal(state) is None


@pytest.mark.asyncio
async def test_returns_none_without_schema():
    state = {"data_source_id": "ds-1"}
    assert await _llm_column_classification_signal(state) is None


@pytest.mark.asyncio
async def test_returns_none_when_schema_is_not_a_dict():
    state = {"data_source_id": "ds-1", "data_source_schema": "not-a-schema"}
    assert await _llm_column_classification_signal(state) is None


@pytest.mark.asyncio
async def test_fetches_cache_with_data_source_id_and_schema_from_state(monkeypatch):
    import ee.modules.ai.services.column_semantic_classifier as ccmod

    seen = {}

    async def fake_ensure_fresh(data_source_id, schema):
        seen["data_source_id"] = data_source_id
        seen["schema"] = schema
        return {"amount": {"classification": "metric", "confidence": 0.9, "reasoning": "r"}}

    monkeypatch.setattr(ccmod, "ensure_column_classifications_fresh", fake_ensure_fresh)

    schema = {"tables": [{"name": "orders", "columns": [{"name": "amount", "type": "NUMERIC"}]}]}
    state = {"data_source_id": "ds-1", "data_source_schema": schema}

    result = await _llm_column_classification_signal(state)

    assert result == {"amount": {"classification": "metric", "confidence": 0.9, "reasoning": "r"}}
    assert seen == {"data_source_id": "ds-1", "schema": schema}


@pytest.mark.asyncio
async def test_fails_open_to_none_when_the_cache_lookup_raises(monkeypatch):
    """A classification-cache problem (DB down, import error, ...) must
    never block or fail the analytics query -- the caller's profile_dataframe
    call just proceeds on its heuristic fallback."""
    import ee.modules.ai.services.column_semantic_classifier as ccmod

    async def raising_ensure_fresh(*a, **k):
        raise RuntimeError("cache backend unavailable")

    monkeypatch.setattr(ccmod, "ensure_column_classifications_fresh", raising_ensure_fresh)

    schema = {"tables": [{"name": "orders", "columns": [{"name": "amount", "type": "NUMERIC"}]}]}
    state = {"data_source_id": "ds-1", "data_source_schema": schema}

    result = await _llm_column_classification_signal(state)
    assert result is None
