"""A connection's business metadata: what its columns mean, kept in schema.business_metadata.

column_descriptions feed Ask's schema search; column_roles say what a column is for (amount, count,
category, date, id, text); personal_columns mark columns holding personal data. Prepare and the
Schema tab write these.

Measures and dimensions are not kept here: they live in the semantic model, the one place a metric
or dimension is defined. What Ask trusts, highest first: official metrics, the rest of the semantic
model, then these column roles and descriptions, then guesses from names and types.

Keys are "table.column" (Schema tab, several tables) or a bare "column" (a single-table output from
Prepare); column_entry reads either.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, Optional

from sqlalchemy.orm.attributes import flag_modified

logger = logging.getLogger(__name__)

ROLES = ("amount", "count", "category", "date", "id", "text")
# What each role tells Ask to do with the column.
ROLE_USE = {"amount": "add up", "count": "add up", "id": "count distinct, never add up",
            "category": "group by", "date": "time", "text": "show, don't group"}


def column_entry(mapping: Any, table: Optional[str], column: str) -> Any:
    """The value for a column keyed "schema.table.column", "table.column" or "column", ignoring case."""
    if not isinstance(mapping, dict) or not column:
        return None
    col = column.lower()
    tbl = (table or "").split(".")[-1].lower()
    lowered = {str(k).lower(): v for k, v in mapping.items()}
    if tbl:
        for key, value in lowered.items():
            if key == f"{tbl}.{col}" or key.endswith(f".{tbl}.{col}"):
                return value
    return lowered.get(col)


def business_context_lines(bm: Any, max_items: int = 30) -> list:
    """What people said about the columns, as prompt lines: descriptions, roles, personal data."""
    if not isinstance(bm, dict):
        return []
    lines = []
    descriptions = bm.get("column_descriptions")
    if isinstance(descriptions, dict) and descriptions:
        descs = [f"{k}: {v}" for k, v in list(descriptions.items())[:20]]
        lines.append("Column descriptions: " + "; ".join(descs)[:400])
    roles = bm.get("column_roles")
    if isinstance(roles, dict) and roles:
        lines.append("Column roles: " + "; ".join(f"{k}={ROLE_USE.get(v, v)}" for k, v in list(roles.items())[:max_items]))
    personal = bm.get("personal_columns")
    if personal:
        lines.append("Personal data (don't list values unless asked): " + ", ".join(list(personal)[:20]))
    return lines


def columns_by_role(bm: Any) -> Dict[str, list]:
    """Column names people marked as numbers to add up, and as groupings (categories and dates)."""
    roles = bm.get("column_roles") if isinstance(bm, dict) and isinstance(bm.get("column_roles"), dict) else {}
    bare = lambda k: str(k).split(".")[-1]  # noqa: E731
    return {
        "measures": [bare(k) for k, v in roles.items() if v in ("amount", "count")],
        "dimensions": [bare(k) for k, v in roles.items() if v in ("category", "date")],
    }


async def refresh_after_metadata_change(db, data_source_id: str, schema: Dict[str, Any]) -> None:
    """Ask reads business metadata through caches and the schema index; refresh them."""
    try:
        from src.modules.ai.services.langgraph_orchestrator import LangGraphMultiAgentOrchestrator

        LangGraphMultiAgentOrchestrator.invalidate_schema_cache(data_source_id)
    except Exception as inv_err:  # noqa: BLE001
        logger.debug("Schema cache invalidation skipped: %s", inv_err)
    try:
        from src.core.cache import cache

        if cache:
            cache.delete(f"ds:{data_source_id}")
    except Exception:  # noqa: BLE001
        pass
    # Rebuild the schema index for Schema RAG: column descriptions change what it finds.
    try:
        from src.modules.ai.services.schema_index_service import build_schema_index_for_data_source

        result = await build_schema_index_for_data_source(db, data_source_id, schema)
        logger.debug("Schema index rebuilt after business-metadata change: %s", result)
    except Exception as idx_err:  # noqa: BLE001
        logger.warning("Schema index build after business-metadata change failed: %s", idx_err)
    # Cached SQL feedback was learned against the old descriptions.
    try:
        from src.modules.ai.utils.sql_feedback_store import invalidate_for_data_source

        invalidate_for_data_source(data_source_id)
    except Exception:  # noqa: BLE001
        pass


def merge_column_meaning(business_metadata: Dict[str, Any], meaning: Dict[str, Dict[str, Any]]) -> Dict[str, Any]:
    """business_metadata with each column's description, role and personal flag set from ``meaning``."""
    bm = dict(business_metadata or {})
    descriptions = dict(bm.get("column_descriptions") or {})
    roles = dict(bm.get("column_roles") or {})
    personal = set(bm.get("personal_columns") or [])
    for column, m in (meaning or {}).items():
        if not isinstance(m, dict):
            continue
        text = str(m.get("description") or "").strip()
        if text:
            descriptions[column] = text
        else:
            descriptions.pop(column, None)
        if m.get("role") in ROLES:
            roles[column] = m["role"]
        else:
            roles.pop(column, None)
        if m.get("personal"):
            personal.add(column)
        else:
            personal.discard(column)
    bm["column_descriptions"] = descriptions
    bm["column_roles"] = roles
    bm["personal_columns"] = sorted(personal)
    return bm


