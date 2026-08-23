"""Tests for query_cache_service / schema_cache_service on the shared Redis cache.

Both used to be in-process dicts - correct within one process, silently stale
or missing across replicas. They now go through src.core.cache.cache (the same
singleton org_budget_service/llm_quota_service use), which itself falls back to
an in-process store only when Redis is truly unreachable - so these tests exercise
real Redis in this dev environment and still pass portably wherever it isn't.
"""

from src.core.cache import cache
from src.modules.ai.services.query_cache_service import get_query_cache_service
from src.modules.ai.services.schema_cache_service import get_schema_cache_service


def test_query_cache_round_trip_and_invalidate():
    svc = get_query_cache_service()
    ds_id = "test-ds-query-cache"
    sql = "SELECT * FROM widgets"

    assert svc.get_result(ds_id, sql) is None  # clean slate

    svc.set_result(ds_id, sql, {"rows": [1, 2, 3]})
    assert svc.get_result(ds_id, sql) == {"rows": [1, 2, 3]}

    # A differently-worded query with the same normalized SQL still hits.
    assert svc.get_result(ds_id, "select   *   from   widgets") == {"rows": [1, 2, 3]}

    svc.invalidate(ds_id)
    assert svc.get_result(ds_id, sql) is None


def test_query_cache_skips_oversized_results():
    svc = get_query_cache_service()
    ds_id = "test-ds-oversized"
    sql = "SELECT * FROM huge_table"
    huge_result = {"rows": ["x" * 1000] * 20000}  # well over the 10MB guard

    svc.set_result(ds_id, sql, huge_result)
    assert svc.get_result(ds_id, sql) is None


def test_schema_cache_round_trip_and_invalidate():
    svc = get_schema_cache_service()
    ds_id = "test-ds-schema-cache"

    assert svc.get_schema(ds_id) is None

    svc.set_schema(ds_id, {"tables": ["a", "b"]})
    assert svc.get_schema(ds_id) == {"tables": ["a", "b"]}

    svc.invalidate(ds_id)
    assert svc.get_schema(ds_id) is None


def test_schema_cache_is_tenant_scoped():
    svc = get_schema_cache_service()
    ds_id = "test-ds-tenant-scoped"

    svc.set_schema(ds_id, {"tables": ["org_a_table"]}, organization_id="org-a")
    svc.set_schema(ds_id, {"tables": ["org_b_table"]}, organization_id="org-b")

    assert svc.get_schema(ds_id, organization_id="org-a") == {"tables": ["org_a_table"]}
    assert svc.get_schema(ds_id, organization_id="org-b") == {"tables": ["org_b_table"]}

    svc.invalidate(ds_id, organization_id="org-a")
    svc.invalidate(ds_id, organization_id="org-b")


def test_caches_are_visible_through_the_shared_singleton_directly():
    """The whole point of the migration: another process reading the same
    Redis-backed `cache` singleton sees what this one wrote - unlike the old
    per-process dicts, which a second replica could never see at all."""
    svc = get_query_cache_service()
    ds_id = "test-ds-cross-process"
    sql = "SELECT 1"
    svc.set_result(ds_id, sql, {"rows": [1]})

    cache_key = svc._get_cache_key(ds_id, sql)
    assert cache.get(cache_key) is not None

    svc.invalidate(ds_id)
