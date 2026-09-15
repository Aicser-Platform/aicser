"""Regression tests for the NL2SQL generation cache — the tenant-isolation
guarantees matter most here (see nl2sql_cache_service.py's module docstring
for the cross-account cache leak this design is deliberately built against).
"""

import time

import pytest


class _FakeCache:
    """Minimal in-memory stand-in for src.core.cache's RedisCache singleton,
    supporting just .get/.set/.clear_pattern with real TTL expiry."""

    def __init__(self):
        self.store: dict = {}

    def get(self, key, default=None):
        item = self.store.get(key)
        if item is None:
            return default
        value, expires_at = item
        if expires_at is not None and time.time() >= expires_at:
            del self.store[key]
            return default
        return value

    def set(self, key, value, ttl=None):
        expires_at = (time.time() + ttl) if ttl else None
        self.store[key] = (value, expires_at)
        return True

    def clear_pattern(self, pattern):
        import fnmatch
        matched = [k for k in self.store if fnmatch.fnmatch(k, pattern)]
        for k in matched:
            del self.store[k]
        return len(matched)


_SCHEMA = {"tables": [{"name": "orders", "columns": [{"name": "id"}, {"name": "revenue"}]}]}
_SUCCESS_RESULT = {
    "success": True,
    "sql_query": 'SELECT SUM("revenue") FROM "orders"',
    "sql_contract": "json_object",
    "explanation": "Total revenue",
    "tables_used": ["orders"],
    "chart_suggestion": None,
    "column_roles": None,
    "confidence": 0.9,
    "elapsed_ms": 1234,
    "truncated": False,
    "nl2sql_schema_partial": False,
}


@pytest.fixture(autouse=True)
def fake_cache(monkeypatch):
    fake = _FakeCache()
    monkeypatch.setattr("src.core.cache.cache", fake)
    return fake


def _set_and_get(**overrides):
    from ee.modules.ai.services.nl2sql_cache_service import get_cached_sql, set_cached_sql

    base = dict(
        organization_id="org-1",
        data_source_id="ds-1",
        project_id="proj-1",
        schema=_SCHEMA,
        query="total revenue this month",
        analytics_type="descriptive",
    )
    base.update(overrides)
    set_cached_sql(result=_SUCCESS_RESULT, **base)
    return get_cached_sql(**base)


def test_cache_hit_on_identical_request_returns_the_sql():
    result = _set_and_get()
    assert result is not None
    assert result["sql_query"] == _SUCCESS_RESULT["sql_query"]
    assert result["success"] is True
    assert result["nl2sql_cache_hit"] is True


def test_cache_miss_for_a_different_organization():
    """The core tenant-isolation guarantee: org A's cached SQL must never
    answer org B's identical-looking question, even against a data source id
    that (in a real deployment) could never legitimately belong to both."""
    from ee.modules.ai.services.nl2sql_cache_service import get_cached_sql, set_cached_sql

    set_cached_sql(
        organization_id="org-1",
        data_source_id="ds-1",
        project_id="proj-1",
        schema=_SCHEMA,
        query="total revenue this month",
        analytics_type="descriptive",
        result=_SUCCESS_RESULT,
    )
    hit_for_other_org = get_cached_sql(
        organization_id="org-2",
        data_source_id="ds-1",
        project_id="proj-1",
        schema=_SCHEMA,
        query="total revenue this month",
        analytics_type="descriptive",
    )
    assert hit_for_other_org is None


def test_cache_miss_for_a_different_data_source():
    result = None
    from ee.modules.ai.services.nl2sql_cache_service import get_cached_sql, set_cached_sql

    set_cached_sql(
        organization_id="org-1",
        data_source_id="ds-1",
        project_id="proj-1",
        schema=_SCHEMA,
        query="total revenue this month",
        analytics_type="descriptive",
        result=_SUCCESS_RESULT,
    )
    result = get_cached_sql(
        organization_id="org-1",
        data_source_id="ds-2",
        project_id="proj-1",
        schema=_SCHEMA,
        query="total revenue this month",
        analytics_type="descriptive",
    )
    assert result is None


