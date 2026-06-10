"""Tests for tenant-scoped AI cache keys."""

from src.modules.ai.utils.tenant_cache import (
    build_query_cache_digest,
    normalize_org_id,
    tenant_lg_result_key,
    tenant_schema_cache_key,
)


def test_normalize_org_id_prefers_organization():
    assert normalize_org_id("org-abc", "user-1") == "org-abc"


def test_normalize_org_id_falls_back_to_user():
    assert normalize_org_id(None, "user-1") == "user-user-1"


def test_tenant_cache_keys_include_org():
    schema_key = tenant_schema_cache_key("ds-1", organization_id="org-a")
    assert schema_key == "schema:org-a:ds-1"

    digest = build_query_cache_digest("show sales", "ds-1", "standard", "descriptive")
    assert digest
    lg_key = tenant_lg_result_key(digest, organization_id="org-a")
    assert lg_key.startswith("lg_result:org-a:")


def test_cache_isolation_different_orgs():
    digest = build_query_cache_digest("revenue trend", "ds-99", "standard", "descriptive")
    key_a = tenant_lg_result_key(digest, organization_id="org-a")
    key_b = tenant_lg_result_key(digest, organization_id="org-b")
    assert key_a != key_b
