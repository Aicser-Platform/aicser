"""Core dimensions: defined once in the organization's Core model, used by every domain.

A dimension is a SQL expression over its connection's tables, so a domain can use a core dimension
when both run on the same engine: the same connection, or two lakehouse warehouses (every warehouse
of an organization serves the same Gold tables). A separate database that is queried live can't
join to it; landing that connection in the lakehouse makes the dimension available.
"""

from __future__ import annotations

from typing import Any, Dict, List, Optional, Set

from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError


async def _lakehouse_sources(db, ids: List[str]) -> Set[str]:
    if not ids:
        return set()
    try:
        rows = (await db.execute(text("SELECT data_source_id FROM warehouses WHERE data_source_id = ANY(:ids)"),
                                 {"ids": ids})).all()
    except ProgrammingError:  # Community: no lakehouse warehouses
        await db.rollback()
        return set()
    return {str(r[0]) for r in rows if r[0]}


def availability(consumer: str, owner: str, lakehouse: Set[str]) -> str:
    """'same_connection', 'lakehouse', or 'needs_lakehouse' (land the consumer to use it)."""
    if consumer == owner:
        return "same_connection"
    if consumer in lakehouse and owner in lakehouse:
        return "lakehouse"
    return "needs_lakehouse"


async def core_dimensions(db, organization_id: Optional[str], data_source_id: str) -> List[Dict[str, Any]]:
    """The Core model's dimensions as seen from one connection, each with whether it can be used there."""
    if not organization_id:
        return []
    try:
        rows = (await db.execute(text("""
            SELECT d.id, d.name, d.expression, d.description, d.data_source_id, d.hierarchy
            FROM semantic_domains c
            JOIN semantic_domain_sources s ON s.domain_id = c.id
            JOIN semantic_dimensions d ON d.data_source_id = s.data_source_id AND d.is_active IS NOT FALSE
            WHERE c.organization_id = CAST(:org AS uuid) AND c.is_core IS TRUE
            ORDER BY d.name
        """), {"org": organization_id})).all()
    except ProgrammingError:
        await db.rollback()
        return []
    owners = sorted({str(r[4]) for r in rows})
    lakehouse = await _lakehouse_sources(db, owners + [str(data_source_id)])
    out = []
    for dim_id, name, expression, description, owner, hierarchy in rows:
        out.append({
            "id": str(dim_id),
            "name": name,
            "expression": expression,
            "description": description,
            "data_source_id": str(owner),
            "hierarchy": hierarchy,
            "availability": availability(str(data_source_id), str(owner), lakehouse),
        })
    return out


DEFAULT_CALENDAR = {"fiscal_year_start_month": 1, "week_start": "monday"}


def clean_calendar(raw: Any) -> Dict[str, Any]:
    cal = dict(DEFAULT_CALENDAR)
    if isinstance(raw, dict):
        month = raw.get("fiscal_year_start_month")
        if isinstance(month, int) and 1 <= month <= 12:
            cal["fiscal_year_start_month"] = month
        if raw.get("week_start") in ("monday", "sunday"):
            cal["week_start"] = raw["week_start"]
    return cal


async def org_calendar(db, data_source_id: Optional[str] = None, organization_id: Optional[str] = None) -> Dict[str, Any]:
    """The calendar time dimensions use: the Core domain's, for the connection's organization."""
    try:
        if not organization_id and data_source_id:
            organization_id = (await db.execute(
                text("SELECT organization_id FROM data_sources WHERE id = :id"), {"id": str(data_source_id)}
            )).scalar()
        if not organization_id:
            return dict(DEFAULT_CALENDAR)
        raw = (await db.execute(
            text("SELECT calendar FROM semantic_domains WHERE organization_id = :org AND is_core = true LIMIT 1"),
            {"org": str(organization_id)},
        )).scalar()
        return clean_calendar(raw)
    except ProgrammingError:
        await db.rollback()
        return dict(DEFAULT_CALENDAR)
