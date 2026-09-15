"""Shared materialized-view refresh logic.

Used by the manual refresh endpoint (`data/router.py`) and by the scheduled
email dispatcher's "refresh data before sending" option — one code path so
both stay in sync.
"""

import logging
from typing import TypedDict

from src.modules.data.services.data_connectivity_service import DataConnectivityService
from src.modules.data.services.multi_engine_query_service import (
    QueryEngine,
    _quote_ident_part,
    get_multi_engine_query_service,
)
from src.modules.data.services.query_identity import SystemQuery

logger = logging.getLogger(__name__)

_data_service = DataConnectivityService()
_multi_engine_service = get_multi_engine_query_service()


class MaterializedViewRefreshResult(TypedDict):
    refreshed: int
    failed: int
    total: int


async def refresh_all_materialized_views(data_source_id: str) -> MaterializedViewRefreshResult:
    """Best-effort refresh of every materialized view on a (Postgres) data source.

    Non-Postgres sources, or sources with no materialized views, simply return
    zero counts — this is intentionally silent/non-fatal so it's safe to call
    from a background dispatcher for any data source type.
    """
    data_source = await _data_service.get_data_source_by_id(data_source_id)
    if not data_source:
        logger.warning("refresh_all_materialized_views: data source %s not found", data_source_id)
        return {"refreshed": 0, "failed": 0, "total": 0}

    try:
        result = await _multi_engine_service.execute_query(
            query="SELECT schemaname, matviewname FROM pg_matviews ORDER BY 1,2",
            data_source=data_source,
            engine=QueryEngine.DIRECT_SQL,
            optimization=False,
            identity=SystemQuery(reason="materialized view refresh"),
        )
        views = [
            (row.get("schemaname") or "public", row.get("matviewname"))
            for row in result.get("data", [])
            if row.get("matviewname")
        ]
    except Exception as exc:
        # Not every data source is Postgres / supports pg_matviews — that's fine.
        logger.info("refresh_all_materialized_views: skipping %s (%s)", data_source_id, exc)
        return {"refreshed": 0, "failed": 0, "total": 0}

    refreshed = 0
    failed = 0
    for schema, name in views:
        qualified = f"{_quote_ident_part(schema)}.{_quote_ident_part(name)}"
        try:
            await _multi_engine_service.execute_query(
                query=f"REFRESH MATERIALIZED VIEW CONCURRENTLY {qualified}",
                data_source=data_source,
                engine=QueryEngine.DIRECT_SQL,
                optimization=False,
                identity=SystemQuery(reason="materialized view refresh"),
            )
            refreshed += 1
        except Exception as exc:
            # CONCURRENTLY requires a unique index on the view; views without
            # one used to just land in the failed bucket with no distinguishing
            # error. Fall back to a plain (locking) refresh -- still better
            # than never refreshing a view an admin explicitly asked to have
            # kept current.
            if "concurrent" in str(exc).lower() or "unique index" in str(exc).lower():
                try:
                    await _multi_engine_service.execute_query(
                        query=f"REFRESH MATERIALIZED VIEW {qualified}",
                        data_source=data_source,
                        engine=QueryEngine.DIRECT_SQL,
                        optimization=False,
                        identity=SystemQuery(reason="materialized view refresh (non-concurrent fallback)"),
                    )
                    refreshed += 1
                    logger.info(
                        "refresh_all_materialized_views: %s.%s has no unique index for CONCURRENTLY, "
                        "refreshed with a plain (locking) REFRESH instead",
                        schema, name,
                    )
                    continue
                except Exception as fallback_exc:
                    exc = fallback_exc
            failed += 1
            logger.warning(
                "refresh_all_materialized_views: failed to refresh %s.%s on %s: %s",
                schema, name, data_source_id, exc,
            )

    return {"refreshed": refreshed, "failed": failed, "total": len(views)}
