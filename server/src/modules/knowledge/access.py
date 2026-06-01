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
