"""Drive-time and walking-time through the routing service (Valhalla, MIT licence, on
OpenStreetMap roads: © OpenStreetMap contributors, ODbL).

Only three calls are used: service status, isochrones (the area reachable within N minutes)
and time/distance matrices. Every call has a timeout and a size cap, and isochrones are cached
because the same stores are analysed again and again.
"""

from __future__ import annotations

import hashlib
import json
import logging
import os
from typing import Any, Dict, List, Optional, Sequence, Tuple

import httpx

logger = logging.getLogger(__name__)

COSTING = {"drive": "auto", "walk": "pedestrian", "bike": "bicycle"}
ATTRIBUTION = "Routing © OpenStreetMap contributors (ODbL), Valhalla"
MATRIX_MAX_LOCATIONS = int(os.getenv("ROUTING_MATRIX_MAX_LOCATIONS", "2500"))
# Valhalla's default limit on sources × targets in one matrix request.
MATRIX_MAX_PAIRS = int(os.getenv("ROUTING_MATRIX_MAX_PAIRS", "2500"))
_TIMEOUT = httpx.Timeout(float(os.getenv("ROUTING_TIMEOUT_SECONDS", "30")), connect=3.0)


class RoutingUnavailable(Exception):
    """No routing service, or it couldn't answer."""


def base_url() -> Optional[str]:
    url = (os.getenv("ROUTING_URL") or "").strip().rstrip("/")
    return url or None


async def status() -> Dict[str, Any]:
    url = base_url()
    if not url:
        return {"available": False, "reason": "not_configured"}
    try:
        async with httpx.AsyncClient(timeout=httpx.Timeout(3.0)) as client:
            r = await client.get(f"{url}/status")
        if r.status_code == 200:
            return {"available": True, "modes": list(COSTING)}
        return {"available": False, "reason": "starting"}
    except httpx.HTTPError:
        return {"available": False, "reason": "unreachable"}


async def _post(path: str, body: Dict[str, Any]) -> Dict[str, Any]:
    url = base_url()
    if not url:
        raise RoutingUnavailable("Drive-time needs the routing service, which isn't set up on this server.")
    try:
        async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
            r = await client.post(f"{url}{path}", json=body)
    except httpx.HTTPError as exc:
        raise RoutingUnavailable("The routing service didn't answer. Try again in a minute.") from exc
    if r.status_code >= 400:
        try:
            message = r.json().get("error") or r.text
        except ValueError:
            message = r.text
        # Valhalla says this when a point is far from any mapped road (or outside the region).
        if "No suitable edges" in str(message) or "no path" in str(message).lower():
            raise RoutingUnavailable("Some places are too far from a mapped road, or outside the map region.")
        raise RoutingUnavailable(f"The routing service refused the request: {str(message)[:160]}")
    return r.json()


def _cache():
    try:
        from src.core.cache import cache

        return cache.redis_client if cache else None
    except Exception:
        return None


async def isochrone(lat: float, lon: float, minutes: float, mode: str = "drive") -> Dict[str, Any]:
    """GeoJSON polygon of what's reachable from (lat, lon) within ``minutes``."""
    minutes = max(1.0, min(float(minutes), 120.0))
    key = "iso:" + hashlib.sha1(f"{round(lat, 5)}|{round(lon, 5)}|{minutes}|{mode}".encode()).hexdigest()
    rc = _cache()
    if rc is not None:
        try:
            hit = rc.get(key)
            if hit:
                return json.loads(hit)
        except Exception:
            pass
    body = {
        "locations": [{"lat": lat, "lon": lon}],
        "costing": COSTING.get(mode, "auto"),
        "contours": [{"time": minutes}],
        "polygons": True,
        "denoise": 0.3,
        "generalize": 60,
    }
    data = await _post("/isochrone", body)
    features = data.get("features") or []
    geometry = next((f.get("geometry") for f in features if f.get("geometry", {}).get("type") in ("Polygon", "MultiPolygon")), None)
    if not geometry:
        raise RoutingUnavailable("No reachable area was found around one of the places.")
    if rc is not None:
        try:
            rc.setex(key, 7 * 24 * 3600, json.dumps(geometry))
        except Exception:
            pass
    return geometry


async def matrix(
    sources: Sequence[Tuple[float, float]], targets: Sequence[Tuple[float, float]], mode: str = "drive"
) -> Tuple[List[List[Optional[float]]], List[List[Optional[float]]]]:
    """(minutes, km) from every source to every target; None where no route exists."""
    if len(sources) + len(targets) > MATRIX_MAX_LOCATIONS:
        raise RoutingUnavailable(f"Drive-time compares at most {MATRIX_MAX_LOCATIONS} places at once.")
    body = {
        "sources": [{"lat": a, "lon": b} for a, b in sources],
        "targets": [{"lat": a, "lon": b} for a, b in targets],
        "costing": COSTING.get(mode, "auto"),
        "units": "kilometers",
    }
    data = await _post("/sources_to_targets", body)
    minutes = [[None] * len(targets) for _ in sources]
    km = [[None] * len(targets) for _ in sources]
    for row in data.get("sources_to_targets") or []:
        for cell in row:
            i, j = cell.get("from_index"), cell.get("to_index")
            if i is None or j is None:
                continue
            if cell.get("time") is not None:
                minutes[i][j] = round(cell["time"] / 60.0, 2)
            if cell.get("distance") is not None:
                km[i][j] = round(cell["distance"], 3)
    return minutes, km
