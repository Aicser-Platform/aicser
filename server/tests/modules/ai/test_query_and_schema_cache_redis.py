"""Tests for schema_cache_service on the shared Redis cache.

Used to be an in-process dict - correct within one process, silently stale
or missing across replicas. It now goes through src.core.cache.cache (the same
singleton org_budget_service/llm_quota_service use), which itself falls back to
an in-process store only when Redis is truly unreachable - so these tests exercise
real Redis in this dev environment and still pass portably wherever it isn't.

query_cache_service.py (the sibling this file used to also test) was removed:
its SQL-normalization cache key replaced every quoted literal with a fixed
placeholder before hashing, so `WHERE region='US'` and `WHERE region='EU'`
hashed identically and one query's cached result rows could be served for the
other - a real data leak, not just a stale-shape bug. It was reachable only
through OptimizationIntegration, which nothing in the live pipeline ever
instantiated; removed together rather than fixed, since nl2sql_cache_service.py
already is the correctly-scoped, live query-result cache for this pipeline.
"""

from src.core.cache import cache
from ee.modules.ai.services.schema_cache_service import get_schema_cache_service


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


def test_cache_is_visible_through_the_shared_singleton_directly():
    """The whole point of the migration: another process reading the same
    Redis-backed `cache` singleton sees what this one wrote - unlike the old
    per-process dict, which a second replica could never see at all."""
    svc = get_schema_cache_service()
    ds_id = "test-ds-cross-process"
    svc.set_schema(ds_id, {"tables": ["x"]})

    cache_key = svc._get_cache_key(ds_id)
    assert cache.get(cache_key) is not None

    svc.invalidate(ds_id)
