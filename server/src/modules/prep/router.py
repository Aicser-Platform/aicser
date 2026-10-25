"""Prepare API: step catalog, governed preview and profiling, and versioned recipes."""

from __future__ import annotations

import uuid
from typing import Any, Dict, List, Optional, Union

from fastapi import APIRouter, Depends, Header, HTTPException, Query
from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.rbac.guard import require_permission
from src.modules.data.services.governed_sql import Caller, caller_from_token, load_source_for, resolve_organization
from src.modules.prep import service
from src.modules.prep.engine.compiler import compile_steps
from src.modules.prep.models import PrepRecipe, PrepRecipeVersion
from src.modules.prep.schemas import (
    DatePatternRequest,
    DetectRequest,
    FailuresRequest,
    FormulaRequest,
    PreviewRequest,
    ProfileRequest,
    PublishRequest,
    RecipeCreate,
    RecipeUpdate,
    SaveAsTableRequest,
)
from src.shared.middleware.rate_limiter import rate_limit

router = APIRouter()


def _uuid(value: Optional[str]) -> Optional[uuid.UUID]:
    if not value:
        return None
    try:
        return uuid.UUID(str(value))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail="Invalid id") from exc


def _check_steps(steps: List[Dict[str, Any]]) -> None:
    """Reject steps the engine can't compile, naming the step."""
    try:
        compile_steps(steps, source_sql="SELECT 1")
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


def _serialize(recipe: PrepRecipe, caller: Caller) -> Dict[str, Any]:
    return {
        "id": str(recipe.id),
        "name": recipe.name,
        "description": recipe.description,
        "data_source_id": recipe.data_source_id,
        "table": recipe.source_table,
        "steps": recipe.steps or [],
        "status": recipe.status,
        "version": recipe.version,
        "output": recipe.output or {},
        "column_meta": recipe.column_meta or {},
        "cleaning": recipe.cleaning or {},
        "project_id": str(recipe.project_id) if recipe.project_id else None,
        "is_owner": str(recipe.user_id) == caller.user_id,
        "created_at": recipe.created_at.isoformat() if recipe.created_at else None,
        "updated_at": recipe.updated_at.isoformat() if recipe.updated_at else None,
    }


async def _load(db: AsyncSession, recipe_id: str, caller: Caller, *, write: bool) -> PrepRecipe:
    recipe = await db.get(PrepRecipe, _uuid(recipe_id))
    if not recipe or recipe.is_deleted:
        raise HTTPException(status_code=404, detail="Recipe not found")
    if recipe.organization_id:
        await resolve_organization(caller, db, str(recipe.organization_id))
    same_org = (
        (recipe.organization_id and caller.organization_id and str(recipe.organization_id) == caller.organization_id)
        or (not recipe.organization_id and not caller.organization_id)
    )
    if not same_org:
        raise HTTPException(status_code=404, detail="Recipe not found")
    # Anyone who can query the source in the project can open the recipe; editing needs query:save.
    caller.project_id = str(recipe.project_id) if recipe.project_id else caller.project_id
    await load_source_for(caller, recipe.data_source_id)
    if write and str(recipe.user_id) != caller.user_id:
        await require_permission(caller.user_id, "query:save", organization_id=caller.organization_id, project_id=caller.project_id)
    return recipe


@router.get("/steps")
async def list_steps(current_token: Union[str, dict] = Depends(JWTCookieBearer())) -> Dict[str, Any]:
    caller_from_token(current_token)
    return {"steps": service.step_catalog()}


@router.post("/preview")
@rate_limit(requests_per_minute=120, bucket="prep_preview")
async def preview(req: PreviewRequest, project_id: Optional[str] = Query(default=None),
                  current_token: Union[str, dict] = Depends(JWTCookieBearer())) -> Dict[str, Any]:
    return await service.preview(caller_from_token(current_token, project_id), req)


@router.post("/profile")
@rate_limit(requests_per_minute=60, bucket="prep_preview")
async def profile(req: ProfileRequest, project_id: Optional[str] = Query(default=None),
                  current_token: Union[str, dict] = Depends(JWTCookieBearer())) -> Dict[str, Any]:
    return await service.profile(caller_from_token(current_token, project_id), req)


@router.post("/detect")
@rate_limit(requests_per_minute=60, bucket="prep_preview")
async def detect(req: DetectRequest, project_id: Optional[str] = Query(default=None),
                 current_token: Union[str, dict] = Depends(JWTCookieBearer())) -> Dict[str, Any]:
    return await service.detect(caller_from_token(current_token, project_id), req)


