"""Data model relationship API — /data/data-sources/{id}/model/*"""

from __future__ import annotations

from typing import Optional
from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Body
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.data.model_service import DataModelService

router = APIRouter()


class RelationshipCreateRequest(BaseModel):
    from_table: str
    from_column: str
    to_table: str
    to_column: str
    join_type: str = Field(default="LEFT")


@router.get("/relationships")
async def list_relationships(
    data_source_id: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    svc = DataModelService(db)
    ds = await svc.get_data_source(data_source_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Data source not found")
    return {"relationships": await svc.list_relationships(data_source_id)}


@router.post("/relationships", status_code=201)
async def create_relationship(
    data_source_id: str,
    body: RelationshipCreateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    svc = DataModelService(db)
    ds = await svc.get_data_source(data_source_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Data source not found")
    rel = await svc.create_relationship(data_source_id, body.model_dump())
    return rel


@router.delete("/relationships/{relationship_id}", status_code=204)
async def delete_relationship(
    data_source_id: str,
    relationship_id: UUID,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    svc = DataModelService(db)
    ds = await svc.get_data_source(data_source_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Data source not found")
    deleted = await svc.delete_relationship(data_source_id, relationship_id)
    if not deleted:
        raise HTTPException(status_code=404, detail="Relationship not found")


@router.post("/auto-detect")
async def auto_detect_relationships(
    data_source_id: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    svc = DataModelService(db)
    ds = await svc.get_data_source(data_source_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Data source not found")
    relationships = await svc.auto_detect(data_source_id)
    return {"relationships": relationships, "count": len(relationships)}


# ── Calculated Fields ────────────────────────────────────────────────────────
# Stored in semantic_metrics with source='calculated'. CE-only, no plan gate.
# The expression is a raw SQL snippet (e.g. "revenue - cost") that editors
# insert verbatim; aggregation is up to the user's query.

class CalcFieldCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120, description="Alias used in queries")
    expression: str = Field(..., min_length=1, description="SQL expression, e.g. revenue - cost")
    description: str = Field(default="", max_length=512)
    category: str = Field(default="calculated")


@router.get("/calc-fields")
async def list_calc_fields(
    data_source_id: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    """List all calculated fields for this data source."""
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    from sqlalchemy import text as sa_text
    try:
        result = await db.execute(
            sa_text(
                "SELECT id, name, expression, description, category, certified, created_at "
                "FROM semantic_metrics "
                "WHERE data_source_id = :ds AND source = 'calculated' AND is_active = true "
                "ORDER BY name"
            ),
            {"ds": data_source_id},
        )
        rows = [dict(zip(result.keys(), r)) for r in result.fetchall()]
        return {"calc_fields": rows}
    except Exception as exc:
        # Table may not exist in CE without EE migration — return empty gracefully
        return {"calc_fields": [], "note": str(exc)}


@router.post("/calc-fields", status_code=201)
async def create_calc_field(
    data_source_id: str,
    body: CalcFieldCreateRequest,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    """Create a calculated field (stored in semantic_metrics with source=calculated)."""
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    import uuid as _uuid
    from sqlalchemy import text as sa_text

    # Strip common aggregation wrappers so users can write either "revenue - cost"
    # or "SUM(revenue) - SUM(cost)"; both are valid as expression snippets.
    name = body.name.strip()
    expression = body.expression.strip()
    if not name or not expression:
        raise HTTPException(status_code=422, detail="name and expression are required")

    field_id = str(_uuid.uuid5(_uuid.NAMESPACE_DNS, f"{data_source_id}:{name}"))
    try:
        await db.execute(
            sa_text(
                "INSERT INTO semantic_metrics "
                "(id, data_source_id, name, expression, description, category, source, certified, is_active) "
                "VALUES (:id, :ds, :name, :expr, :desc, :cat, 'calculated', false, true) "
                "ON CONFLICT (id) DO UPDATE SET expression=EXCLUDED.expression, description=EXCLUDED.description, "
                "category=EXCLUDED.category, updated_at=now()"
            ),
            {
                "id": field_id,
                "ds": data_source_id,
                "name": name,
                "expr": expression,
                "desc": body.description,
                "cat": body.category,
            },
        )
        await db.commit()
    except Exception as exc:
        await db.rollback()
        raise HTTPException(status_code=500, detail=f"Could not save calculated field: {exc}")
    return {"id": field_id, "name": name, "expression": expression, "data_source_id": data_source_id}


@router.delete("/calc-fields/{field_id}", status_code=204)
async def delete_calc_field(
    data_source_id: str,
    field_id: str,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    """Soft-delete a calculated field."""
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    from sqlalchemy import text as sa_text
    await db.execute(
        sa_text(
            "UPDATE semantic_metrics SET is_active = false, updated_at = now() "
            "WHERE id = :id AND data_source_id = :ds AND source = 'calculated'"
        ),
        {"id": field_id, "ds": data_source_id},
    )
    await db.commit()


@router.get("/context")
async def get_model_context(
    data_source_id: str,
    project_id: Optional[str] = None,
    db: AsyncSession = Depends(get_async_session),
    current_user: dict = Depends(JWTCookieBearer()),
):
    """Unified semantic context: relationships + metrics + dimensions."""
    if not current_user:
        raise HTTPException(status_code=401, detail="Authentication required")
    svc = DataModelService(db)
    ds = await svc.get_data_source(data_source_id)
    if not ds:
        raise HTTPException(status_code=404, detail="Data source not found")
    from src.modules.data.services.semantic_context_service import get_unified_semantic_context

    ctx = await get_unified_semantic_context(db, data_source_id, project_id)
    ctx["relationships"] = await svc.list_relationships(data_source_id)
    return ctx
