"""Governance overview: every connection's access rules in one table.

Rules stay where they are edited (each connection's Access tab); this page only reads them,
so there is one policy engine and one place to look across the project.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, Query
from sqlalchemy import and_, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.data.models import (
    DataSource,
    DataSourceAccessGrant,
    DataSourceCLSPolicy,
    DataSourceCLSRule,
    DataSourceRLSPolicy,
)
from src.modules.data.services.data_source_access_service import (
    DATA_SOURCE_PERMISSION_MANAGE,
    DataSourceAccessService,
)
from src.modules.data.services.governed_sql import caller_from_token

router = APIRouter()


def _counts(rows) -> Dict[str, int]:
    return {str(k): int(v) for k, v in rows}


@router.get("/overview")
async def overview(
    project_id: Optional[str] = Query(default=None),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = caller_from_token(current_token, project_id)
    ids = await DataSourceAccessService.list_accessible_source_ids(
        caller.user_id, caller.organization_id, project_id=caller.project_id,
        permission=DATA_SOURCE_PERMISSION_MANAGE, session=db,
    )
    if not ids:
        return {"sources": [], "totals": {"sources": 0, "unprotected": 0}}

    sources = (await db.execute(
        select(DataSource.id, DataSource.name, DataSource.type, DataSource.db_type)
        .where(DataSource.id.in_(ids), DataSource.is_active.is_(True))
    )).all()

    rls = _counts((await db.execute(
        select(DataSourceRLSPolicy.data_source_id, func.count())
        .where(DataSourceRLSPolicy.data_source_id.in_(ids), DataSourceRLSPolicy.enabled.is_(True),
               DataSourceRLSPolicy.is_deleted.is_not(True))
        .group_by(DataSourceRLSPolicy.data_source_id)
    )).all())
    masked = _counts((await db.execute(
        select(DataSourceCLSPolicy.data_source_id, func.count(DataSourceCLSRule.id))
        .join(DataSourceCLSRule, DataSourceCLSRule.policy_id == DataSourceCLSPolicy.id)
        .where(DataSourceCLSPolicy.data_source_id.in_(ids), DataSourceCLSPolicy.is_deleted.is_not(True))
        .group_by(DataSourceCLSPolicy.data_source_id)
    )).all())
    grant_base = and_(
        DataSourceAccessGrant.data_source_id.in_(ids),
        DataSourceAccessGrant.is_active.is_(True),
        DataSourceAccessGrant.is_deleted.is_not(True),
    )
    grants = _counts((await db.execute(
        select(DataSourceAccessGrant.data_source_id, func.count()).where(grant_base)
        .group_by(DataSourceAccessGrant.data_source_id)
    )).all())
    # A grant that can query with no row rule attached sees every row.
    unfiltered = _counts((await db.execute(
        select(DataSourceAccessGrant.data_source_id, func.count())
        .where(grant_base, DataSourceAccessGrant.rls_policy_id.is_(None),
               DataSourceAccessGrant.permissions.contains(["query"]))
        .group_by(DataSourceAccessGrant.data_source_id)
    )).all())

    out: List[Dict[str, Any]] = []
    for sid, name, stype, db_type in sources:
        sid = str(sid)
        out.append({
            "id": sid,
            "name": name,
            "kind": db_type or stype,
            "row_rules": rls.get(sid, 0),
            "masked_columns": masked.get(sid, 0),
            "grants": grants.get(sid, 0),
            "unfiltered_grants": unfiltered.get(sid, 0),
        })
    out.sort(key=lambda r: (-r["unfiltered_grants"], r["name"].lower()))
    return {
        "sources": out,
        "totals": {
            "sources": len(out),
            "unprotected": sum(1 for r in out if r["unfiltered_grants"] and not r["row_rules"]),
            "row_rules": sum(r["row_rules"] for r in out),
            "masked_columns": sum(r["masked_columns"] for r in out),
        },
    }