@router.post("/failures")
@rate_limit(requests_per_minute=60, bucket="prep_preview")
async def failures(req: FailuresRequest, project_id: Optional[str] = Query(default=None),
                   current_token: Union[str, dict] = Depends(JWTCookieBearer())) -> Dict[str, Any]:
    return await service.failures(caller_from_token(current_token, project_id), req)


@router.post("/formula")
async def check_formula(req: FormulaRequest, current_token: Union[str, dict] = Depends(JWTCookieBearer())) -> Dict[str, Any]:
    """Translate and check a formula; the column list catches misspelled names early."""
    from src.shared.formula import FUNCTION_NAMES, FormulaError, translate

    caller_from_token(current_token)
    try:
        result = translate(req.expression, language=req.language, columns=req.columns or None)
    except FormulaError as exc:
        return {"ok": False, "error": str(exc), "functions": FUNCTION_NAMES}
    return {"ok": True, "sql": result.sql, "columns_used": result.columns_used, "functions": FUNCTION_NAMES}


@router.post("/date-pattern")
async def date_pattern(req: DatePatternRequest, current_token: Union[str, dict] = Depends(JWTCookieBearer())) -> Dict[str, Any]:
    from src.modules.prep.detect import formats_for_example

    caller_from_token(current_token)
    return {"formats": formats_for_example(req.example)}


