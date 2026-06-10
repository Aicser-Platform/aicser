"""Invalidate cached Direct SQL pools when data source credentials change."""

from __future__ import annotations

import logging

logger = logging.getLogger(__name__)


def dispose_direct_sql_pool_for_data_source(data_source_id: str) -> None:
    """Drop pooled Direct SQL engine for a data source (after update/delete)."""
    if not data_source_id:
        return
    try:
        from src.modules.data.services.direct_sql_pool import dispose_engine_for_data_source

        dispose_engine_for_data_source(str(data_source_id))
    except Exception as exc:
        logger.debug("Direct SQL pool dispose skipped for %s: %s", data_source_id, exc)
