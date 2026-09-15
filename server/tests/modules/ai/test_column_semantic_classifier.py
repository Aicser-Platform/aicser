"""Tests for column_semantic_classifier.py -- the batched, per-data-source
LLM column classification (metric / dimension / identifier / timestamp) that
backs data_profiler.py's LLM signal (see
test_data_profiler_llm_column_classification.py for that side).

No live LLM or DB calls: LiteLLMService and semantic_layer_db are faked,
following the same pattern as test_dashboard_llm_planner.py and
test_kpi_definition_caching.py elsewhere in this test suite.
"""

import json

import pytest

from ee.modules.ai.services.column_semantic_classifier import (
    classify_data_source_columns_llm,
    compute_schema_fingerprint,
    ensure_column_classifications_fresh,
    get_cached_column_classifications,
    _iter_schema_columns,
    _sample_values_by_column,
    MAX_COLUMNS_PER_CALL,
    MAX_SAMPLE_VALUES_PER_COLUMN,
)

SCHEMA_A = {
    "tables": [
        {
            "name": "orders",
            "columns": [
                {"name": "id", "type": "INTEGER"},
                {"name": "amount", "type": "NUMERIC"},
            ],
        }
    ]
}

SCHEMA_A_COLUMNS_REORDERED = {
    "tables": [
        {
            "name": "orders",
            "columns": [
                {"name": "amount", "type": "NUMERIC"},
                {"name": "id", "type": "INTEGER"},
            ],
        }
    ]
}

SCHEMA_B_TYPE_CHANGED = {
    "tables": [
        {
            "name": "orders",
            "columns": [
                {"name": "id", "type": "INTEGER"},
                {"name": "amount", "type": "VARCHAR"},
            ],
        }
    ]
}

SCHEMA_C_COLUMN_ADDED = {
    "tables": [
        {
            "name": "orders",
            "columns": [
                {"name": "id", "type": "INTEGER"},
                {"name": "amount", "type": "NUMERIC"},
                {"name": "status", "type": "VARCHAR"},
            ],
        }
    ]
}


# ---------------------------------------------------------------------------
# compute_schema_fingerprint
# ---------------------------------------------------------------------------


def test_fingerprint_is_deterministic_and_column_order_independent():
    """A schema whose columns were serialized in a different order (a real
    possibility depending on the source connector) must produce the SAME
    fingerprint -- otherwise the cache would thrash on every read for no
    real schema change."""
    fp1 = compute_schema_fingerprint(SCHEMA_A)
    fp2 = compute_schema_fingerprint(SCHEMA_A_COLUMNS_REORDERED)
    assert fp1 == fp2
    assert compute_schema_fingerprint(SCHEMA_A) == fp1  # deterministic across calls


def test_fingerprint_changes_when_a_column_type_changes():
    """A type change alone (no columns added/removed) must still bust the
    cache -- this is exactly the schema-drift case the cache exists to
    detect."""
    assert compute_schema_fingerprint(SCHEMA_A) != compute_schema_fingerprint(SCHEMA_B_TYPE_CHANGED)


def test_fingerprint_changes_when_a_column_is_added():
    assert compute_schema_fingerprint(SCHEMA_A) != compute_schema_fingerprint(SCHEMA_C_COLUMN_ADDED)


def test_fingerprint_no_schema_sentinel():
    """None (never fetched schema) gets a dedicated sentinel rather than a
    hash, so it can never coincidentally collide with a real schema's hash."""
    assert compute_schema_fingerprint(None) == "no_schema"
    assert compute_schema_fingerprint("not-a-dict") == "no_schema"


# ---------------------------------------------------------------------------
# _iter_schema_columns / _sample_values_by_column (prompt-building helpers)
# ---------------------------------------------------------------------------


def test_iter_schema_columns_flattens_tables_and_caps_at_max():
    schema = {
        "tables": [
            {
                "name": "wide_table",
                "columns": [{"name": f"c{i}", "type": "INT"} for i in range(MAX_COLUMNS_PER_CALL + 10)],
            }
        ]
    }
    cols = _iter_schema_columns(schema)
    assert len(cols) == MAX_COLUMNS_PER_CALL


