"""The arithmetic of location analysis, on points already read (with row security) from a data
source. Pure and synchronous: callers run it in a worker thread.

Straight-line distances are great-circle distances on a sphere of radius 6,371 km (error under
0.5% anywhere on Earth), found with a k-d tree so a million pairs never have to be compared.
Hexagons use H3 (Apache-2.0), hotspots use DBSCAN on the same sphere, and "which area is each
point in" uses DuckDB's spatial join.
"""

from __future__ import annotations

import json
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Sequence, Tuple

import numpy as np

EARTH_KM = 6371.0088
# Mean hexagon edge length in km for each H3 resolution.
H3_EDGE_KM = {3: 59.8, 4: 22.6, 5: 8.54, 6: 3.23, 7: 1.22, 8: 0.461, 9: 0.174, 10: 0.0659, 11: 0.0249}


@dataclass
class Points:
    lat: np.ndarray
    lon: np.ndarray
    label: List[str]
    measure: Optional[np.ndarray]
    dropped: int = 0

    def __len__(self) -> int:
        return int(self.lat.shape[0])


def clean_points(
    lats: Sequence[Any], lons: Sequence[Any], labels: Sequence[Any], measures: Optional[Sequence[Any]]
) -> Points:
    """Keep rows with a usable position: numeric, on Earth, and not the (0, 0) placeholder."""
    lat = np.array([_num(v) for v in lats], dtype=float)
    lon = np.array([_num(v) for v in lons], dtype=float)
    ok = np.isfinite(lat) & np.isfinite(lon) & (np.abs(lat) <= 90) & (np.abs(lon) <= 180) & ~((lat == 0) & (lon == 0))
    meas = None
    if measures is not None:
        meas = np.array([_num(v) for v in measures], dtype=float)[ok]
        meas = np.where(np.isfinite(meas), meas, 0.0)
    lab = [str(labels[i]) if labels[i] is not None else f"#{i + 1}" for i in np.flatnonzero(ok)]
    return Points(lat=lat[ok], lon=lon[ok], label=lab, measure=meas, dropped=int((~ok).sum()))


def _num(value: Any) -> float:
    try:
        return float(value)
    except (TypeError, ValueError):
        return float("nan")


def _xyz(lat: np.ndarray, lon: np.ndarray) -> np.ndarray:
    la, lo = np.radians(lat), np.radians(lon)
    return np.column_stack([np.cos(la) * np.cos(lo), np.cos(la) * np.sin(lo), np.sin(la)])


def haversine_km(lat1, lon1, lat2, lon2) -> np.ndarray:
    la1, lo1, la2, lo2 = map(np.radians, (lat1, lon1, lat2, lon2))
    h = np.sin((la2 - la1) / 2) ** 2 + np.cos(la1) * np.cos(la2) * np.sin((lo2 - lo1) / 2) ** 2
    return 2 * EARTH_KM * np.arcsin(np.sqrt(np.clip(h, 0, 1)))


def _chord(km: float) -> float:
    return 2 * np.sin(min(km, np.pi * EARTH_KM) / (2 * EARTH_KM))


def nearest(points: Points, sites: Points, k: int = 1) -> Tuple[np.ndarray, np.ndarray]:
    """For each point, the indexes of its ``k`` nearest sites and their distances (km)."""
    from scipy.spatial import cKDTree

    k = max(1, min(k, len(sites)))
    tree = cKDTree(_xyz(sites.lat, sites.lon))
    _, idx = tree.query(_xyz(points.lat, points.lon), k=k)
    idx = idx.reshape(len(points), k)
    km = haversine_km(points.lat[:, None], points.lon[:, None], sites.lat[idx], sites.lon[idx])
    order = np.argsort(km, axis=1)
    return np.take_along_axis(idx, order, 1), np.take_along_axis(km, order, 1)


def within_radius(points: Points, sites: Points, radius_km: float) -> List[np.ndarray]:
    """For each site, the indexes of the points within ``radius_km`` of it."""
    from scipy.spatial import cKDTree

    tree = cKDTree(_xyz(points.lat, points.lon))
    hits = tree.query_ball_point(_xyz(sites.lat, sites.lon), r=_chord(radius_km))
    return [np.array(sorted(h), dtype=int) for h in hits]


def circle(lat: float, lon: float, radius_km: float, steps: int = 48) -> Dict[str, Any]:
    """A GeoJSON polygon approximating a circle on the sphere."""
    d = radius_km / EARTH_KM
    la, lo = np.radians(lat), np.radians(lon)
    b = np.linspace(0, 2 * np.pi, steps + 1)
    la2 = np.arcsin(np.sin(la) * np.cos(d) + np.cos(la) * np.sin(d) * np.cos(b))
    lo2 = lo + np.arctan2(np.sin(b) * np.sin(d) * np.cos(la), np.cos(d) - np.sin(la) * np.sin(la2))
    ring = [[round(float(np.degrees(x)), 6), round(float(np.degrees(y)), 6)] for x, y in zip(lo2, la2)]
    return {"type": "Polygon", "coordinates": [ring]}


