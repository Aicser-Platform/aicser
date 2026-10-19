"""Filling in the caller's organization when the sign-in token doesn't carry one."""

import asyncio

from src.modules.data.services import governed_sql
from src.modules.data.services.governed_sql import Caller, resolve_organization

ORG = "11111111-1111-1111-1111-111111111111"
OTHER = "22222222-2222-2222-2222-222222222222"


def _caller(org=None):
    return Caller(user_id="u1", organization_id=org, project_id=None, payload={})


def test_enterprise_uses_the_requested_organization_only_for_members(monkeypatch):
    import src.core.edition as edition
    import src.modules.pricing.feature_gate as gate

    async def membership(user_id, db, requested=None):
        # Members of ORG get it; any other request falls back to their first organization.
        return ORG

    monkeypatch.setattr(edition, "is_ee_enabled", lambda: True)
    monkeypatch.setattr(gate, "get_user_organization_id", membership)
    assert asyncio.run(resolve_organization(_caller(), None, ORG)).organization_id == ORG
    assert asyncio.run(resolve_organization(_caller(), None, None)).organization_id == ORG
    assert asyncio.run(resolve_organization(_caller(), None, OTHER)).organization_id is None


def test_token_organization_wins_and_community_is_unchanged(monkeypatch):
    import src.core.edition as edition

    assert asyncio.run(resolve_organization(_caller(OTHER), None, ORG)).organization_id == OTHER
    monkeypatch.setattr(edition, "is_ee_enabled", lambda: False)
    assert asyncio.run(resolve_organization(_caller(), None, ORG)).organization_id is None