def test_sample_values_by_column_dedups_and_caps_per_column():
    rows = [{"status": "active"}] * 10 + [{"status": "inactive"}] + [{"status": None}]
    out = _sample_values_by_column(rows)
    assert out["status"] == ["active", "inactive"]
    assert len(out["status"]) <= MAX_SAMPLE_VALUES_PER_COLUMN


# ---------------------------------------------------------------------------
# classify_data_source_columns_llm
# ---------------------------------------------------------------------------


def _patch_fake_litellm(monkeypatch, generate_completion):
    import ee.modules.ai.services.litellm_service as litellm_mod

    class FakeLiteLLM:
        async def hydrate_user_byok_models(self, user_id, organization_id=None):
            pass

        async def generate_completion(self, **kwargs):
            return await generate_completion(**kwargs)

    monkeypatch.setattr(litellm_mod, "LiteLLMService", FakeLiteLLM)


@pytest.mark.asyncio
async def test_classify_success_persists_batched_result_to_cache(monkeypatch):
    """The core happy path: one LLM call classifies every column of the
    data source, and the result is persisted in ONE batched upsert call --
    not one LLM call per column."""

    async def fake_generate(**kwargs):
        assert kwargs.get("response_format") == {"type": "json_object"}
        return {
            "success": True,
            "content": json.dumps(
                {
                    "classifications": [
                        {
                            "table": "orders",
                            "column": "amount",
                            "classification": "metric",
                            "confidence": 0.9,
                            "reasoning": "sum of order value",
                        },
                        {
                            "table": "orders",
                            "column": "status",
                            "classification": "dimension",
                            "confidence": 0.8,
                            "reasoning": "categorical",
                        },
                    ]
                }
            ),
        }

    _patch_fake_litellm(monkeypatch, fake_generate)

    import ee.modules.ai.services.semantic_layer_db as sldb_mod

    persisted = {}

    async def fake_upsert(data_source_id, fingerprint, classifications):
        persisted["data_source_id"] = data_source_id
        persisted["fingerprint"] = fingerprint
        persisted["classifications"] = classifications
        return {"success": True, "count": len(classifications)}

    monkeypatch.setattr(sldb_mod.semantic_layer_db, "upsert_column_classifications", fake_upsert)

    schema = {
        "tables": [
            {
                "name": "orders",
                "columns": [{"name": "amount", "type": "NUMERIC"}, {"name": "status", "type": "VARCHAR"}],
            }
        ]
    }
    result = await classify_data_source_columns_llm(
        "ds-1", schema, sample_rows=[{"amount": "120.50", "status": "active"}]
    )

    assert result["success"] is True
    assert result["classified"] == 2
    assert persisted["data_source_id"] == "ds-1"
    assert persisted["fingerprint"] == compute_schema_fingerprint(schema)
    assert {c["column"] for c in persisted["classifications"]} == {"amount", "status"}
    amount_row = next(c for c in persisted["classifications"] if c["column"] == "amount")
    assert amount_row["classification"] == "metric"
    assert amount_row["source"] == "llm"


@pytest.mark.asyncio
async def test_classify_llm_call_failure_fails_open_without_touching_cache(monkeypatch):
    """An LLM error (timeout, provider outage, ...) must never raise into the
    caller and must never write a bogus/partial row to the cache -- the
    existing cached row (if any) or the heuristic fallback stays in effect."""

    async def fake_generate(**kwargs):
        return {"success": False, "error": "timeout"}

    _patch_fake_litellm(monkeypatch, fake_generate)

    import ee.modules.ai.services.semantic_layer_db as sldb_mod

    called = {"upsert": False}

    async def fake_upsert(*a, **k):
        called["upsert"] = True
        return {"success": True}

    monkeypatch.setattr(sldb_mod.semantic_layer_db, "upsert_column_classifications", fake_upsert)

    schema = {"tables": [{"name": "orders", "columns": [{"name": "amount", "type": "NUMERIC"}]}]}
    result = await classify_data_source_columns_llm("ds-1", schema)

    assert result["success"] is False
    assert called["upsert"] is False


