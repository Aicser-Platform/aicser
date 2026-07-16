"""Tests for self-host bootstrap role resolution and workspace provisioning."""

from __future__ import annotations

from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

pytest.importorskip("ee.modules.organizations.user_workspace")


def test_resolve_self_host_org_role_first_user_is_owner():
    from src.modules.organizations.deployment_org import resolve_self_host_org_role

    role = resolve_self_host_org_role(
        email="founder@example.com",
        realm_roles=[],
        org_has_owner=False,
        org_member_count=0,
    )
    assert role == "org_owner"


def test_resolve_self_host_org_role_admin_email_is_owner():
    with patch.dict("os.environ", {"AISER_ADMIN_EMAIL": "admin@company.com"}):
        from importlib import reload
        import src.modules.organizations.deployment_org as mod

        reload(mod)
        role = mod.resolve_self_host_org_role(
            email="admin@company.com",
            realm_roles=[],
            org_has_owner=True,
            org_member_count=5,
        )
        assert role == "org_owner"


def test_resolve_self_host_org_role_subsequent_user_is_member():
    from src.modules.organizations.deployment_org import resolve_self_host_org_role

    role = resolve_self_host_org_role(
        email="user@example.com",
        realm_roles=[],
        org_has_owner=True,
        org_member_count=2,
    )
    assert role == "org_member"


@pytest.mark.asyncio
async def test_ensure_user_workspace_self_host_passes_email():
    from src.modules.organizations.user_workspace import ensure_user_workspace

    uid = str(uuid4())
    with patch(
        "src.modules.organizations.user_workspace.is_self_host_deployment",
        return_value=True,
    ):
        with patch(
            "src.modules.organizations.user_workspace.ensure_self_host_user_membership",
            new_callable=AsyncMock,
        ) as self_host:
            await ensure_user_workspace(uid, "founder@example.com")
            self_host.assert_awaited_once_with(uid, [], email="founder@example.com")


@pytest.mark.asyncio
async def test_ensure_user_workspace_self_host_joins_deployment_org():
    from src.modules.organizations.user_workspace import ensure_user_workspace

    uid = str(uuid4())
    with patch(
        "src.modules.organizations.user_workspace.is_self_host_deployment",
        return_value=True,
    ):
        with patch(
            "src.modules.organizations.user_workspace.ensure_self_host_user_membership",
            new_callable=AsyncMock,
        ) as self_host:
            await ensure_user_workspace(uid, "user@example.com", realm_roles=["viewer"])
            self_host.assert_awaited_once_with(uid, ["viewer"], email="user@example.com")


@pytest.mark.asyncio
async def test_ensure_user_workspace_saas_defers_org_creation_to_onboarding():
    from src.modules.organizations.user_workspace import ensure_user_workspace

    uid = str(uuid4())
    with patch(
        "src.modules.organizations.user_workspace.is_self_host_deployment",
        return_value=False,
    ), patch(
        "src.modules.organizations.user_workspace._user_has_org_membership",
        new_callable=AsyncMock,
        return_value=False,
    ) as has_membership, patch(
        "src.modules.organizations.user_workspace.ensure_self_host_user_membership",
        new_callable=AsyncMock,
    ) as self_host:
        await ensure_user_workspace(uid, "new-user@example.com")

    has_membership.assert_awaited_once_with(uid)
    self_host.assert_not_awaited()
