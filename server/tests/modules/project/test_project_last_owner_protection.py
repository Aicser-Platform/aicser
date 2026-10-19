"""Regression tests for the missing "last owner" protection on project
membership: RBACService.is_last_active_project_owner and its two call
sites in ProjectService (update_project_member_role, remove_project_member).

Before this fix, a project_editor (who legitimately holds project:edit)
could demote or remove the project's only project_owner via
PATCH/DELETE /projects/{id}/members/{user_id}, leaving the project
ownerless with no one able to manage membership/settings short of an org
admin. Mirrors the existing org-level protection
(RBACService.is_last_active_org_owner).
"""

from unittest.mock import AsyncMock, MagicMock, patch
from uuid import uuid4

import pytest
from fastapi import HTTPException

from ee.modules.project.service import ProjectService
from src.modules.authentication.rbac.rbac_service import RBACService


@pytest.mark.asyncio
async def test_is_last_active_project_owner_true_for_sole_owner():
    owner_id = uuid4()
    project_id = uuid4()
    fake_role = MagicMock(id=uuid4())

    session = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = [owner_id]
    session.execute = AsyncMock(return_value=result)
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)

    with patch.object(RBACService, "get_role_by_name", new=AsyncMock(return_value=fake_role)), patch(
        "src.modules.authentication.rbac.rbac_service.async_session", return_value=cm
    ):
        is_last = await RBACService.is_last_active_project_owner(str(owner_id), str(project_id))

    assert is_last is True


@pytest.mark.asyncio
async def test_is_last_active_project_owner_false_with_co_owner():
    owner_id = uuid4()
    other_owner_id = uuid4()
    project_id = uuid4()
    fake_role = MagicMock(id=uuid4())

    session = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.all.return_value = [owner_id, other_owner_id]
    session.execute = AsyncMock(return_value=result)
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)

    with patch.object(RBACService, "get_role_by_name", new=AsyncMock(return_value=fake_role)), patch(
        "src.modules.authentication.rbac.rbac_service.async_session", return_value=cm
    ):
        is_last = await RBACService.is_last_active_project_owner(str(owner_id), str(project_id))

    assert is_last is False


@pytest.mark.asyncio
async def test_remove_project_member_blocks_removing_last_owner():
    project_id, owner_id = uuid4(), uuid4()
    membership_row = MagicMock()

    session = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.first.return_value = membership_row
    session.execute = AsyncMock(return_value=result)
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)

    with patch("ee.modules.project.service.async_session", return_value=cm), patch.object(
        RBACService, "is_last_active_project_owner", new=AsyncMock(return_value=True)
    ):
        with pytest.raises(HTTPException) as exc:
            await ProjectService.remove_project_member(str(project_id), str(owner_id))

    assert exc.value.status_code == 400
    assert "last owner" in exc.value.detail.lower()
    session.commit.assert_not_awaited()


@pytest.mark.asyncio
async def test_remove_project_member_allows_removing_non_owner():
    project_id, member_id = uuid4(), uuid4()
    membership_row = MagicMock()

    session = AsyncMock()
    result = MagicMock()
    result.scalars.return_value.first.return_value = membership_row
    session.execute = AsyncMock(return_value=result)
    session.commit = AsyncMock()
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)

    with patch("ee.modules.project.service.async_session", return_value=cm), patch.object(
        RBACService, "is_last_active_project_owner", new=AsyncMock(return_value=False)
    ):
        removed = await ProjectService.remove_project_member(str(project_id), str(member_id))

    assert removed is True
    session.commit.assert_awaited()


@pytest.mark.asyncio
async def test_non_owner_cannot_remove_project_owner():
    from ee.modules.project.router import remove_project_member

    project_id = str(uuid4())
    owner_id = str(uuid4())
    editor_id = str(uuid4())
    project = MagicMock(organization_id=uuid4())

    async def mock_has_role(uid, role_name, scope, organization_id=None, project_id=None):
        if str(uid) == owner_id and role_name == "project_owner":
            return True
        return False

    with patch("ee.modules.project.router.ProjectService.get_project", new=AsyncMock(return_value=project)), \
         patch.object(RBACService, "check_permission", new=AsyncMock(return_value=True)), \
         patch.object(RBACService, "has_role", side_effect=mock_has_role):
        with pytest.raises(HTTPException) as exc:
            await remove_project_member(
                project_id=project_id,
                target_user_id=owner_id,
                user_id=editor_id,
            )
        assert exc.value.status_code == 403
        assert "can remove a project owner" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_non_owner_cannot_assign_project_owner_role():
    from ee.modules.project.router import update_project_member_role
    from ee.modules.project.schemas import ProjectMemberUpdateRequest

    project_id = str(uuid4())
    target_id = str(uuid4())
    editor_id = str(uuid4())
    project = MagicMock(organization_id=uuid4())
    owner_role = MagicMock(id=uuid4())
    owner_role.name = "project_owner"

    with patch("ee.modules.project.router.ProjectService.get_project", new=AsyncMock(return_value=project)), \
         patch.object(RBACService, "check_permission", new=AsyncMock(return_value=True)), \
         patch.object(RBACService, "has_role", new=AsyncMock(return_value=False)), \
         patch.object(RBACService, "get_role_by_id", new=AsyncMock(return_value=owner_role)):
        with pytest.raises(HTTPException) as exc:
            await update_project_member_role(
                project_id=project_id,
                target_user_id=target_id,
                body=ProjectMemberUpdateRequest(role_id=str(owner_role.id)),
                user_id=editor_id,
            )
        assert exc.value.status_code == 403
        assert "can assign the project owner role" in exc.value.detail.lower()


@pytest.mark.asyncio
async def test_invite_rejects_second_project_owner():
    from ee.modules.project.service import ProjectService

    project_id = uuid4()
    org_id = uuid4()
    invitee_id = uuid4()
    inviter_id = uuid4()
    owner_role_id = uuid4()

    project = MagicMock()
    project.organization_id = org_id
    project.name = "P"
    owner_role = MagicMock()
    owner_role.name = "project_owner"
    owner_role.scope = "project"

    session = AsyncMock()
    proj_result = MagicMock()
    proj_result.scalars.return_value.first.return_value = project
    role_result = MagicMock()
    role_result.scalars.return_value.first.return_value = owner_role
    session.execute = AsyncMock(side_effect=[proj_result, role_result])
    cm = AsyncMock()
    cm.__aenter__ = AsyncMock(return_value=session)
    cm.__aexit__ = AsyncMock(return_value=False)

    with patch("ee.modules.project.service.async_session", return_value=cm):
        with pytest.raises(HTTPException) as exc:
            await ProjectService.invite_user_to_project(
                project_id=str(project_id),
                organization_id=str(org_id),
                invitee_user_id=str(invitee_id),
                invitee_email=None,
                role_id=str(owner_role_id),
                inviter_user_id=str(inviter_id),
            )
    assert exc.value.status_code == 400
    assert "only one owner" in exc.value.detail.lower()

