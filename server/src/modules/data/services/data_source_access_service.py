"""Access checks for organization-owned data sources."""

from __future__ import annotations

from datetime import datetime, timezone
from typing import Optional, Sequence
from uuid import UUID, uuid4

from sqlalchemy import and_, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.edition import is_ee_enabled
from src.db.session import async_session
from src.modules.data.models import DataSource, DataSourceAccessGrant


DATA_SOURCE_PERMISSION_VIEW = "view"
DATA_SOURCE_PERMISSION_QUERY = "query"
DATA_SOURCE_PERMISSION_EDIT = "edit"
DATA_SOURCE_PERMISSION_MANAGE = "manage"
DATA_SOURCE_PERMISSION_SHARE = "share"

_MANAGE_PERMISSION = DATA_SOURCE_PERMISSION_MANAGE
VALID_DATA_SOURCE_PERMISSIONS = {
    DATA_SOURCE_PERMISSION_VIEW,
    DATA_SOURCE_PERMISSION_QUERY,
    DATA_SOURCE_PERMISSION_EDIT,
    DATA_SOURCE_PERMISSION_MANAGE,
    DATA_SOURCE_PERMISSION_SHARE,
}
VALID_DATA_SOURCE_GRANTEE_TYPES = {
    "project",
    "user",
    "group",
    "org_role",
    "project_role",
}


def _uuid_or_none(value: Optional[str]) -> Optional[UUID]:
    if not value:
        return None
    try:
        return UUID(str(value))
    except (TypeError, ValueError):
        return None


def _permission_set(raw_permissions: object) -> set[str]:
    if isinstance(raw_permissions, list):
        return {str(item) for item in raw_permissions if item}
    if isinstance(raw_permissions, dict):
        return {str(key) for key, allowed in raw_permissions.items() if allowed}
    return set()


def _grant_allows(raw_permissions: object, permission: str) -> bool:
    permissions = _permission_set(raw_permissions)
    return _MANAGE_PERMISSION in permissions or permission in permissions


def _normalize_permissions(permissions: Sequence[str]) -> list[str]:
    normalized = sorted({str(permission).strip() for permission in permissions if permission})
    invalid = [permission for permission in normalized if permission not in VALID_DATA_SOURCE_PERMISSIONS]
    if invalid:
        raise ValueError(f"Invalid data source permissions: {', '.join(invalid)}")
    if not normalized:
        raise ValueError("At least one data source permission is required")
    return normalized


def _normalize_grantee_type(grantee_type: str) -> str:
    normalized = str(grantee_type or "").strip()
    if normalized not in VALID_DATA_SOURCE_GRANTEE_TYPES:
        raise ValueError(f"Invalid data source grantee type: {normalized}")
    return normalized