def test_cache_miss_when_schema_shape_differs():
    """A schema change (new column, narrowed table subset from RAG filtering,
    etc.) must not serve an answer grounded in the old shape."""
    changed_schema = {"tables": [{"name": "orders", "columns": [{"name": "id"}]}]}
    from ee.modules.ai.services.nl2sql_cache_service import get_cached_sql, set_cached_sql

    set_cached_sql(
        organization_id="org-1",
        data_source_id="ds-1",
        project_id="proj-1",
        schema=_SCHEMA,
        query="total revenue this month",
        analytics_type="descriptive",
        result=_SUCCESS_RESULT,
    )
    result = get_cached_sql(
        organization_id="org-1",
        data_source_id="ds-1",
        project_id="proj-1",
        schema=changed_schema,
        query="total revenue this month",
        analytics_type="descriptive",
    )
    assert result is None


def test_cache_miss_for_a_different_question():
    result = _set_and_get()
    assert result is not None
    from ee.modules.ai.services.nl2sql_cache_service import get_cached_sql

    miss = get_cached_sql(
        organization_id="org-1",
        data_source_id="ds-1",
        project_id="proj-1",
        schema=_SCHEMA,
        query="total revenue last year",
        analytics_type="descriptive",
    )
    assert miss is None


def test_question_normalization_still_hits_on_whitespace_and_case_variation():
    from ee.modules.ai.services.nl2sql_cache_service import get_cached_sql, set_cached_sql

    set_cached_sql(
        organization_id="org-1",
        data_source_id="ds-1",
        project_id="proj-1",
        schema=_SCHEMA,
        query="  Total   Revenue This Month  ",
        analytics_type="descriptive",
        result=_SUCCESS_RESULT,
    )
    hit = get_cached_sql(
        organization_id="org-1",
        data_source_id="ds-1",
        project_id="proj-1",
        schema=_SCHEMA,
        query="total revenue this month",
        analytics_type="descriptive",
    )
    assert hit is not None


def test_never_caches_a_failed_generation():
    from ee.modules.ai.services.nl2sql_cache_service import get_cached_sql, set_cached_sql

    set_cached_sql(
        organization_id="org-1",
        data_source_id="ds-1",
        project_id="proj-1",
        schema=_SCHEMA,
        query="total revenue this month",
        analytics_type="descriptive",
        result={"success": False, "error": "Hallucination detected"},
    )
    result = get_cached_sql(
        organization_id="org-1",
        data_source_id="ds-1",
        project_id="proj-1",
        schema=_SCHEMA,
        query="total revenue this month",
        analytics_type="descriptive",
    )
    assert result is None


def test_refuses_to_cache_or_read_without_an_organization_id():
    """organization_id is the primary tenant boundary -- never fall back to
    an org-less/global cache entry even if a caller forgets to pass it."""
    from ee.modules.ai.services.nl2sql_cache_service import get_cached_sql, set_cached_sql

    set_cached_sql(
        organization_id=None,
        data_source_id="ds-1",
        project_id="proj-1",
        schema=_SCHEMA,
        query="total revenue this month",
        analytics_type="descriptive",
        result=_SUCCESS_RESULT,
    )
    result = get_cached_sql(
        organization_id=None,
        data_source_id="ds-1",
        project_id="proj-1",
        schema=_SCHEMA,
        query="total revenue this month",
        analytics_type="descriptive",
    )
    assert result is None


def test_invalidate_data_source_clears_only_that_data_source(fake_cache):
    from ee.modules.ai.services.nl2sql_cache_service import (
        get_cached_sql,
        invalidate_data_source,
        set_cached_sql,
    )

    for ds in ("ds-1", "ds-2"):
        set_cached_sql(
            organization_id="org-1",
            data_source_id=ds,
            project_id="proj-1",
            schema=_SCHEMA,
            query="total revenue this month",
            analytics_type="descriptive",
            result=_SUCCESS_RESULT,
        )

    invalidate_data_source("org-1", "ds-1")

    assert (
        get_cached_sql(
            organization_id="org-1",
            data_source_id="ds-1",
            project_id="proj-1",
            schema=_SCHEMA,
            query="total revenue this month",
            analytics_type="descriptive",
        )
        is None
    )
    assert (
        get_cached_sql(
            organization_id="org-1",
            data_source_id="ds-2",
            project_id="proj-1",
            schema=_SCHEMA,
            query="total revenue this month",
            analytics_type="descriptive",
        )
        is not None
    )
