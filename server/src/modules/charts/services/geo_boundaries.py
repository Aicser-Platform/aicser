"""Map boundaries for map widgets: world countries and each country's administrative levels.

World countries come from Natural Earth (public domain); a country's provinces, districts,
communes (ADM1-ADM5) from geoBoundaries (open licenses; the license and source travel with the
data so the map can credit them). Files are fetched once, slimmed (rounded coordinates, only the
properties a map needs) and cached on disk, so later requests — and offline installs whose cache
was pre-loaded — never go to the network.

Security: only fixed hosts are ever contacted, a country is a 3-letter ISO code and a level a
digit, so no caller-supplied URL reaches the fetcher (no SSRF).
"""

from __future__ import annotations

import asyncio
import os
import re
from pathlib import Path
from typing import Any, Dict, Iterable, List, Optional, Tuple
from urllib.parse import urlparse

import orjson

ALLOWED_HOSTS = {
    "www.geoboundaries.org",
    "github.com",
    "raw.githubusercontent.com",
    "media.githubusercontent.com",
    "objects.githubusercontent.com",
}
NATURAL_EARTH_WORLD = (
    "https://raw.githubusercontent.com/nvkelso/natural-earth-vector/master/geojson/"
    "ne_50m_admin_0_countries.geojson"
)
GEOBOUNDARIES_API = "https://www.geoboundaries.org/api/current/gbOpen/{iso3}/{level}/"
ISO3 = re.compile(r"^[A-Z]{3}$")
LEVELS = ("ADM1", "ADM2", "ADM3", "ADM4", "ADM5")

# Natural Earth name columns kept for matching data written in other languages.
NE_NAME_KEYS = ("NAME_DE", "NAME_ES", "NAME_FR", "NAME_ID", "NAME_JA", "NAME_VI", "NAME_ZH", "NAME_ZHT", "NAME_KO", "NAME_TH", "NAME_PT", "NAME_RU", "NAME_AR")

_locks: Dict[str, asyncio.Lock] = {}


class GeoUnavailable(Exception):
    """The boundary isn't cached and can't be fetched (offline, or the source has none)."""


def cache_dir() -> Path:
    base = os.getenv("GEO_CACHE_DIR") or os.path.join(os.getenv("UPLOAD_DIR", "uploads"), "geo_cache")
    path = Path(base)
    path.mkdir(parents=True, exist_ok=True)
    return path


def offline() -> bool:
    return os.getenv("GEO_OFFLINE", "").strip().lower() in ("1", "true", "yes")


def validate_country(iso3: str) -> str:
    code = (iso3 or "").strip().upper()
    if not ISO3.match(code):
        raise ValueError("Country must be a 3-letter ISO code, e.g. KHM")
    return code


def validate_level(level: str) -> str:
    lv = (level or "").strip().upper()
    if lv not in LEVELS:
        raise ValueError("Level must be one of ADM1-ADM5")
    return lv


def _allowed(url: str) -> bool:
    parsed = urlparse(url)
    return parsed.scheme == "https" and parsed.hostname in ALLOWED_HOSTS


async def _get(url: str, *, as_json: bool = True) -> Any:
    """GET from an allowed host, following redirects only to allowed hosts."""
    if offline():
        raise GeoUnavailable("Map boundaries are offline and not cached")
    import httpx

    current = url
    async with httpx.AsyncClient(timeout=60.0, follow_redirects=False) as client:
        for _ in range(5):
            if not _allowed(current):
                raise GeoUnavailable("Blocked a boundary download from an unexpected host")
            resp = await client.get(current, headers={"User-Agent": "Aicser-Maps/1.0"})
            if resp.status_code in (301, 302, 303, 307, 308) and resp.headers.get("location"):
                current = str(resp.url.join(resp.headers["location"]))
                continue
            if resp.status_code == 404:
                raise GeoUnavailable("No boundaries published for this area")
            resp.raise_for_status()
            return orjson.loads(resp.content) if as_json else resp.content
    raise GeoUnavailable("Too many redirects fetching boundaries")


# ── Geometry slimming ────────────────────────────────────────────────────────


def _round_ring(ring: Iterable[Iterable[float]], digits: int) -> List[List[float]]:
    out: List[List[float]] = []
    for pt in ring:
        p = [round(float(pt[0]), digits), round(float(pt[1]), digits)]
        if not out or out[-1] != p:
            out.append(p)
    return out


def slim_geometry(geom: Optional[Dict[str, Any]], digits: int = 3) -> Optional[Dict[str, Any]]:
    """Round coordinates (3 digits ≈ 100 m) and drop repeated points; keep polygons only."""
    if not geom:
        return None
    t = geom.get("type")
    coords = geom.get("coordinates") or []
    if t == "Polygon":
        rings = [r for r in (_round_ring(r, digits) for r in coords) if len(r) >= 4]
        return {"type": "Polygon", "coordinates": rings} if rings else None
    if t == "MultiPolygon":
        polys = []
        for poly in coords:
            rings = [r for r in (_round_ring(r, digits) for r in poly) if len(r) >= 4]
            if rings:
                polys.append(rings)
        return {"type": "MultiPolygon", "coordinates": polys} if polys else None
    return None


def _outer_rings(geom: Dict[str, Any]) -> List[List[List[float]]]:
    if geom["type"] == "Polygon":
        return [geom["coordinates"][0]]
    return [poly[0] for poly in geom["coordinates"]]


