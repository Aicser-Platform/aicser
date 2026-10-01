"""Location analysis requests: read the places (with the person's row security), run the
analysis, and shape an answer for the map, the table and "Save as dataset".

Size limits keep a request inside a few seconds of CPU; drive-time asks the routing service
only for short lists (each place's three closest sites, or one area per site).
"""

from __future__ import annotations

import asyncio
import base64
import io
import json
import logging
import os
import uuid
from typing import Any, Dict, List, Optional, Tuple

import numpy as np
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import HTTPException

from src.modules.data.services import governed_sql
from src.modules.spatial import engine, routing
from src.modules.spatial.schemas import AnalyzeRequest, PointSet

logger = logging.getLogger(__name__)

MAX_POINTS = int(os.getenv("SPATIAL_MAX_POINTS", "200000"))
MAX_SITES = int(os.getenv("SPATIAL_MAX_SITES", "5000"))
MAX_DRIVE_POINTS = int(os.getenv("SPATIAL_MAX_DRIVE_POINTS", "5000"))
MAX_DRIVE_AREAS = int(os.getenv("SPATIAL_MAX_DRIVE_AREAS", "100"))
MAP_POINT_LIMIT = 20000
TABLE_ROW_LIMIT = 2000
RESULT_TTL_SECONDS = 3600
_slots = asyncio.Semaphore(int(os.getenv("SPATIAL_CONCURRENCY", "4")))


async def _read(caller: governed_sql.Caller, spec: PointSet, limit: int, what: str) -> engine.Points:
    cols = [spec.lat, spec.lon] + [c for c in (spec.label, spec.measure) if c]
    result = await governed_sql.read_columns(
        caller, spec.data_source_id, spec.table, cols, limit=limit + 1, where_not_null=[spec.lat, spec.lon]
    )
    records = governed_sql.rows_as_records(result)
    if len(records) > limit:
        raise HTTPException(
            status_code=400,
            detail=f"The {what} have more than {limit:,} rows with a position. Filter the table or save a smaller one first.",
        )
    pts = engine.clean_points(
        [r.get(spec.lat) for r in records],
        [r.get(spec.lon) for r in records],
        [r.get(spec.label) if spec.label else None for r in records],
        [r.get(spec.measure) for r in records] if spec.measure else None,
    )
    if len(pts) == 0:
        raise HTTPException(status_code=400, detail=f"None of the {what} have a usable latitude and longitude.")
    return pts


def _feature(lat: float, lon: float, props: Dict[str, Any]) -> Dict[str, Any]:
    return {"type": "Feature", "geometry": {"type": "Point", "coordinates": [round(float(lon), 6), round(float(lat), 6)]}, "properties": props}


def _sample(n: int, limit: int) -> np.ndarray:
    return np.arange(n) if n <= limit else np.linspace(0, n - 1, limit).astype(int)


def _round(value: Any, digits: int = 2) -> Any:
    return None if value is None or (isinstance(value, float) and not np.isfinite(value)) else round(float(value), digits)


async def analyze(caller: governed_sql.Caller, req: AnalyzeRequest) -> Dict[str, Any]:
    needs_sites = req.analysis in ("nearest", "coverage")
    if needs_sites and not req.sites:
        raise HTTPException(status_code=400, detail="Choose the places to measure from (for example your stores).")
    if req.analysis == "coverage" and req.travel == "straight" and not req.radius_km:
        raise HTTPException(status_code=400, detail="Choose a distance in km.")
    if req.analysis == "coverage" and req.travel != "straight" and not req.minutes:
        raise HTTPException(status_code=400, detail="Choose a travel time in minutes.")

    async with _slots:
        points = await _read(caller, req.points, MAX_POINTS, "places")
        sites = await _read(caller, req.sites, MAX_SITES, "sites") if needs_sites and req.sites else None
        handler = {
            "nearest": _nearest, "coverage": _coverage, "density": _density,
            "hotspots": _hotspots, "regions": _regions,
        }[req.analysis]
        result = await handler(req, points, sites)

    notes = list(result.pop("notes", []))
    dropped = points.dropped + (sites.dropped if sites else 0)
    if dropped:
        notes.append({"key": "dropped_rows", "count": dropped})
    table: pa.Table = result.pop("table")
    result_id = uuid.uuid4().hex
    await asyncio.to_thread(_store, caller.user_id, result_id, table)
    result.update({
        "result_id": result_id,
        "analysis": req.analysis,
        "travel": req.travel,
        "columns": table.column_names,
        "rows": table.slice(0, TABLE_ROW_LIMIT).to_pylist(),
        "row_count": table.num_rows,
        "notes": notes,
        "attribution": routing.ATTRIBUTION if req.travel != "straight" else None,
    })
    return result