def fold_measures_and_dimensions(bm: Dict[str, Any], measures: Any, dimensions: Any) -> tuple:
    """Turn measure/dimension lists (older API, dbt/Cube style imports) into what each belongs to.

    A measure with a calculation becomes a draft metric for the semantic model (returned, for the
    caller to create); one without marks its column as an amount. A dimension marks its column as
    a category and keeps its description. Nothing is stored twice.
    """
    bm = dict(bm or {})
    roles = dict(bm.get("column_roles") or {})
    descriptions = dict(bm.get("column_descriptions") or {})
    metrics = []
    for m in measures or []:
        item = m if isinstance(m, dict) else {"name": str(m)}
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        if item.get("expression"):
            metrics.append({"name": name, "expression": str(item["expression"]), "description": item.get("description") or ""})
        else:
            roles.setdefault(name, "amount")
            if item.get("description"):
                descriptions.setdefault(name, str(item["description"]))
    for d in dimensions or []:
        item = d if isinstance(d, dict) else {"name": str(d)}
        name = str(item.get("name") or "").strip()
        if not name:
            continue
        roles.setdefault(name, "category")
        if item.get("description"):
            descriptions.setdefault(name, str(item["description"]))
    bm.pop("measures", None)
    bm.pop("dimensions", None)
    if roles:
        bm["column_roles"] = roles
    if descriptions:
        bm["column_descriptions"] = descriptions
    return bm, metrics


def _same_column(expression: str, column: str) -> bool:
    expr = (expression or "").replace('"', "").strip().lower()
    col = column.split(".")[-1].lower()
    return expr == col or expr.endswith("." + col)


async def sync_dimension_types(db, data_source_id: str, roles: Dict[str, str]) -> int:
    """A column marked date makes the dimensions built on it time dimensions, and category the
    reverse, so the semantic model and the column meaning never disagree."""
    from sqlalchemy import text

    wanted = {k: v for k, v in (roles or {}).items() if v in ("date", "category")}
    if not wanted:
        return 0
    try:
        rows = (await db.execute(text(
            "SELECT id, expression, dimension_type FROM semantic_dimensions WHERE data_source_id = :ds AND is_active"
        ), {"ds": str(data_source_id)})).all()
    except Exception:  # noqa: BLE001 - Community has no semantic model
        await db.rollback()
        return 0
    changed = 0
    for dim_id, expression, current in rows:
        role = next((r for col, r in wanted.items() if _same_column(expression, col)), None)
        target = "time" if role == "date" else "category" if role == "category" else None
        if target and target != current:
            await db.execute(text(
                "UPDATE semantic_dimensions SET dimension_type = :t, default_grain = COALESCE(default_grain, 'day'), "
                "updated_at = now() WHERE id = :id"
            ), {"t": target, "id": dim_id})
            changed += 1
    if changed:
        await db.commit()
    return changed


async def apply_column_meaning(db, data_source_id: str, meaning: Dict[str, Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """Write column meaning onto a connection; returns its new business metadata."""
    from src.modules.data.models import DataSource

    row = await db.get(DataSource, str(data_source_id))
    if row is None:
        return None
    schema = dict(row.schema) if isinstance(row.schema, dict) else {}
    schema["business_metadata"] = merge_column_meaning(schema.get("business_metadata") or {}, meaning)
    row.schema = schema
    flag_modified(row, "schema")
    await db.commit()
    await sync_dimension_types(db, str(data_source_id), schema["business_metadata"].get("column_roles") or {})
    await refresh_after_metadata_change(db, str(data_source_id), schema)
    return schema["business_metadata"]