def auto_resolution(points: Points, max_cells: int = 600) -> int:
    """The finest hexagon size that keeps the map readable: at most ``max_cells`` hexagons, and
    on average at least three places per hexagon, so dense and sparse areas both show."""
    import pyarrow as pa

    from src.shared.duckdb_extensions import load_extensions

    if len(points) < 2:
        return 7
    limit = max(10, min(max_cells, len(points) // 3))
    conn = _duckdb()
    try:
        load_extensions(conn, ["h3"])
        conn.register("pts", pa.table({"lat": points.lat, "lon": points.lon}))
        counts = conn.execute(
            "SELECT " + ", ".join(
                f"count(DISTINCT h3_latlng_to_cell(lat, lon, {r}))" for r in range(4, 11)
            ) + " FROM pts"
        ).fetchone()
    finally:
        conn.close()
    best = 4
    for r, n in zip(range(4, 11), counts):
        if n <= limit:
            best = r
    return best


def _duckdb():
    import duckdb

    conn = duckdb.connect()
    conn.execute("SET threads TO 2")
    return conn


def hexbin(points: Points, resolution: int) -> List[Dict[str, Any]]:
    """Points grouped into H3 hexagons: [{cell, count, total, geometry}] with the busiest first."""
    import pyarrow as pa

    from src.shared.duckdb_extensions import load_extensions

    resolution = max(3, min(int(resolution), 11))
    conn = _duckdb()
    try:
        load_extensions(conn, ["h3", "spatial"])
        conn.register("pts", pa.table({
            "lat": points.lat, "lon": points.lon,
            "m": points.measure if points.measure is not None else np.zeros(len(points)),
        }))
        rows = conn.execute(
            f"""
            SELECT h3_h3_to_string(cell) AS cell, n, total,
                   ST_AsGeoJSON(ST_GeomFromText(h3_cell_to_boundary_wkt(cell))) AS geom
            FROM (SELECT h3_latlng_to_cell(lat, lon, {resolution}) AS cell, count(*) AS n, sum(m) AS total
                  FROM pts GROUP BY 1)
            ORDER BY n DESC
            """
        ).fetchall()
    finally:
        conn.close()
    return [{"cell": c, "count": int(n), "total": float(t or 0), "geometry": json.loads(g)} for c, n, t, g in rows]


def hotspots(points: Points, radius_km: float, min_points: int) -> np.ndarray:
    """Cluster label per point (-1 = not in a hotspot): DBSCAN on the sphere."""
    from sklearn.cluster import DBSCAN

    if len(points) == 0:
        return np.array([], dtype=int)
    coords = np.radians(np.column_stack([points.lat, points.lon]))
    model = DBSCAN(eps=radius_km / EARTH_KM, min_samples=max(2, int(min_points)), metric="haversine", algorithm="ball_tree")
    return model.fit_predict(coords)


def points_in_areas(points: Points, areas: List[Tuple[str, Dict[str, Any]]]) -> List[Optional[str]]:
    """The name of the area containing each point (None when it's in none of them)."""
    import pyarrow as pa

    from src.shared.duckdb_extensions import load_extensions

    if not areas or len(points) == 0:
        return [None] * len(points)
    conn = _duckdb()
    try:
        load_extensions(conn, ["spatial"])
        conn.register("pts", pa.table({"i": np.arange(len(points)), "lat": points.lat, "lon": points.lon}))
        conn.register("areas", pa.table({"name": [a for a, _ in areas], "g": [json.dumps(g) for _, g in areas]}))
        rows = conn.execute(
            """
            WITH a AS (SELECT name, ST_GeomFromGeoJSON(g) AS geom FROM areas),
                 p AS (SELECT i, ST_Point(lon, lat) AS geom FROM pts)
            SELECT p.i, min(a.name) FROM p JOIN a ON ST_Contains(a.geom, p.geom) GROUP BY p.i
            """
        ).fetchall()
    finally:
        conn.close()
    out: List[Optional[str]] = [None] * len(points)
    for i, name in rows:
        out[int(i)] = name
    return out


def area_members(points: Points, areas: List[Dict[str, Any]]) -> List[np.ndarray]:
    """For each area (GeoJSON geometry), the indexes of the points inside it (areas may overlap)."""
    import pyarrow as pa

    from src.shared.duckdb_extensions import load_extensions

    members: List[List[int]] = [[] for _ in areas]
    if not areas or len(points) == 0:
        return [np.array([], dtype=int) for _ in areas]
    conn = _duckdb()
    try:
        load_extensions(conn, ["spatial"])
        conn.register("pts", pa.table({"i": np.arange(len(points)), "lat": points.lat, "lon": points.lon}))
        conn.register("areas", pa.table({"j": np.arange(len(areas)), "g": [json.dumps(g) for g in areas]}))
        rows = conn.execute(
            """
            WITH a AS (SELECT j, ST_GeomFromGeoJSON(g) AS geom FROM areas),
                 p AS (SELECT i, ST_Point(lon, lat) AS geom FROM pts)
            SELECT a.j, p.i FROM p JOIN a ON ST_Contains(a.geom, p.geom)
            """
        ).fetchall()
    finally:
        conn.close()
    for j, i in rows:
        members[int(j)].append(int(i))
    return [np.array(sorted(m), dtype=int) for m in members]
