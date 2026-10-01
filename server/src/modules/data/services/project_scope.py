"""Data stays inside its project: a chart or dashboard may only use data sources of its own project.

Projects are the unit people share and govern data in (row/column rules and grants are per
project). A chart in project A reading a source of project B would show B's data to A's members
under A's rules, so it is refused wherever a chart is saved, placed or run.
"""

from __future__ import annotations

from typing import Any, Optional


class CrossProjectSourceError(ValueError):
    """A chart/dashboard in one project points at a data source of another."""

    def __init__(self) -> None:
        super().__init__(
            "This chart uses a data source from another project. Pick a data source from this project."
        )


async def data_source_project(db: Any, data_source_id: Any) -> Optional[str]:
    if not data_source_id:
        return None
    from sqlalchemy import select

    from src.modules.data.models import DataSource

    source = (await db.execute(select(DataSource).where(DataSource.id == str(data_source_id)))).scalar_one_or_none()
    project = getattr(source, "project_id", None)
    return str(project) if project else None


async def dashboard_project(db: Any, dashboard_id: Any) -> Optional[str]:
    if not dashboard_id:
        return None
    from sqlalchemy import text

    row = (
        await db.execute(text("SELECT project_id FROM dashboards WHERE id::text = :id"), {"id": str(dashboard_id)})
    ).first()
    return str(row[0]) if row and row[0] else None


async def ensure_source_in_project(db: Any, data_source_id: Any, project_id: Any) -> None:
    """Raise CrossProjectSourceError when both are known and differ. Sources or charts without a
    project (Community edition, legacy rows) are not restricted here."""
    if not data_source_id or not project_id:
        return
    source_project = await data_source_project(db, data_source_id)
    if source_project and source_project != str(project_id):
        if await _shared_into_project(db, data_source_id, project_id):
            return
        raise CrossProjectSourceError()


async def _shared_into_project(db: Any, data_source_id: Any, project_id: Any) -> bool:
    """A source added to another project (project_data_source) belongs to that project too; the
    project's source list shows it, so charts there may use it."""
    from sqlalchemy import select

    from src.modules.data.models import ProjectDataSource

    link = (
        await db.execute(
            select(ProjectDataSource.id).where(
                ProjectDataSource.data_source_id == str(data_source_id),
                ProjectDataSource.project_id == str(project_id),
                ProjectDataSource.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    return link is not None
