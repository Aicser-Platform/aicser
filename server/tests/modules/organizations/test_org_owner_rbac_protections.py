"""Tests for Org Owner vs Org Admin RBAC boundaries and single-owner protections."""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from ee.modules.organizations.router import remove_member, update_member_role
from ee.modules.organizations.schemas import MemberRoleUpdate
from src.modules.authentication.rbac.rbac_service import RBACService


@pytest.mark.asyncio
async def test_org_admin_cannot_remove_org_owner():
    org_id = str(uuid4())
    owner_id = str(uuid4())
    admin_id = str(uuid4())

    async def mock_has_role(user_id, role_name, scope, organization_id=None, project_id=None):
        if str(user_id) == owner_id and role_name == "org_owner":
            return True
        return False

    with patch.object(RBACService, "has_role", side_effect=mock_has_role), \
         patch.object(RBACService, "check_permission", new=AsyncMock(return_value=True)):
        with pytest.raises(HTTPException) as exc_info:
            await remove_member(
                organization_id=org_id,
                member_id=owner_id,
                current_user_id=admin_id,
            )
        assert exc_info.value.status_code == 403
        assert "cannot remove an organization owner" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_org_admin_cannot_demote_org_owner():
    org_id = str(uuid4())
    owner_id = str(uuid4())
    admin_id = str(uuid4())

    async def mock_has_role(user_id, role_name, scope, organization_id=None, project_id=None):
        if str(user_id) == owner_id and role_name == "org_owner":
            return True
        return False

    target_role = MagicMock(id=uuid4(), name="org_member")

    with patch.object(RBACService, "has_role", side_effect=mock_has_role), \
         patch.object(RBACService, "check_permission", new=AsyncMock(return_value=True)), \
         patch.object(RBACService, "get_role_by_id", new=AsyncMock(return_value=target_role)):
        with pytest.raises(HTTPException) as exc_info:
            await update_member_role(
                organization_id=org_id,
                member_id=owner_id,
                payload=MemberRoleUpdate(role_id=target_role.id),
                current_user_id=admin_id,
            )
        assert exc_info.value.status_code == 403
        assert "cannot change the role of an organization owner" in exc_info.value.detail.lower()


@pytest.mark.asyncio
async def test_org_owner_transfer_demotes_previous_owner():
    org_id = str(uuid4())
    current_owner_id = str(uuid4())
    new_owner_id = str(uuid4())

    async def mock_has_role(user_id, role_name, scope, organization_id=None, project_id=None):
        if str(user_id) == current_owner_id and role_name == "org_owner":
            return True
        return False

    owner_role = MagicMock(id=uuid4())
    owner_role.name = "org_owner"
    mock_update = AsyncMock()
    mock_demote = AsyncMock(return_value=1)

    with patch.object(RBACService, "has_role", side_effect=mock_has_role), \
         patch.object(RBACService, "check_permission", new=AsyncMock(return_value=True)), \
         patch.object(RBACService, "is_last_active_org_owner", new=AsyncMock(return_value=False)), \
         patch.object(RBACService, "get_role_by_id", new=AsyncMock(return_value=owner_role)), \
         patch.object(RBACService, "get_role_permissions", new=AsyncMock(return_value={"*"})), \
         patch.object(RBACService, "get_effective_user_permissions", new=AsyncMock(return_value={"*"})), \
         patch.object(RBACService, "demote_other_owners", mock_demote), \
         patch("ee.modules.organizations.router.OrganizationService.update_member_role", mock_update):

        res = await update_member_role(
            organization_id=org_id,
            member_id=new_owner_id,
            payload=MemberRoleUpdate(role_id=owner_role.id),
            current_user_id=current_owner_id,
        )
        assert res["status"] == "success"
        mock_update.assert_awaited_once()
        assert mock_update.await_args.kwargs["user_id"] == new_owner_id
        mock_demote.assert_awaited_once()
        assert mock_demote.await_args.kwargs["keep_user_id"] == new_owner_id
        assert mock_demote.await_args.kwargs["demote_to_role_name"] == "org_admin"