@pytest.mark.asyncio
async def test_classify_malformed_json_response_fails_open(monkeypatch):
    """The LLM returning non-JSON prose (should never happen with
    response_format=json_object, but providers are not perfectly reliable)
    must fail open rather than crash the caller or poison the cache."""

    async def fake_generate(**kwargs):
        return {"success": True, "content": "Sure, here are the classifications: ..."}

    _patch_fake_litellm(monkeypatch, fake_generate)

    import ee.modules.ai.services.semantic_layer_db as sldb_mod

    called = {"upsert": False}

    async def fake_upsert(*a, **k):
        called["upsert"] = True
        return {"success": True}

    monkeypatch.setattr(sldb_mod.semantic_layer_db, "upsert_column_classifications", fake_upsert)

    schema = {"tables": [{"name": "orders", "columns": [{"name": "amount", "type": "NUMERIC"}]}]}
    result = await classify_data_source_columns_llm("ds-1", schema)

    assert result["success"] is False
    assert called["upsert"] is False


@pytest.mark.asyncio
async def test_classify_schema_validation_failure_fails_open(monkeypatch):
    """A well-formed JSON object that doesn't match ColumnClassificationBatch
    (e.g. an invalid classification label survives the field_validator's
    normalization, but a missing required `column` should not) must fail
    open rather than persist garbage."""

    async def fake_generate(**kwargs):
        return {
            "success": True,
            "content": json.dumps({"classifications": [{"table": "orders", "classification": "metric"}]}),
        }

    _patch_fake_litellm(monkeypatch, fake_generate)

    import ee.modules.ai.services.semantic_layer_db as sldb_mod

    called = {"upsert": False}

    async def fake_upsert(*a, **k):
        called["upsert"] = True
        return {"success": True}

    monkeypatch.setattr(sldb_mod.semantic_layer_db, "upsert_column_classifications", fake_upsert)

    schema = {"tables": [{"name": "orders", "columns": [{"name": "amount", "type": "NUMERIC"}]}]}
    result = await classify_data_source_columns_llm("ds-1", schema)

    assert result["success"] is False
    assert called["upsert"] is False


@pytest.mark.asyncio
async def test_classify_empty_schema_short_circuits_without_calling_llm(monkeypatch):
    """No columns to classify -- must not spend an LLM call finding that out."""
    calls = []

    async def fake_generate(**kwargs):
        calls.append(1)
        return {"success": True, "content": "{}"}

    _patch_fake_litellm(monkeypatch, fake_generate)

    result = await classify_data_source_columns_llm("ds-1", {"tables": []})
    assert result["success"] is False
    assert calls == []


# ---------------------------------------------------------------------------
# get_cached_column_classifications
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_get_cached_classifications_hit_keys_by_lowercased_column_name(monkeypatch):
    import ee.modules.ai.services.semantic_layer_db as sldb_mod

    async def fake_get(data_source_id, schema_fingerprint):
        assert data_source_id == "ds-1"
        return [
            {
                "table_name": "orders",
                "column_name": "Amount",
                "classification": "metric",
                "confidence": 0.9,
                "reasoning": "r",
            }
        ]

    monkeypatch.setattr(sldb_mod.semantic_layer_db, "get_column_classifications", fake_get)

    schema = {"tables": [{"name": "orders", "columns": [{"name": "amount", "type": "NUMERIC"}]}]}
    out = await get_cached_column_classifications("ds-1", schema)
    assert out is not None
    assert out["amount"]["classification"] == "metric"


@pytest.mark.asyncio
async def test_get_cached_classifications_miss_returns_none(monkeypatch):
    import ee.modules.ai.services.semantic_layer_db as sldb_mod

    async def fake_get(*a, **k):
        return []

    monkeypatch.setattr(sldb_mod.semantic_layer_db, "get_column_classifications", fake_get)

    schema = {"tables": [{"name": "orders", "columns": [{"name": "amount", "type": "NUMERIC"}]}]}
    out = await get_cached_column_classifications("ds-1", schema)
    assert out is None


