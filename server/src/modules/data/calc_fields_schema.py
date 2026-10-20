"""Merge data-source calculated fields into the schema blob the AI uses for NL2SQL."""

from __future__ import annotations

import copy
import logging
from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)


async def fetch_calculated_fields(db: AsyncSession, data_source_id: str) -> List[Dict[str, Any]]:
    from sqlalchemy import text as sa_text

    try:
        result = await db.execute(
            sa_text(
                "SELECT name, expression, description "
                "FROM semantic_metrics "
                "WHERE data_source_id = :ds AND source = 'calculated' AND is_active = true "
                "ORDER BY name"
            ),
            {"ds": data_source_id},
        )
        return [
            {"name": row[0], "expression": row[1], "description": row[2] or ""}
            for row in result.fetchall()
        ]
    except Exception as exc:
        logger.debug("calc fields load skipped for %s: %s", data_source_id, exc)
        return []


def enrich_schema_with_calculated_fields(
    schema: Optional[Dict[str, Any]],
    fields: List[Dict[str, Any]],
) -> Optional[Dict[str, Any]]:
    if not schema or not isinstance(schema, dict):
        return schema
    if not fields:
        return schema
    out = copy.deepcopy(schema)
    out["calculated_fields"] = fields
    return out