def _inside(pt: Tuple[float, float], ring: List[List[float]]) -> bool:
    x, y = pt
    inside = False
    j = len(ring) - 1
    for i in range(len(ring)):
        xi, yi = ring[i]
        xj, yj = ring[j]
        if (yi > y) != (yj > y) and x < (xj - xi) * (y - yi) / ((yj - yi) or 1e-12) + xi:
            inside = not inside
        j = i
    return inside


def _representative_point(geom: Dict[str, Any]) -> Tuple[float, float]:
    ring = max(_outer_rings(geom), key=len)
    xs = [p[0] for p in ring]
    ys = [p[1] for p in ring]
    return (sum(xs) / len(xs), sum(ys) / len(ys))


def assign_parents(children: List[Dict[str, Any]], parents: List[Dict[str, Any]]) -> None:
    """Name each child area's parent (a district's province) by where the child sits."""
    indexed = []
    for p in parents:
        g = p.get("geometry")
        if not g:
            continue
        rings = _outer_rings(g)
        xs = [pt[0] for r in rings for pt in r]
        ys = [pt[1] for r in rings for pt in r]
        indexed.append((p["properties"]["name"], rings, (min(xs), min(ys), max(xs), max(ys))))
    for c in children:
        g = c.get("geometry")
        if not g:
            continue
        pt = _representative_point(g)
        for name, rings, (x0, y0, x1, y1) in indexed:
            if x0 <= pt[0] <= x1 and y0 <= pt[1] <= y1 and any(_inside(pt, r) for r in rings):
                c["properties"]["parent"] = name
                break


# ── Datasets ────────────────────────────────────────────────────────────────


def process_world(raw: Dict[str, Any]) -> Dict[str, Any]:
    features = []
    for f in raw.get("features", []):
        p = {k.upper(): v for k, v in (f.get("properties") or {}).items()}
        iso3 = p.get("ISO_A3") if p.get("ISO_A3") not in (None, "-99") else p.get("ADM0_A3")
        iso2 = p.get("ISO_A2") if p.get("ISO_A2") not in (None, "-99") else p.get("ISO_A2_EH")
        geom = slim_geometry(f.get("geometry"), 3)
        if not geom or not iso3:
            continue
        names = sorted({str(p[k]) for k in NE_NAME_KEYS if p.get(k)} | {str(p[k]) for k in ("NAME_LONG", "FORMAL_EN", "NAME_SORT", "ADMIN") if p.get(k)})
        features.append(
            {
                "type": "Feature",
                "properties": {
                    "name": p.get("NAME") or p.get("ADMIN"),
                    "iso3": iso3,
                    "iso2": iso2 if iso2 not in (None, "-99") else None,
                    "continent": p.get("CONTINENT"),
                    "subregion": p.get("SUBREGION"),
                    "altNames": names,
                },
                "geometry": geom,
            }
        )
    return {
        "type": "FeatureCollection",
        "features": features,
        "source": "Natural Earth",
        "license": "Public domain",
    }


def process_admin(raw: Dict[str, Any], meta: Dict[str, Any]) -> Dict[str, Any]:
    features = []
    for f in raw.get("features", []):
        p = f.get("properties") or {}
        geom = slim_geometry(f.get("geometry"), 4)
        name = p.get("shapeName")
        if not geom or not name:
            continue
        features.append(
            {
                "type": "Feature",
                "properties": {"name": name, "code": p.get("shapeISO") or None, "id": p.get("shapeID")},
                "geometry": geom,
            }
        )
    return {
        "type": "FeatureCollection",
        "features": features,
        "source": "geoBoundaries",
        "license": meta.get("boundaryLicense") or "Open license (see geoBoundaries)",
        "year": meta.get("boundaryYearRepresented"),
    }


async def _cached(key: str, build) -> bytes:
    path = cache_dir() / f"{key}.json"
    if path.exists():
        return path.read_bytes()
    lock = _locks.setdefault(key, asyncio.Lock())
    async with lock:
        if path.exists():
            return path.read_bytes()
        data = await build()
        body = orjson.dumps(data)
        tmp = path.with_suffix(".tmp")
        tmp.write_bytes(body)
        tmp.replace(path)
        return body


async def world() -> bytes:
    async def build():
        return process_world(await _get(NATURAL_EARTH_WORLD))

    return await _cached("world_countries", build)


async def levels(iso3: str) -> bytes:
    code = validate_country(iso3)

    async def build():
        try:
            catalog = await _get(GEOBOUNDARIES_API.format(iso3=code, level="ALL"))
        except GeoUnavailable:
            catalog = []
        found = sorted({c.get("boundaryType") for c in catalog if c.get("boundaryType") in LEVELS})
        return {"country": code, "levels": found}

    return await _cached(f"{code}_levels", build)


async def admin(iso3: str, level: str) -> bytes:
    code = validate_country(iso3)
    lv = validate_level(level)

    async def build():
        meta = await _get(GEOBOUNDARIES_API.format(iso3=code, level=lv))
        url = meta.get("simplifiedGeometryGeoJSON") or meta.get("gjDownloadURL")
        if not url:
            raise GeoUnavailable("No boundaries published for this area")
        data = process_admin(await _get(url), meta)
        if lv != "ADM1":
            parent_level = f"ADM{int(lv[-1]) - 1}"
            try:
                parents = orjson.loads(await admin(code, parent_level))
                assign_parents(data["features"], parents["features"])
                data["parentLevel"] = parent_level
            except (GeoUnavailable, ValueError):
                pass
        return data

    return await _cached(f"{code}_{lv}", build)