# ---------------------------------------------------------------- analyses


async def _nearest(req: AnalyzeRequest, points: engine.Points, sites: engine.Points) -> Dict[str, Any]:
    idx, km = await asyncio.to_thread(engine.nearest, points, sites, 3 if req.travel != "straight" else 1)
    best = idx[:, 0].copy()
    best_km = km[:, 0].copy()
    drive_min = drive_km = None
    if req.travel != "straight":
        if len(points) > MAX_DRIVE_POINTS:
            raise HTTPException(
                status_code=400,
                detail=f"Travel time is measured for up to {MAX_DRIVE_POINTS:,} places at a time; use straight-line distance or a smaller table.",
            )
        drive_min = np.full(len(points), np.nan)
        drive_km = np.full(len(points), np.nan)
        # Measured on the routing engine: many places to a few sites is fast (~12 ms a place),
        # few-to-many is not. So group places by their three straight-line-closest sites and
        # ask one many-to-few matrix per group (split to the engine's pair limit), four at once.
        # A site much farther in a straight line than the closest one practically never wins by
        # road (roads run ~1.2-1.4x straight distance), and hopeless long searches are the
        # slowest part of a matrix, so only close contenders are compared.
        groups: Dict[Tuple[int, ...], List[int]] = {}
        for i in range(len(points)):
            reach = km[i, 0] * 1.6 + 2.0
            cand = tuple(sorted(int(j) for j, d in zip(idx[i], km[i]) if d <= reach))
            groups.setdefault(cand, []).append(i)
        batches = []
        for cand, members in groups.items():
            size = max(1, routing.MATRIX_MAX_PAIRS // len(cand))
            for k in range(0, len(members), size):
                batches.append((list(cand), members[k:k + size]))
        gate = asyncio.Semaphore(4)

        async def run(batch):
            cand, members = batch
            async with gate:
                return batch, await routing.matrix(
                    [(points.lat[i], points.lon[i]) for i in members],
                    [(sites.lat[j], sites.lon[j]) for j in cand], req.travel,
                )

        try:
            answers = await asyncio.gather(*[run(b) for b in batches])
        except routing.RoutingUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        for (cand, members), (minutes, dist) in answers:
            for r, i in enumerate(members):
                options = [(minutes[r][c], dist[r][c], j) for c, j in enumerate(cand) if minutes[r][c] is not None]
                if options:
                    m, d, j = min(options)
                    drive_min[i], drive_km[i], best[i] = m, d, j
                    best_km[i] = engine.haversine_km(points.lat[i], points.lon[i], sites.lat[j], sites.lon[j])
    cols: Dict[str, Any] = {
        "place": points.label,
        "latitude": points.lat,
        "longitude": points.lon,
        "nearest_site": [sites.label[j] for j in best],
        "distance_km": np.round(best_km, 3),
    }
    if drive_min is not None:
        cols["travel_minutes"] = np.round(drive_min, 1)
        cols["travel_km"] = np.round(drive_km, 2)
    if points.measure is not None:
        cols["value"] = points.measure
    table = pa.table(cols)

    metric = drive_min if drive_min is not None else best_km
    finite = metric[np.isfinite(metric)]
    thresholds = [5, 10, 15, 30] if drive_min is not None else [1, 5, 10, 25]
    per_site = []
    for j in range(len(sites)):
        mask = best == j
        per_site.append({
            "site": sites.label[j], "places": int(mask.sum()),
            "total": _round(points.measure[mask].sum()) if points.measure is not None else None,
            "average": _round(float(metric[mask][np.isfinite(metric[mask])].mean()) if mask.any() and np.isfinite(metric[mask]).any() else None),
        })
    per_site.sort(key=lambda s: -s["places"])
    sample = _sample(len(points), MAP_POINT_LIMIT)
    return {
        "summary": {
            "places": len(points), "sites": len(sites),
            "unit": "minutes" if drive_min is not None else "km",
            "median": _round(float(np.median(finite))) if finite.size else None,
            "average": _round(float(finite.mean())) if finite.size else None,
            "p90": _round(float(np.percentile(finite, 90))) if finite.size else None,
            "within": [{"limit": t, "share": _round(float((finite <= t).mean()), 4) if finite.size else 0} for t in thresholds],
            "unreachable": int((~np.isfinite(metric)).sum()),
        },
        "groups": per_site,
        "map": {
            "points": {"type": "FeatureCollection", "features": [
                _feature(points.lat[i], points.lon[i], {"label": points.label[i], "group": int(best[i]),
                                                       "value": _round(metric[i])}) for i in sample]},
            "sites": _sites_fc(sites),
            "areas": None,
        },
        "table": table,
    }


def _sites_fc(sites: engine.Points) -> Dict[str, Any]:
    return {"type": "FeatureCollection", "features": [
        _feature(sites.lat[j], sites.lon[j], {"label": sites.label[j], "group": j}) for j in range(len(sites))]}


async def _coverage(req: AnalyzeRequest, points: engine.Points, sites: engine.Points) -> Dict[str, Any]:
    areas: List[Dict[str, Any]] = []
    if req.travel == "straight":
        hits = await asyncio.to_thread(engine.within_radius, points, sites, req.radius_km)
        areas = [engine.circle(sites.lat[j], sites.lon[j], req.radius_km) for j in range(len(sites))]
    else:
        if len(sites) > MAX_DRIVE_AREAS:
            raise HTTPException(
                status_code=400,
                detail=f"Travel-time areas are drawn for up to {MAX_DRIVE_AREAS} sites at a time.",
            )
        try:
            areas = list(await asyncio.gather(*[
                routing.isochrone(sites.lat[j], sites.lon[j], req.minutes, req.travel) for j in range(len(sites))
            ]))
        except routing.RoutingUnavailable as exc:
            raise HTTPException(status_code=503, detail=str(exc)) from exc
        hits = await asyncio.to_thread(engine.area_members, points, areas)
    covered = np.zeros(len(points), dtype=bool)
    rows = []
    for j, h in enumerate(hits):
        covered[h] = True
        rows.append({
            "site": sites.label[j], "places_within": int(len(h)),
            "share_of_places": _round(len(h) / len(points), 4),
            "total_within": _round(points.measure[h].sum()) if points.measure is not None else None,
        })
    table = pa.table({
        "place": points.label, "latitude": points.lat, "longitude": points.lon, "covered": covered,
        **({"value": points.measure} if points.measure is not None else {}),
    })
    sample = _sample(len(points), MAP_POINT_LIMIT)
    return {
        "summary": {
            "places": len(points), "sites": len(sites),
            "covered_share": _round(float(covered.mean()), 4),
            "uncovered": int((~covered).sum()),
            "covered_total": _round(points.measure[covered].sum()) if points.measure is not None else None,
            "limit": req.radius_km if req.travel == "straight" else req.minutes,
            "unit": "km" if req.travel == "straight" else "minutes",
        },
        "groups": sorted(rows, key=lambda r: -r["places_within"]),
        "map": {
            "points": {"type": "FeatureCollection", "features": [
                _feature(points.lat[i], points.lon[i], {"label": points.label[i], "covered": bool(covered[i])}) for i in sample]},
            "sites": _sites_fc(sites),
            "areas": {"type": "FeatureCollection", "features": [
                {"type": "Feature", "geometry": a, "properties": {"label": sites.label[j], "group": j, "value": rows[j]["places_within"]}}
                for j, a in enumerate(areas)]},
        },
        "table": table,
    }


async def _density(req: AnalyzeRequest, points: engine.Points, sites) -> Dict[str, Any]:
    res = req.resolution or await asyncio.to_thread(engine.auto_resolution, points)
    cells = await asyncio.to_thread(engine.hexbin, points, res)
    table = pa.table({
        "hexagon": [c["cell"] for c in cells],
        "places": [c["count"] for c in cells],
        **({"total": [c["total"] for c in cells]} if points.measure is not None else {}),
    })
    top = cells[: max(1, len(cells) // 10)]
    return {
        "summary": {
            "places": len(points), "hexagons": len(cells), "resolution": res,
            "hexagon_km": engine.H3_EDGE_KM.get(res),
            "top_tenth_share": _round(sum(c["count"] for c in top) / len(points), 4),
        },
        "groups": [{"hexagon": c["cell"], "places": c["count"], "total": _round(c["total"]) if points.measure is not None else None} for c in cells[:50]],
        "map": {
            "points": None, "sites": None,
            "areas": {"type": "FeatureCollection", "features": [
                {"type": "Feature", "geometry": c["geometry"],
                 "properties": {"label": c["cell"], "value": c["total"] if points.measure is not None else c["count"], "places": c["count"]}}
                for c in cells]},
        },
        "table": table,
    }


async def _hotspots(req: AnalyzeRequest, points: engine.Points, sites) -> Dict[str, Any]:
    radius = req.radius_km or 1.0
    labels = await asyncio.to_thread(engine.hotspots, points, radius, req.min_points)
    groups = []
    for c in sorted(set(labels.tolist()) - {-1}):
        m = labels == c
        clat, clon = float(points.lat[m].mean()), float(points.lon[m].mean())
        spread = engine.haversine_km(clat, clon, points.lat[m], points.lon[m])
        groups.append({
            "hotspot": c + 1, "places": int(m.sum()),
            "total": _round(points.measure[m].sum()) if points.measure is not None else None,
            "center_latitude": round(clat, 6), "center_longitude": round(clon, 6),
            "radius_km": _round(float(np.percentile(spread, 90))),
        })
    groups.sort(key=lambda g: -g["places"])
    rank = {g["hotspot"]: i + 1 for i, g in enumerate(groups)}
    hotspot = [rank.get(int(c) + 1) if c >= 0 else None for c in labels]
    table = pa.table({
        "place": points.label, "latitude": points.lat, "longitude": points.lon,
        "hotspot": pa.array(hotspot, type=pa.int32()),
        **({"value": points.measure} if points.measure is not None else {}),
    })
    for g in groups:
        g["hotspot"] = rank[g["hotspot"]]
    sample = _sample(len(points), MAP_POINT_LIMIT)
    return {
        "summary": {
            "places": len(points), "hotspots": len(groups),
            "in_hotspots_share": _round(float((labels >= 0).mean()), 4),
            "radius_km": radius, "min_points": req.min_points,
        },
        "groups": groups,
        "map": {
            "points": {"type": "FeatureCollection", "features": [
                _feature(points.lat[i], points.lon[i], {"label": points.label[i], "group": hotspot[i]}) for i in sample]},
            "sites": None,
            "areas": {"type": "FeatureCollection", "features": [
                {"type": "Feature", "geometry": engine.circle(g["center_latitude"], g["center_longitude"], max(g["radius_km"] or radius, 0.05)),
                 "properties": {"label": f"#{g['hotspot']}", "group": g["hotspot"], "value": g["places"]}} for g in groups]},
        },
        "table": table,
    }


async def _detect_country(points: engine.Points) -> str:
    """The country most of the places are in (from a sample of up to 2,000)."""
    from collections import Counter

    from src.modules.charts.services import geo_boundaries as geo

    try:
        world = json.loads(await geo.world())
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Country boundaries are unavailable right now. Choose the country.") from exc
    pick = _sample(len(points), 2000)
    sample = engine.Points(lat=points.lat[pick], lon=points.lon[pick], label=[""] * len(pick), measure=None)
    names = await asyncio.to_thread(
        engine.points_in_areas, sample,
        [(f["properties"]["iso3"], f["geometry"]) for f in world.get("features", []) if f.get("geometry")],
    )
    found = Counter(n for n in names if n)
    if not found:
        raise HTTPException(status_code=400, detail="The places don't fall inside any country. Check the latitude and longitude columns.")
    return found.most_common(1)[0][0]


async def _regions(req: AnalyzeRequest, points: engine.Points, sites) -> Dict[str, Any]:
    from src.modules.charts.services import geo_boundaries as geo

    if not req.country:
        req.country = await _detect_country(points)
    try:
        iso3 = geo.validate_country(req.country or "")
        level = geo.validate_level(req.level or "ADM1")
        fc = json.loads(await geo.admin(iso3, level))
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc
    except Exception as exc:
        raise HTTPException(status_code=503, detail="Area boundaries are unavailable right now. Try again later.") from exc
    features = [f for f in fc.get("features", []) if f.get("geometry")]
    names = await asyncio.to_thread(engine.points_in_areas, points, [(f["properties"]["name"], f["geometry"]) for f in features])
    counts: Dict[str, List[int]] = {}
    for i, n in enumerate(names):
        if n is not None:
            counts.setdefault(n, []).append(i)
    groups = []
    for n, members in counts.items():
        ix = np.array(members)
        groups.append({"area": n, "places": len(members),
                       "total": _round(points.measure[ix].sum()) if points.measure is not None else None})
    groups.sort(key=lambda g: -g["places"])
    by_name = {g["area"]: g for g in groups}
    table = pa.table({
        "place": points.label, "latitude": points.lat, "longitude": points.lon, "area": names,
        **({"value": points.measure} if points.measure is not None else {}),
    })
    return {
        "summary": {
            "places": len(points), "areas_with_places": len(groups), "areas": len(features),
            "outside": sum(1 for n in names if n is None), "country": iso3, "level": level,
        },
        "groups": groups,
        "map": {
            "points": None, "sites": None,
            "areas": {"type": "FeatureCollection", "features": [
                {"type": "Feature", "geometry": f["geometry"], "properties": {
                    "label": f["properties"]["name"],
                    "value": (by_name.get(f["properties"]["name"]) or {}).get("total" if points.measure is not None else "places") or 0,
                    "places": (by_name.get(f["properties"]["name"]) or {}).get("places", 0)}}
                for f in features]},
        },
        "boundary_license": fc.get("license"),
        "table": table,
    }


# ---------------------------------------------------------------- keeping results for "Save"


def _redis():
    try:
        from src.core.cache import cache

        return cache.redis_client if cache else None
    except Exception:
        return None


_local_results: Dict[str, Tuple[float, bytes]] = {}


def _store(user_id: str, result_id: str, table: pa.Table) -> None:
    buf = io.BytesIO()
    pq.write_table(table, buf, compression="zstd")
    data = buf.getvalue()
    key = f"spatial_result:{user_id}:{result_id}"
    rc = _redis()
    if rc is not None and len(data) < 20 * 1024 * 1024:
        try:
            rc.setex(key, RESULT_TTL_SECONDS, base64.b64encode(data).decode())
            return
        except Exception:
            pass
    import time

    now = time.time()
    for k, (t, _) in list(_local_results.items()):
        if now - t > RESULT_TTL_SECONDS:
            _local_results.pop(k, None)
    _local_results[key] = (now, data)


def load_result(user_id: str, result_id: str) -> Optional[pa.Table]:
    key = f"spatial_result:{user_id}:{result_id}"
    data: Optional[bytes] = None
    rc = _redis()
    if rc is not None:
        try:
            raw = rc.get(key)
            if raw:
                data = base64.b64decode(raw)
        except Exception:
            data = None
    if data is None and key in _local_results:
        data = _local_results[key][1]
    return pq.read_table(io.BytesIO(data)) if data else None
