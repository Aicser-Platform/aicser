"""Read a data source as a signed-in person, for features that need rows rather than a chart:
location analysis, notebooks and model training.

It passes the same gates as the query editor: the person must have query access to the
source and the ``query:execute`` permission, and the query runs through
MultiEngineQueryService.execute_query, where row and column security are applied. Callers
never talk to an engine directly.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence

from fastapi import HTTPException

from src.modules.authentication.helpers import extract_user_payload
from src.modules.data.services.query_identity import QueryIdentity

_IDENT = re.compile(r"^[A-Za-z_][A-Za-z0-9_ $.\-]{0,127}$")


@dataclass
class Caller:
    user_id: str
    organization_id: Optional[str]
    project_id: Optional[str]
    payload: Dict[str, Any]


def caller_from_token(current_token: Any, project_id: Optional[str] = None) -> Caller:
    payload = extract_user_payload(current_token) if not isinstance(current_token, dict) else current_token
    user_id = str(payload.get("id") or payload.get("user_id") or payload.get("sub") or "").strip()
    if not user_id:
        raise HTTPException(status_code=401, detail="Sign in to continue.")
    org = payload.get("organization_id") or payload.get("org_id")
    return Caller(
        user_id=user_id,
        organization_id=str(org) if org else None,
        project_id=str(project_id or payload.get("project_id") or "") or None,
        payload=payload,
    )


def quote_ident(name: str) -> str:
    """A column or table name as a quoted identifier; refuses anything that isn't a plain name."""
    if not isinstance(name, str) or not _IDENT.match(name):
        raise HTTPException(status_code=400, detail=f"{name!r} isn't a column or table name.")
    return '"' + name.replace('"', '""') + '"'


def quote_table(name: str) -> str:
    return ".".join(quote_ident(part) for part in name.split(".")) if "." in name else quote_ident(name)


async def load_source_for(caller: Caller, data_source_id: str) -> Dict[str, Any]:
    """The data source, after checking the caller may query it."""
    from src.db.session import async_session
    from src.modules.authentication.rbac.guard import require_permission
    from src.modules.data.services.data_connectivity_service import DataConnectivityService
    from src.modules.data.services.data_source_access_service import (
        DATA_SOURCE_PERMISSION_QUERY,
        DataSourceAccessService,
    )

    source = await DataConnectivityService().get_data_source_by_id(data_source_id)
    if not source:
        raise HTTPException(status_code=404, detail="Data source not found")
    project_id = caller.project_id or (str(source.get("project_id")) if source.get("project_id") else None)
    async with async_session() as db:
        allowed = await DataSourceAccessService.can_access(
            caller.user_id, data_source_id, DATA_SOURCE_PERMISSION_QUERY, project_id=project_id, session=db
        )
    if not allowed:
        raise HTTPException(status_code=403, detail="Not authorized to access this data source")
    await require_permission(caller.user_id, "query:execute", organization_id=caller.organization_id, project_id=project_id)
    caller.project_id = project_id
    return source


async def run_sql(caller: Caller, source: Dict[str, Any], sql: str) -> Dict[str, Any]:
    """Run ``sql`` as ``caller`` (row security applied). Returns {columns, rows}; raises 400 with
    the engine's message when the query fails."""
    from src.modules.data.services.multi_engine_query_service import get_multi_engine_query_service

    identity = QueryIdentity(
        user_id=caller.user_id,
        organization_id=caller.organization_id,
        project_id=caller.project_id,
        token_payload=caller.payload,
    )
    result = await get_multi_engine_query_service().execute_query(
        query=sql,
        data_source=source,
        cache_context={
            "organization_id": caller.organization_id,
            "project_id": caller.project_id,
            "user_id": caller.user_id,
        },
        identity=identity,
    )
    if not result.get("success"):
        raise HTTPException(status_code=400, detail=str(result.get("error") or "The query failed."))
    rows = result.get("data") or []
    columns = result.get("columns") or (list(rows[0].keys()) if rows and isinstance(rows[0], dict) else [])
    columns = [c.get("name") if isinstance(c, dict) else c for c in columns]
    return {"columns": columns, "rows": rows}


async def read_columns(
    caller: Caller,
    data_source_id: str,
    table: str,
    columns: Sequence[str],
    *,
    limit: int,
    where_not_null: Sequence[str] = (),
) -> Dict[str, Any]:
    """SELECT the named columns of one table (quoted, no free SQL), at most ``limit`` rows."""
    source = await load_source_for(caller, data_source_id)
    cols = ", ".join(quote_ident(c) for c in dict.fromkeys(columns))
    where = " AND ".join(f"{quote_ident(c)} IS NOT NULL" for c in where_not_null)
    sql = f"SELECT {cols} FROM {quote_table(table)}" + (f" WHERE {where}" if where else "") + f" LIMIT {int(limit)}"
    return await run_sql(caller, source, sql)


def rows_as_records(result: Dict[str, Any]) -> List[Dict[str, Any]]:
    rows = result.get("rows") or []
    columns = result.get("columns") or []
    if rows and not isinstance(rows[0], dict):
        return [dict(zip(columns, r)) for r in rows]
    return list(rows)
