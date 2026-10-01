"""Map boundaries: validation (no SSRF), slimming, parent assignment and caching."""

import asyncio

import orjson
import pytest

from src.modules.charts.services import geo_boundaries as geo


def test_only_iso_codes_and_known_levels_are_accepted():
    assert geo.validate_country("khm") == "KHM"
    for bad in ["KH", "KHMR", "../etc", "https://evil", ""]:
        with pytest.raises(ValueError):
            geo.validate_country(bad)
    assert geo.validate_level("adm2") == "ADM2"
    with pytest.raises(ValueError):
        geo.validate_level("ADM9")


def test_downloads_only_from_fixed_hosts():
    assert geo._allowed("https://github.com/wmgeolab/geoBoundaries/raw/x.geojson")
    assert not geo._allowed("http://github.com/x")
    assert not geo._allowed("https://169.254.169.254/latest/meta-data")
    assert not geo._allowed("https://evil.example.com/x.geojson")


def test_slimming_rounds_and_drops_repeated_points():
    g = geo.slim_geometry({"type": "Polygon", "coordinates": [[[1.00001, 2.00001], [1.00002, 2.00002], [3, 4], [5, 6], [1, 2]]]}, 3)
    assert g["coordinates"][0] == [[1.0, 2.0], [3.0, 4.0], [5.0, 6.0], [1.0, 2.0]]
    assert geo.slim_geometry({"type": "Point", "coordinates": [1, 2]}) is None


def _square(x0, y0, x1, y1):
    return {"type": "Polygon", "coordinates": [[[x0, y0], [x1, y0], [x1, y1], [x0, y1], [x0, y0]]]}


def test_districts_are_given_their_province():
    provinces = [
        {"properties": {"name": "West"}, "geometry": _square(0, 0, 10, 10)},
        {"properties": {"name": "East"}, "geometry": _square(10, 0, 20, 10)},
    ]
    districts = [
        {"properties": {"name": "A"}, "geometry": _square(1, 1, 3, 3)},
        {"properties": {"name": "B"}, "geometry": _square(12, 2, 14, 4)},
    ]
    geo.assign_parents(districts, provinces)
    assert [d["properties"]["parent"] for d in districts] == ["West", "East"]


def test_world_keeps_codes_continent_and_other_language_names():
    raw = {"features": [{"properties": {"NAME": "Cambodia", "ISO_A3": "KHM", "ISO_A2": "KH", "CONTINENT": "Asia", "NAME_ZH": "柬埔寨"}, "geometry": _square(102, 10, 107, 14)}]}
    f = geo.process_world(raw)["features"][0]["properties"]
    assert (f["name"], f["iso3"], f["iso2"], f["continent"]) == ("Cambodia", "KHM", "KH", "Asia")
    assert "柬埔寨" in f["altNames"]


def test_cached_boundaries_never_touch_the_network(tmp_path, monkeypatch):
    monkeypatch.setenv("GEO_CACHE_DIR", str(tmp_path))
    monkeypatch.setenv("GEO_OFFLINE", "true")
    (tmp_path / "KHM_ADM1.json").write_bytes(orjson.dumps({"type": "FeatureCollection", "features": []}))
    body = asyncio.run(geo.admin("KHM", "ADM1"))
    assert orjson.loads(body)["features"] == []
    with pytest.raises(geo.GeoUnavailable):
        asyncio.run(geo.admin("THA", "ADM1"))
