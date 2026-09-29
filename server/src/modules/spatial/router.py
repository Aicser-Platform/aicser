"""Location analysis API (Community and Enterprise)."""

from __future__ import annotations

import asyncio
import os
from typing import Any, Union

from fastapi import APIRouter, Depends, HTTPException

from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.data.services import governed_sql
from src.modules.spatial import routing, service
from src.modules.spatial.schemas import AnalyzeRequest, SaveResultRequest

router = APIRouter()


@router.get("/capabilities")
async def capabilities(current_token: Union[str, dict] = Depends(JWTCookieBearer())) -> dict[str, Any]:
    """What this server can do: travel-time routing, and the size limits."""
    governed_sql.caller_from_token(current_token)
    return {
        "routing": await routing.status(),
        "limits": {
            "places": service.MAX_POINTS,
            "sites": service.MAX_SITES,
            "travel_places": service.MAX_DRIVE_POINTS,
            "travel_areas": service.MAX_DRIVE_AREAS,
        },
        "attribution": routing.ATTRIBUTION,
    }


@router.post("/analyze")
async def analyze(body: AnalyzeRequest, current_token: Union[str, dict] = Depends(JWTCookieBearer())) -> dict[str, Any]:
    caller = governed_sql.caller_from_token(current_token, body.project_id)
    timeout = float(os.getenv("SPATIAL_TIMEOUT_SECONDS", "120"))
    try:
        return await asyncio.wait_for(service.analyze(caller, body), timeout=timeout)
    except asyncio.TimeoutError as exc:
        raise HTTPException(status_code=504, detail="The analysis took too long. Try fewer places or a larger hexagon size.") from exc


@router.post("/results/{result_id}/save")
async def save_result(
    result_id: str, body: SaveResultRequest, current_token: Union[str, dict] = Depends(JWTCookieBearer())
) -> dict[str, Any]:
    """Keep a result as a dataset, for charts, dashboards and the AI."""
    from src.modules.data.services.dataset_writer import save_table_as_dataset

    caller = governed_sql.caller_from_token(current_token, body.project_id)
    if not result_id.isalnum() or len(result_id) > 64:
        raise HTTPException(status_code=404, detail="Result not found")
    table = await asyncio.to_thread(service.load_result, caller.user_id, result_id)
    if table is None:
        raise HTTPException(status_code=404, detail="This result has expired. Run the analysis again to save it.")
    return await save_table_as_dataset(current_token, body.name, table, project_id=body.project_id)
