from typing import Optional, Iterable
from sqlalchemy import select, text
# User model removed - user management will be handled by Supabase
from src.modules.project.models import Project
from src.db.session import async_session
import uuid
import logging
from src.core.config import settings

logger = logging.getLogger(__name__)


async def _resolve_user_str(user_payload) -> Optional[str]:
    """Resolve incoming JWT payload or id to canonical users.id string (UUID).

    Only UUIDs or lookups by email/username are accepted. Legacy integer ids are not supported.
    """
    if not user_payload:
        return None
    # Extract unverified claims if a raw JWT string is passed
    try:
        from jose import jwt as jose_jwt
        if isinstance(user_payload, str) and "." in user_payload:
            try:
                claims = jose_jwt.get_unverified_claims(user_payload)
                if isinstance(claims, dict) and claims:
                    user_payload = claims
            except Exception:
                pass
    except Exception:
        pass

    if isinstance(user_payload, dict):
        maybe = user_payload.get('id') or user_payload.get('sub')
        email = user_payload.get('email')
        username = user_payload.get('username') or user_payload.get('user')
    else:
        maybe = user_payload
        email = None
        username = None

    # If maybe looks like UUID, return as normalized string
    try:
        if maybe is not None:
            return str(uuid.UUID(str(maybe)))
    except Exception:
        pass

    # Users table removed - user lookup will be done via Supabase
    # For now, just return the UUID if it's valid, otherwise None
    # User resolution will be handled by Supabase integration

    return None


async def has_org_role(user_payload, organization_id: int, roles: Iterable[str]) -> bool:
    """Return True if user has any of the roles in the organization."""
    uid = await _resolve_user_str(user_payload)
    logger.info(f"has_dashboard_access: resolved uid={uid}")
    if not uid:
        return False
    async with async_session() as sdb:
        try:
            q = text("""
                SELECT COALESCE(r.name, 'viewer') AS role_name
                FROM user_roles ur
                LEFT JOIN roles r ON r.id = ur.role_id
                WHERE ur.organization_id = :oid
                  AND ur.user_id::text = :uid
                  AND (ur.is_active = true OR ur.is_active IS NULL)
                LIMIT 1
            """)
            res = await sdb.execute(q.bindparams(oid=organization_id, uid=uid))
            row = res.first()
            if not row:
                # Legacy fallback for deployments still using user_organizations
                q_fallback = text("SELECT role FROM user_organizations WHERE organization_id = :oid AND user_id::text = :uid LIMIT 1")
                res = await sdb.execute(q_fallback.bindparams(oid=organization_id, uid=uid))
                row = res.first()
            if not row:
                return False
            role = (row[0] or '').lower()
            return role in set(r.lower() for r in roles)
        except Exception as e:
            logger.exception(f"has_org_role error: {e}")
            return False


async def is_project_owner(user_payload, project_id: int) -> bool:
    """Return True if the user is the created_by of the project or is owner/admin of the organization."""
    uid = await _resolve_user_str(user_payload)
    if not uid:
        return False
    async with async_session() as sdb:
        try:
            pres = await sdb.execute(select(Project).where(Project.id == project_id))
            proj = pres.scalar_one_or_none()
            if not proj:
                return False
            if proj.created_by and str(proj.created_by) == uid:
                return True
            return await has_org_role(user_payload, proj.organization_id, ['owner', 'admin'])
        except Exception as e:
            logger.exception(f"is_project_owner error: {e}")
            return False


async def has_dashboard_access(user_payload, dashboard_id: str) -> bool:
    """Checks if a user can access a dashboard: public, creator, or org owner/admin."""
    env = str(getattr(settings, 'ENVIRONMENT', 'development')).strip().lower()
    logger.info(f"has_dashboard_access called: ENV={env} dashboard_id={dashboard_id} user_payload_type={type(user_payload)}")
    # Development convenience: allow access during local dev/CI
    try:
        if env in ('development', 'dev', 'local', 'test') and user_payload:
            logger.info("has_dashboard_access: development bypass enabled - granting access")
            return True
    except Exception:
        pass
    # Extract unverified claims if needed
    try:
        if isinstance(user_payload, str) and "." in user_payload:
            from jose import jwt as jose_jwt
            try:
                claims = jose_jwt.get_unverified_claims(user_payload)
                if isinstance(claims, dict) and claims:
                    user_payload = claims
                    logger.info("has_dashboard_access: extracted unverified claims from token")
            except Exception:
                logger.debug("has_dashboard_access: failed to extract unverified claims from token")
                pass
    except Exception:
        pass
    uid = await _resolve_user_str(user_payload)
    async with async_session() as sdb:
        try:
            from uuid import UUID as UUIDType

            try:
                dash_uuid = UUIDType(str(dashboard_id))
            except Exception:
                return False

            from src.modules.dashboards.models import Dashboard as DashboardORM
            from src.modules.dashboards.models import Dashboard as DashboardDB
            from src.modules.project.models import Project
            from src.modules.authentication.rbac.rbac_service import RBACService

            # Prefer canonical SQLAlchemy row (always has project_id for charts dashboards)
            pres_leg = await sdb.execute(select(DashboardDB).where(DashboardDB.id == dash_uuid))
            leg = pres_leg.scalar_one_or_none()
            if leg and leg.project_id:
                pres2 = await sdb.execute(select(Project.organization_id).where(Project.id == leg.project_id))
                org_id = pres2.scalar_one_or_none()
                if org_id:
                    if uid and await RBACService.check_permission(
                        str(uid), "dashboard:view", str(org_id), str(leg.project_id)
                    ):
                        return True
                    return await has_org_role(user_payload, org_id, ["owner", "admin"])
                return False

            pres = await sdb.execute(select(DashboardORM).where(DashboardORM.id == dash_uuid))
            db_dash = pres.scalar_one_or_none()
            if not db_dash:
                return False
            if getattr(db_dash, "is_public", False):
                return True
            created_by = getattr(db_dash, "created_by", None)
            if uid and created_by and str(created_by) == uid:
                return True
            project_id = getattr(db_dash, "project_id", None)
            if project_id:
                pres2 = await sdb.execute(select(Project.organization_id).where(Project.id == project_id))
                org_id = pres2.scalar_one_or_none()
                if org_id:
                    if uid and await RBACService.check_permission(
                        str(uid), "dashboard:view", str(org_id), str(project_id)
                    ):
                        return True
                    return await has_org_role(user_payload, org_id, ["owner", "admin"])
            return False
        except Exception as e:
            logger.exception(f"has_dashboard_access error: {e}")
            return False


