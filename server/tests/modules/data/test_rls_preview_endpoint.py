import os
from types import SimpleNamespace

import pytest

os.environ["DEBUG"] = "false"

pytest.importorskip("ee.modules.data.services", reason="EE submodule not present")

import src.db.registry  # noqa: F401
from ee.modules.data.services import data_source_rls_preview_service as preview_mod


def _rule(**kwargs):
    base = {
        "table_name": "dim_customer",
        "column_name": "customer_name",
        "operator": "eq",
        "value_type": "fixed",
        "value": "ACME",
        "sort_order": 0,
    }
    base.update(kwargs)
    return SimpleNamespace(**base)


async def _attrs(*_args, **_kwargs):
    return {"region": "APAC", "user_id": "user-1"}


@pytest.mark.asyncio
async def test_preview_policy_uses_source_dialect(monkeypatch):
    monkeypatch.setattr(
        preview_mod.DataSourceRLSEnforcementService,
        "_load_user_attributes",
        staticmethod(_attrs),
    )
    file_source = SimpleNamespace(type="file", db_type=None)

    result, dialect = await preview_mod.preview_policy(
        [_rule()],
        default_deny=True,
        data_source=file_source,
        requesting_user_id="user-1",
        simulate_user_id=None,
        organization_id="org-1",
        project_id=None,
        token_payload={},
        session=None,
    )

    assert dialect == "duckdb"
    assert result.predicate == "(customer_name = 'ACME')"


@pytest.mark.asyncio
async def test_preview_masks_when_simulating_another_user(monkeypatch):
    monkeypatch.setattr(
        preview_mod.DataSourceRLSEnforcementService,
        "_load_user_attributes",
        staticmethod(_attrs),
    )
    source = SimpleNamespace(type="database", db_type="postgresql")
    rule = _rule(value_type="user_attribute", value="region")

    result, _ = await preview_mod.preview_policy(
        [rule],
        default_deny=True,
        data_source=source,
        requesting_user_id="user-1",
        simulate_user_id="user-2",
        organization_id="org-1",
        project_id=None,
        token_payload={},
        session=None,
    )

    assert "APAC" not in (result.predicate or "")
    assert "‹user.region›" in result.predicate


@pytest.mark.asyncio
async def test_preview_does_not_mask_for_self(monkeypatch):
    monkeypatch.setattr(
        preview_mod.DataSourceRLSEnforcementService,
        "_load_user_attributes",
        staticmethod(_attrs),
    )
    source = SimpleNamespace(type="database", db_type="postgresql")
    rule = _rule(value_type="user_attribute", value="region")

    result, _ = await preview_mod.preview_policy(
        [rule],
        default_deny=True,
        data_source=source,
        requesting_user_id="user-1",
        simulate_user_id="user-1",
        organization_id="org-1",
        project_id=None,
        token_payload={},
        session=None,
    )

    assert result.predicate == "(customer_name = 'APAC')"
