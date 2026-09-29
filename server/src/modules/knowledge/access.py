"""Knowledge base access scoping — CE user-owned; EE project/org via RBAC tables."""

from __future__ import annotations

from uuid import UUID

from sqlalchemy import or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.core.edition import is_ee_enabled


def knowledge_documents_filter(user_id: UUID):
    """
    SQLAlchemy filter clause for listing/searching KB documents the user may access.
    CE: documents owned by user_id.
    EE: owned documents + documents in data sources linked to the user's projects.
    """
    from src.modules.knowledge.models import KnowledgeDocument
    from src.modules.data.models import DataSource, ProjectDataSource

    if not is_ee_enabled():
        return KnowledgeDocument.user_id == user_id

    from src.modules.authentication.rbac.models import UserRole

    project_ids_stmt = (
        select(UserRole.project_id)
        .where(
            UserRole.user_id == user_id,
            UserRole.project_id.isnot(None),
            UserRole.is_active.is_(True),
            UserRole.is_deleted.is_(False),
        )
    )
    linked_ds_stmt = (
        select(ProjectDataSource.data_source_id)
        .where(
            ProjectDataSource.project_id.in_(project_ids_stmt),
            ProjectDataSource.is_active.is_(True),
        )
    )
    owned_ds_stmt = select(DataSource.id).where(DataSource.user_id == user_id)

    return or_(
        KnowledgeDocument.user_id == user_id,
        KnowledgeDocument.data_source_id.in_(linked_ds_stmt),
        KnowledgeDocument.data_source_id.in_(owned_ds_stmt),
    )


async def user_can_access_data_source(
    session: AsyncSession,
    user_id: UUID,
    data_source_id: str,
) -> bool:
    """Return True if user may use this KB data source."""
    from src.modules.knowledge.models import KnowledgeDocument

    if not data_source_id:
        return False

    stmt = (
        select(KnowledgeDocument.id)
        .where(
            KnowledgeDocument.data_source_id == data_source_id,
            knowledge_documents_filter(user_id),
        )
        .limit(1)
    )
    result = await session.execute(stmt)
    if result.scalar_one_or_none():
        return True

    from src.modules.data.models import DataSource, ProjectDataSource

    ds = await session.scalar(select(DataSource).where(DataSource.id == data_source_id))
    if not ds:
        return False
    if ds.user_id and ds.user_id == user_id:
        return True

    if not is_ee_enabled():
        return False

    from src.modules.authentication.rbac.models import UserRole

    if ds.project_id:
        role = await session.scalar(
            select(UserRole.id)
            .where(
                UserRole.user_id == user_id,
                UserRole.project_id == ds.project_id,
                UserRole.is_active.is_(True),
                UserRole.is_deleted.is_(False),
            )
            .limit(1)
        )
        if role:
            return True

    link = await session.scalar(
        select(ProjectDataSource.id)
        .where(
            ProjectDataSource.data_source_id == data_source_id,
            ProjectDataSource.project_id.in_(
                select(UserRole.project_id).where(
                    UserRole.user_id == user_id,
                    UserRole.project_id.isnot(None),
                    UserRole.is_active.is_(True),
                    UserRole.is_deleted.is_(False),
                )
            ),
        )
        .limit(1)
    )
    return link is not None


# ── One rule for every knowledge document route ─────────────────────────────
#
# In EE a knowledge base is a library (organization- or project-scoped), and its roles decide
# who may see and change it. Document routes used to check a different thing — ownership and
# project links — so org-wide libraries were visible but their documents were refused, and
# uploads were not checked against the library at all. Every route now asks this one question.

KnowledgeAction = str  # "view" | "contribute" | "manage"


async def _library_decision(
    session: AsyncSession, user_id: str, data_source_id: str, action: KnowledgeAction
) -> bool | None:
    """The library's answer, or None when the source isn't a library (CE, or a legacy KB)."""
    if not is_ee_enabled():
        return None
    import importlib

    try:
        models = importlib.import_module("ee.modules.knowledge.models")
        service = importlib.import_module("ee.modules.knowledge.library_service")
    except ImportError:
        return None
    Library = models.KnowledgeLibrary
    library = await session.scalar(
        select(Library).where(Library.data_source_id == str(data_source_id), Library.is_deleted.is_(False)).limit(1)
    )
    if library is None:
        return None
    svc = service.KnowledgeLibraryService
    if action == "view":
        return await svc.user_can_view_library(user_id, library)
    if await svc.user_can_manage_library(user_id, library):
        return True
    if action == "contribute":
        # Adding and fixing documents: people who may create knowledge in the library's scope.
        return await service.RBACService.check_permission(
            user_id=user_id,
            permission_code="knowledge:create",
            organization_id=str(library.organization_id),
            project_id=str(library.project_id) if library.scope == "project" and library.project_id else None,
        )
    return False


async def can_use_knowledge_source(
    session: AsyncSession, user_id: UUID | str, data_source_id: str, action: KnowledgeAction = "view"
) -> bool:
    """May this user view, contribute to, or manage the knowledge base behind ``data_source_id``?"""
    if not data_source_id:
        return False
    decision = await _library_decision(session, str(user_id), data_source_id, action)
    if decision is not None:
        return decision
    # Not a library: ownership / project membership, or an explicit grant on the source.
    uid = user_id if isinstance(user_id, UUID) else UUID(str(user_id))
    if await user_can_access_data_source(session, uid, data_source_id):
        return True
    from src.modules.data.services.data_source_access_service import DataSourceAccessService

    permission = "data:view" if action == "view" else "data:edit"
    return await DataSourceAccessService.can_access(str(user_id), data_source_id, permission, session=session)