class DataSourceAccessService:
    """Resolve explicit data-source grants for users, projects, groups, and roles."""

    @staticmethod
    async def _effective_role_names(
        user_id: str,
        organization_id: Optional[str],
        project_id: Optional[str],
    ) -> tuple[set[str], set[str]]:
        if not is_ee_enabled():
            return set(), set()

        try:
            from src.modules.authentication.rbac.rbac_service import RBACService
        except ImportError:
            return set(), set()

        org_roles = set()
        project_roles = set()
        if organization_id:
            roles = await RBACService.get_user_roles(user_id, organization_id, None)
            org_roles.update(str(role.name) for role in roles)
        if project_id:
            roles = await RBACService.get_user_roles(user_id, organization_id, project_id)
            project_roles.update(str(role.name) for role in roles)
        return org_roles, project_roles

    @staticmethod
    async def _has_project_membership(
        user_id: str,
        organization_id: Optional[str],
        project_id: str,
    ) -> bool:
        if not is_ee_enabled():
            return False
        try:
            from src.modules.authentication.rbac.rbac_service import RBACService
        except ImportError:
            return False
        return await RBACService.check_permission(
            user_id=user_id,
            permission_code="project:view",
            organization_id=organization_id,
            project_id=project_id,
        )

    @staticmethod
    async def _is_org_data_admin(user_id: str, organization_id: Optional[str]) -> bool:
        if not is_ee_enabled() or not organization_id:
            return False
        try:
            from src.modules.authentication.rbac.rbac_service import RBACService
        except ImportError:
            return False
        return await RBACService.check_permission(
            user_id=user_id,
            permission_code="data:*",
            organization_id=organization_id,
        )

    @staticmethod
    async def resolve_user_group_ids(
        user_id: str,
        organization_id: Optional[str],
        *,
        session: Optional[AsyncSession] = None,
    ) -> list[str]:
        """Resolve workspace group IDs for data-source grants.

        No first-class workspace group membership model exists in CE today. EE can
        override or extend this once a concrete groups/teams domain model lands.
        """
        return []

    @staticmethod
    async def get_data_source(
        data_source_id: str,
        *,
        session: Optional[AsyncSession] = None,
    ) -> Optional[DataSource]:
        owns_session = session is None
        db = session or async_session()
        if owns_session:
            async with db as scoped:
                return await DataSourceAccessService.get_data_source(data_source_id, session=scoped)

        result = await session.execute(select(DataSource).where(DataSource.id == data_source_id))
        return result.scalar_one_or_none()

    @staticmethod
    async def can_access(
        user_id: str,
        data_source_id: str,
        permission: str,
        *,
        project_id: Optional[str] = None,
        group_ids: Optional[Sequence[str]] = None,
        session: Optional[AsyncSession] = None,
    ) -> bool:
        """Return whether user has an explicit grant for a data-source permission."""
        owns_session = session is None
        db = session or async_session()
        if owns_session:
            async with db as scoped:
                return await DataSourceAccessService.can_access(
                    user_id,
                    data_source_id,
                    permission,
                    project_id=project_id,
                    group_ids=group_ids,
                    session=scoped,
                )

        data_source = await DataSourceAccessService.get_data_source(data_source_id, session=session)
        if not data_source:
            return False

        if not is_ee_enabled():
            owner_id = getattr(data_source, "user_id", None)
            if permission in {DATA_SOURCE_PERMISSION_VIEW, DATA_SOURCE_PERMISSION_QUERY}:
                return owner_id is None or str(owner_id) == str(user_id)
            return owner_id is not None and str(owner_id) == str(user_id)

        organization_id = str(data_source.organization_id) if data_source.organization_id else None
        if await DataSourceAccessService._is_org_data_admin(user_id, organization_id):
            return True

        groups = {str(group_id) for group_id in (group_ids or []) if group_id}
        org_roles, project_roles = await DataSourceAccessService._effective_role_names(
            user_id,
            organization_id,
            project_id,
        )

        grant_filters = [
            and_(
                DataSourceAccessGrant.grantee_type == "user",
                DataSourceAccessGrant.grantee_id == str(user_id),
            ),
        ]
        if groups:
            grant_filters.append(
                and_(
                    DataSourceAccessGrant.grantee_type == "group",
                    DataSourceAccessGrant.grantee_id.in_(groups),
                )
            )
        if org_roles:
            grant_filters.append(
                and_(
                    DataSourceAccessGrant.grantee_type == "org_role",
                    DataSourceAccessGrant.grantee_id.in_(org_roles),
                )
            )
        if project_roles:
            grant_filters.append(
                and_(
                    DataSourceAccessGrant.grantee_type == "project_role",
                    DataSourceAccessGrant.grantee_id.in_(project_roles),
                )
            )
        if project_id and await DataSourceAccessService._has_project_membership(
            user_id,
            organization_id,
            project_id,
        ):
            grant_filters.append(
                and_(
                    DataSourceAccessGrant.grantee_type == "project",
                    DataSourceAccessGrant.grantee_id == str(project_id),
                )
            )

        query = select(DataSourceAccessGrant).where(
            DataSourceAccessGrant.data_source_id == data_source_id,
            DataSourceAccessGrant.is_active == True,
            DataSourceAccessGrant.is_deleted == False,
            or_(*grant_filters),
        )
        result = await session.execute(query)
        grants = result.scalars().all()
        return any(_grant_allows(grant.permissions, permission) for grant in grants)

    @staticmethod
    async def get_applicable_grants(
        user_id: str,
        data_source_id: str,
        permission: str,
        *,
        project_id: Optional[str] = None,
        group_ids: Optional[Sequence[str]] = None,
        session: Optional[AsyncSession] = None,
    ) -> list[DataSourceAccessGrant]:
        """Return active grants matching a user and permission for a data source."""
        owns_session = session is None
        db = session or async_session()
        if owns_session:
            async with db as scoped:
                return await DataSourceAccessService.get_applicable_grants(
                    user_id,
                    data_source_id,
                    permission,
                    project_id=project_id,
                    group_ids=group_ids,
                    session=scoped,
                )

        data_source = await DataSourceAccessService.get_data_source(data_source_id, session=session)
        if not data_source or not is_ee_enabled():
            return []

        organization_id = str(data_source.organization_id) if data_source.organization_id else None
        groups = {str(group_id) for group_id in (group_ids or []) if group_id}
        if not groups:
            groups.update(
                await DataSourceAccessService.resolve_user_group_ids(
                    user_id,
                    organization_id,
                    session=session,
                )
            )
        org_roles, project_roles = await DataSourceAccessService._effective_role_names(
            user_id,
            organization_id,
            project_id,
        )

        grant_filters = [
            and_(
                DataSourceAccessGrant.grantee_type == "user",
                DataSourceAccessGrant.grantee_id == str(user_id),
            ),
        ]
        if groups:
            grant_filters.append(
                and_(
                    DataSourceAccessGrant.grantee_type == "group",
                    DataSourceAccessGrant.grantee_id.in_(groups),
                )
            )
        if org_roles:
            grant_filters.append(
                and_(
                    DataSourceAccessGrant.grantee_type == "org_role",
                    DataSourceAccessGrant.grantee_id.in_(org_roles),
                )
            )
        if project_roles:
            grant_filters.append(
                and_(
                    DataSourceAccessGrant.grantee_type == "project_role",
                    DataSourceAccessGrant.grantee_id.in_(project_roles),
                )
            )
        if project_id and await DataSourceAccessService._has_project_membership(
            user_id,
            organization_id,
            project_id,
        ):
            grant_filters.append(
                and_(
                    DataSourceAccessGrant.grantee_type == "project",
                    DataSourceAccessGrant.grantee_id == str(project_id),
                )
            )

        result = await session.execute(
            select(DataSourceAccessGrant).where(
                DataSourceAccessGrant.data_source_id == data_source_id,
                DataSourceAccessGrant.is_active == True,
                DataSourceAccessGrant.is_deleted == False,
                or_(*grant_filters),
            )
        )
        return [
            grant
            for grant in result.scalars().all()
            if _grant_allows(grant.permissions, permission)
        ]

    @staticmethod
    async def list_accessible_source_ids(
        user_id: str,
        organization_id: Optional[str],
        *,
        project_id: Optional[str] = None,
        group_ids: Optional[Sequence[str]] = None,
        permission: str = DATA_SOURCE_PERMISSION_VIEW,
        session: Optional[AsyncSession] = None,
    ) -> list[str]:
        """List data-source IDs visible to a user in an organization/project context."""
        owns_session = session is None
        db = session or async_session()
        if owns_session:
            async with db as scoped:
                return await DataSourceAccessService.list_accessible_source_ids(
                    user_id,
                    organization_id,
                    project_id=project_id,
                    group_ids=group_ids,
                    permission=permission,
                    session=scoped,
                )

        if not is_ee_enabled():
            result = await session.execute(
                select(DataSource.id).where(
                    or_(DataSource.user_id == _uuid_or_none(user_id), DataSource.user_id.is_(None))
                )
            )
            return [str(source_id) for source_id in result.scalars().all()]

        if await DataSourceAccessService._is_org_data_admin(user_id, organization_id):
            query = select(DataSource.id)
            if organization_id:
                query = query.where(DataSource.organization_id == _uuid_or_none(organization_id))
            result = await session.execute(query)
            return [str(source_id) for source_id in result.scalars().all()]

        groups = {str(group_id) for group_id in (group_ids or []) if group_id}
        org_roles, project_roles = await DataSourceAccessService._effective_role_names(
            user_id,
            organization_id,
            project_id,
        )
        grant_filters = [
            and_(
                DataSourceAccessGrant.grantee_type == "user",
                DataSourceAccessGrant.grantee_id == str(user_id),
            ),
        ]
        if groups:
            grant_filters.append(
                and_(
                    DataSourceAccessGrant.grantee_type == "group",
                    DataSourceAccessGrant.grantee_id.in_(groups),
                )
            )
        if org_roles:
            grant_filters.append(
                and_(
                    DataSourceAccessGrant.grantee_type == "org_role",
                    DataSourceAccessGrant.grantee_id.in_(org_roles),
                )
            )
        if project_roles:
            grant_filters.append(
                and_(
                    DataSourceAccessGrant.grantee_type == "project_role",
                    DataSourceAccessGrant.grantee_id.in_(project_roles),
                )
            )
        if project_id and await DataSourceAccessService._has_project_membership(
            user_id,
            organization_id,
            project_id,
        ):
            grant_filters.append(
                and_(
                    DataSourceAccessGrant.grantee_type == "project",
                    DataSourceAccessGrant.grantee_id == str(project_id),
                )
            )

        query = select(
            DataSourceAccessGrant.data_source_id,
            DataSourceAccessGrant.permissions,
        ).where(
            DataSourceAccessGrant.is_active == True,
            DataSourceAccessGrant.is_deleted == False,
            or_(*grant_filters),
        )
        if organization_id:
            query = query.where(
                DataSourceAccessGrant.organization_id == _uuid_or_none(organization_id)
            )

        result = await session.execute(query)
        return sorted(
            {
                str(data_source_id)
                for data_source_id, permissions in result.all()
                if _grant_allows(permissions, permission)
            }
        )

    @staticmethod
    async def grant_project_access(
        *,
        data_source_id: str,
        organization_id: Optional[str],
        project_id: str,
        created_by: Optional[str],
        permissions: Optional[Sequence[str]] = None,
        session: Optional[AsyncSession] = None,
    ) -> None:
        """Create or reactivate a project grant for a data source."""
        if not is_ee_enabled() or not project_id:
            return

        owns_session = session is None
        db = session or async_session()
        if owns_session:
            async with db as scoped:
                await DataSourceAccessService.grant_project_access(
                    data_source_id=data_source_id,
                    organization_id=organization_id,
                    project_id=project_id,
                    created_by=created_by,
                    permissions=permissions,
                    session=scoped,
                )
                await scoped.commit()
            return

        grant_permissions = list(
            permissions
            or [
                DATA_SOURCE_PERMISSION_VIEW,
                DATA_SOURCE_PERMISSION_QUERY,
                DATA_SOURCE_PERMISSION_EDIT,
                DATA_SOURCE_PERMISSION_MANAGE,
            ]
        )
        result = await session.execute(
            select(DataSourceAccessGrant).where(
                DataSourceAccessGrant.data_source_id == data_source_id,
                DataSourceAccessGrant.grantee_type == "project",
                DataSourceAccessGrant.grantee_id == str(project_id),
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.organization_id = _uuid_or_none(organization_id)
            existing.permissions = grant_permissions
            existing.is_active = True
            existing.is_deleted = False
            return

        session.add(
            DataSourceAccessGrant(
                organization_id=_uuid_or_none(organization_id),
                data_source_id=data_source_id,
                grantee_type="project",
                grantee_id=str(project_id),
                permissions=grant_permissions,
                created_by=_uuid_or_none(created_by),
                is_active=True,
                is_deleted=False,
            )
        )

    @staticmethod
    async def list_grants(
        data_source_id: str,
        *,
        session: Optional[AsyncSession] = None,
    ) -> list[DataSourceAccessGrant]:
        """List active grants for a data source."""
        owns_session = session is None
        db = session or async_session()
        if owns_session:
            async with db as scoped:
                return await DataSourceAccessService.list_grants(
                    data_source_id,
                    session=scoped,
                )

        result = await session.execute(
            select(DataSourceAccessGrant)
            .where(
                DataSourceAccessGrant.data_source_id == data_source_id,
                DataSourceAccessGrant.is_active == True,
                DataSourceAccessGrant.is_deleted == False,
            )
            .order_by(DataSourceAccessGrant.created_at.asc())
        )
        return list(result.scalars().all())

    @staticmethod
    async def upsert_grant(
        *,
        data_source_id: str,
        organization_id: Optional[str],
        grantee_type: str,
        grantee_id: str,
        permissions: Sequence[str],
        created_by: Optional[str],
        rls_policy_id: Optional[str] = None,
        session: Optional[AsyncSession] = None,
    ) -> DataSourceAccessGrant:
        """Create or reactivate a data-source grant."""
        normalized_grantee_type = _normalize_grantee_type(grantee_type)
        normalized_grantee_id = str(grantee_id or "").strip()
        if not normalized_grantee_id:
            raise ValueError("Grant grantee_id is required")
        normalized_permissions = _normalize_permissions(permissions)

        owns_session = session is None
        db = session or async_session()
        if owns_session:
            async with db as scoped:
                grant = await DataSourceAccessService.upsert_grant(
                    data_source_id=data_source_id,
                    organization_id=organization_id,
                    grantee_type=normalized_grantee_type,
                    grantee_id=normalized_grantee_id,
                    permissions=normalized_permissions,
                    created_by=created_by,
                    rls_policy_id=rls_policy_id,
                    session=scoped,
                )
                await scoped.commit()
                return grant

        result = await session.execute(
            select(DataSourceAccessGrant).where(
                DataSourceAccessGrant.data_source_id == data_source_id,
                DataSourceAccessGrant.grantee_type == normalized_grantee_type,
                DataSourceAccessGrant.grantee_id == normalized_grantee_id,
            )
        )
        existing = result.scalar_one_or_none()
        if existing:
            existing.organization_id = _uuid_or_none(organization_id)
            existing.permissions = normalized_permissions
            existing.rls_policy_id = _uuid_or_none(rls_policy_id)
            existing.created_by = _uuid_or_none(created_by)
            existing.is_active = True
            existing.is_deleted = False
            existing.deleted_at = None
            return existing

        grant = DataSourceAccessGrant(
            id=uuid4(),
            organization_id=_uuid_or_none(organization_id),
            data_source_id=data_source_id,
            grantee_type=normalized_grantee_type,
            grantee_id=normalized_grantee_id,
            permissions=normalized_permissions,
            rls_policy_id=_uuid_or_none(rls_policy_id),
            created_by=_uuid_or_none(created_by),
            is_active=True,
            is_deleted=False,
        )
        session.add(grant)
        return grant

    @staticmethod
    async def revoke_grant(
        *,
        data_source_id: str,
        grant_id: str,
        session: Optional[AsyncSession] = None,
    ) -> bool:
        """Soft-delete one grant from a data source."""
        owns_session = session is None
        db = session or async_session()
        if owns_session:
            async with db as scoped:
                revoked = await DataSourceAccessService.revoke_grant(
                    data_source_id=data_source_id,
                    grant_id=grant_id,
                    session=scoped,
                )
                await scoped.commit()
                return revoked

        result = await session.execute(
            select(DataSourceAccessGrant).where(
                DataSourceAccessGrant.id == _uuid_or_none(grant_id),
                DataSourceAccessGrant.data_source_id == data_source_id,
                DataSourceAccessGrant.is_deleted == False,
            )
        )
        grant = result.scalar_one_or_none()
        if not grant:
            return False

        grant.is_active = False
        grant.is_deleted = True
        grant.deleted_at = datetime.now(timezone.utc)
        return True

    @staticmethod
    async def can_view(user_id: str, data_source_id: str, **kwargs) -> bool:
        return await DataSourceAccessService.can_access(
            user_id,
            data_source_id,
            DATA_SOURCE_PERMISSION_VIEW,
            **kwargs,
        )

    @staticmethod
    async def can_query(user_id: str, data_source_id: str, **kwargs) -> bool:
        return await DataSourceAccessService.can_access(
            user_id,
            data_source_id,
            DATA_SOURCE_PERMISSION_QUERY,
            **kwargs,
        )

    @staticmethod
    async def can_edit(user_id: str, data_source_id: str, **kwargs) -> bool:
        return await DataSourceAccessService.can_access(
            user_id,
            data_source_id,
            DATA_SOURCE_PERMISSION_EDIT,
            **kwargs,
        )

    @staticmethod
    async def can_manage(user_id: str, data_source_id: str, **kwargs) -> bool:
        return await DataSourceAccessService.can_access(
            user_id,
            data_source_id,
            DATA_SOURCE_PERMISSION_MANAGE,
            **kwargs,
        )