@router.get("/recipes")
async def list_recipes(
    project_id: Optional[str] = Query(default=None),
    data_source_id: Optional[str] = Query(default=None),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    x_org: Optional[str] = Header(default=None, alias="X-Organization-Id"),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    caller = await resolve_organization(caller_from_token(current_token, project_id), db, x_org)
    await require_permission(caller.user_id, "query:execute", organization_id=caller.organization_id, project_id=caller.project_id)
    query = select(PrepRecipe).where(PrepRecipe.is_deleted.is_not(True))
    org = _uuid(caller.organization_id)
    query = query.where(PrepRecipe.organization_id == org) if org else query.where(PrepRecipe.organization_id.is_(None))
    if caller.project_id:
        query = query.where(PrepRecipe.project_id == _uuid(caller.project_id))
    else:
        query = query.where(PrepRecipe.user_id == _uuid(caller.user_id))
    if data_source_id:
        query = query.where(PrepRecipe.data_source_id == data_source_id)
    rows = (await db.execute(query.order_by(PrepRecipe.updated_at.desc()).limit(500))).scalars().all()
    return {"recipes": [_serialize(r, caller) for r in rows]}


@router.post("/recipes", status_code=201)
async def create_recipe(req: RecipeCreate, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                        db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    caller = caller_from_token(current_token, req.project_id)
    source = await load_source_for(caller, req.data_source_id)
    await require_permission(caller.user_id, "query:save", organization_id=caller.organization_id, project_id=caller.project_id)
    _check_steps(req.steps)
    recipe = PrepRecipe(
        name=req.name.strip(),
        description=req.description,
        user_id=_uuid(caller.user_id),
        # The token may not carry the organization; the project (or the connection) always does.
        organization_id=_uuid(caller.organization_id or await service.organization_of(db, caller.project_id, source)),
        project_id=_uuid(caller.project_id),
        data_source_id=req.data_source_id,
        source_table=service.resolve_table(source, req.table),
        steps=req.steps,
        output={"mode": "view"},
    )
    db.add(recipe)
    await db.commit()
    await db.refresh(recipe)
    return _serialize(recipe, caller)


@router.get("/recipes/{recipe_id}")
async def get_recipe(recipe_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                     db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    return _serialize(await _load(db, recipe_id, caller, write=False), caller)


@router.patch("/recipes/{recipe_id}")
async def update_recipe(recipe_id: str, req: RecipeUpdate, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                        db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    recipe = await _load(db, recipe_id, caller, write=True)
    if req.name is not None:
        recipe.name = req.name.strip()
    if req.description is not None:
        recipe.description = req.description
    if req.table is not None:
        recipe.source_table = req.table
    if req.steps is not None:
        _check_steps(req.steps)
        recipe.steps = req.steps
    if req.column_meta is not None:
        recipe.column_meta = {k: v.model_dump() for k, v in req.column_meta.items()}
    if req.cleaning is not None:
        recipe.cleaning = req.cleaning.model_dump()
    # Any change after publishing is a draft until published again.
    if recipe.status == "published" and (req.steps is not None or req.table is not None):
        recipe.status = "draft"
    await db.commit()
    await db.refresh(recipe)
    out_id = (recipe.output or {}).get("data_source_id")
    if req.column_meta is not None and out_id:
        # The table this recipe produced gets the same meaning, where Ask and the model read it.
        from src.modules.data.services.business_metadata import apply_column_meaning

        await apply_column_meaning(db, out_id, recipe.column_meta)
    return _serialize(recipe, caller)


@router.delete("/recipes/{recipe_id}", status_code=204)
async def delete_recipe(recipe_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                        db: AsyncSession = Depends(get_async_session)) -> None:
    caller = caller_from_token(current_token)
    recipe = await _load(db, recipe_id, caller, write=True)
    recipe.is_deleted = True
    await db.commit()


@router.get("/recipes/{recipe_id}/impact")
async def recipe_impact(recipe_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                        db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    """Before publishing: which columns the draft drops or retypes, and what uses them."""
    caller = caller_from_token(current_token)
    recipe = await _load(db, recipe_id, caller, write=False)
    latest = (await db.execute(
        select(PrepRecipeVersion).where(PrepRecipeVersion.recipe_id == recipe.id)
        .order_by(PrepRecipeVersion.version.desc()).limit(1)
    )).scalar_one_or_none()
    return await service.impact(caller, recipe, list(latest.steps) if latest else None, db)


@router.post("/recipes/{recipe_id}/publish")
async def publish_recipe(recipe_id: str, req: PublishRequest, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                         db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    recipe = await _load(db, recipe_id, caller, write=True)
    _check_steps(list(recipe.steps or []))
    latest = (await db.execute(
        select(PrepRecipeVersion).where(PrepRecipeVersion.recipe_id == recipe.id)
        .order_by(PrepRecipeVersion.version.desc()).limit(1)
    )).scalar_one_or_none()
    if latest is not None:
        report = await service.impact(caller, recipe, list(latest.steps), db)
        blocking = [c for c in report.get("contracts") or [] if c.get("on_breach") == "block"]
        if blocking:
            names = ", ".join(sorted({b["column"] for c in blocking for b in c["breaches"]}))
            raise HTTPException(status_code=409, detail=(
                f"This change breaks the data contract on {blocking[0]['table'] or 'this table'} ({names}). "
                "Keep those columns, or ask the table's owner to update the contract."
            ))
    recipe.version = (recipe.version or 0) + 1
    recipe.status = "published"
    db.add(PrepRecipeVersion(recipe_id=recipe.id, version=recipe.version, steps=list(recipe.steps or []),
                             source_table=recipe.source_table, note=req.note, author_id=_uuid(caller.user_id)))
    await db.commit()
    await db.refresh(recipe)
    return _serialize(recipe, caller)


@router.get("/recipes/{recipe_id}/versions")
async def list_versions(recipe_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                        db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    recipe = await _load(db, recipe_id, caller, write=False)
    rows = (await db.execute(
        select(PrepRecipeVersion).where(PrepRecipeVersion.recipe_id == recipe.id).order_by(PrepRecipeVersion.version.desc())
    )).scalars().all()
    return {"versions": [
        {"version": v.version, "note": v.note, "steps": v.steps, "table": v.source_table,
         "author_id": str(v.author_id), "created_at": v.created_at.isoformat() if v.created_at else None}
        for v in rows
    ]}


@router.post("/recipes/{recipe_id}/versions/{version}/restore")
async def restore_version(recipe_id: str, version: int, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                          db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    recipe = await _load(db, recipe_id, caller, write=True)
    snapshot = (await db.execute(select(PrepRecipeVersion).where(
        and_(PrepRecipeVersion.recipe_id == recipe.id, PrepRecipeVersion.version == version)
    ))).scalar_one_or_none()
    if not snapshot:
        raise HTTPException(status_code=404, detail="Version not found")
    recipe.steps = list(snapshot.steps or [])
    recipe.source_table = snapshot.source_table or recipe.source_table
    recipe.status = "draft"
    await db.commit()
    await db.refresh(recipe)
    return _serialize(recipe, caller)


@router.post("/recipes/{recipe_id}/save-as-table")
@rate_limit(requests_per_minute=10, bucket="prep_save")
async def save_as_table(recipe_id: str, req: SaveAsTableRequest, current_token: Union[str, dict] = Depends(JWTCookieBearer()),
                        db: AsyncSession = Depends(get_async_session)) -> Dict[str, Any]:
    caller = caller_from_token(current_token)
    recipe = await _load(db, recipe_id, caller, write=True)
    await require_permission(caller.user_id, "data:upload", organization_id=caller.organization_id, project_id=caller.project_id)
    result = await service.save_as_table(caller, recipe, (req.name or f"{recipe.name} (prepared)").strip())
    from datetime import datetime, timezone

    recipe.output = {"mode": "table", **result, "ran_at": datetime.now(timezone.utc).isoformat(),
                     "recipe_version": recipe.version}
    await db.commit()
    if recipe.column_meta and result.get("data_source_id"):
        from src.modules.data.services.business_metadata import apply_column_meaning

        await apply_column_meaning(db, result["data_source_id"], recipe.column_meta)
    return result