@pytest.mark.asyncio
async def test_get_cached_classifications_missing_inputs_returns_none_without_a_db_call(monkeypatch):
    import ee.modules.ai.services.semantic_layer_db as sldb_mod

    called = {"get": False}

    async def fake_get(*a, **k):
        called["get"] = True
        return []

    monkeypatch.setattr(sldb_mod.semantic_layer_db, "get_column_classifications", fake_get)

    assert await get_cached_column_classifications("", {"tables": []}) is None
    assert await get_cached_column_classifications("ds-1", None) is None
    assert called["get"] is False


# ---------------------------------------------------------------------------
# ensure_column_classifications_fresh (the lazy entrypoint analytics_node uses)
# ---------------------------------------------------------------------------


@pytest.mark.asyncio
async def test_ensure_fresh_returns_cache_hit_without_enqueueing(monkeypatch):
    import ee.modules.ai.services.column_semantic_classifier as ccmod

    async def fake_cached(data_source_id, schema):
        return {"amount": {"classification": "metric", "confidence": 0.9, "reasoning": "r"}}

    monkeypatch.setattr(ccmod, "get_cached_column_classifications", fake_cached)

    enqueue_calls = []

    async def fake_enqueue(name, **kwargs):
        enqueue_calls.append((name, kwargs))
        return "job-1"

    monkeypatch.setattr("src.shared.jobs.client.enqueue_job", fake_enqueue)

    schema = {"tables": [{"name": "orders", "columns": [{"name": "amount", "type": "NUMERIC"}]}]}
    result = await ccmod.ensure_column_classifications_fresh("ds-1", schema)

    assert result is not None
    assert result["amount"]["classification"] == "metric"
    assert enqueue_calls == []


@pytest.mark.asyncio
async def test_ensure_fresh_enqueues_background_job_on_cache_miss_and_returns_none(monkeypatch):
    """On a miss, the CURRENT request must proceed on the heuristic (return
    None here means data_profiler.py gets no LLM signal for this call) while
    the classification job is enqueued in the background for next time --
    never blocks on the LLM call inline."""
    import ee.modules.ai.services.column_semantic_classifier as ccmod

    async def fake_cached(data_source_id, schema):
        return None

    monkeypatch.setattr(ccmod, "get_cached_column_classifications", fake_cached)

    enqueue_calls = []

    async def fake_enqueue(name, **kwargs):
        enqueue_calls.append((name, kwargs))
        return "job-1"

    monkeypatch.setattr("src.shared.jobs.client.enqueue_job", fake_enqueue)

    schema = {"tables": [{"name": "orders", "columns": [{"name": "amount", "type": "NUMERIC"}]}]}
    result = await ccmod.ensure_column_classifications_fresh("ds-2", schema)

    assert result is None
    assert enqueue_calls == [("classify_data_source_columns", {"data_source_id": "ds-2"})]


@pytest.mark.asyncio
async def test_ensure_fresh_fails_open_when_enqueue_raises(monkeypatch):
    """Redis/ARQ being unavailable must not surface into the analytics
    path -- this is belt-and-suspenders on top of enqueue_job's own
    fail-open behavior (it already returns None rather than raising on a
    connection error; this covers any other exception getting through)."""
    import ee.modules.ai.services.column_semantic_classifier as ccmod

    async def fake_cached(data_source_id, schema):
        return None

    monkeypatch.setattr(ccmod, "get_cached_column_classifications", fake_cached)

    async def raising_enqueue(name, **kwargs):
        raise RuntimeError("redis down")

    monkeypatch.setattr("src.shared.jobs.client.enqueue_job", raising_enqueue)

    schema = {"tables": [{"name": "orders", "columns": [{"name": "amount", "type": "NUMERIC"}]}]}
    result = await ccmod.ensure_column_classifications_fresh("ds-3", schema)

    assert result is None


@pytest.mark.asyncio
async def test_ensure_fresh_returns_none_immediately_without_data_source_id():
    result = await ensure_column_classifications_fresh(None, {"tables": []})
    assert result is None


@pytest.mark.asyncio
async def test_ensure_fresh_returns_none_immediately_without_schema():
    result = await ensure_column_classifications_fresh("ds-1", None)
    assert result is None
