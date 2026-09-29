"""Map boundaries for map widgets (see services/geo_boundaries.py)."""

from typing import Any, Dict

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import Response

from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.charts.services import geo_boundaries as geo

geo_router = APIRouter()

# Boundaries are public open data (Natural Earth, geoBoundaries), so embedded and exported
# dashboards — which have no signed-in viewer — can draw maps too. Countries and levels are
# validated and sources allowlisted (services/geo_boundaries.py). Browsers may keep them a day.
_CACHE = {"Cache-Control": "private, max-age=86400"}


def _json(body: bytes) -> Response:
    return Response(content=body, media_type="application/json", headers=_CACHE)


async def _serve(loader) -> Response:
    try:
        return _json(await loader())
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except geo.GeoUnavailable as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    except Exception as exc:  # network trouble reaching the boundary source
        raise HTTPException(status_code=503, detail="Map boundaries are unavailable right now. Try again later.") from exc


@geo_router.get("/world")
async def world_countries(_user: Dict[str, Any] = Depends(JWTCookieBearer(auto_error=False))):
    return await _serve(geo.world)


@geo_router.get("/countries/{iso3}/levels")
async def country_levels(iso3: str, _user: Dict[str, Any] = Depends(JWTCookieBearer(auto_error=False))):
    return await _serve(lambda: geo.levels(iso3))


@geo_router.get("/countries/{iso3}/{level}")
async def country_areas(iso3: str, level: str, _user: Dict[str, Any] = Depends(JWTCookieBearer(auto_error=False))):
    return await _serve(lambda: geo.admin(iso3, level))
