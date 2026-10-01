"""Location analysis arithmetic on known places."""

import numpy as np
import pytest

from src.modules.spatial import engine


def pts(coords, measures=None):
    lat = [c[0] for c in coords]
    lon = [c[1] for c in coords]
    return engine.clean_points(lat, lon, [f"p{i}" for i in range(len(coords))], measures)


def test_clean_points_drops_unusable_positions():
    p = engine.clean_points([11.5, None, 0, 95, "12.1"], [104.9, 104.9, 0, 10, "103.2"], ["a", "b", "c", "d", "e"], [1, 2, 3, 4, "x"])
    assert len(p) == 2 and p.dropped == 3
    assert p.label == ["a", "e"]
    assert list(p.measure) == [1.0, 0.0]


def test_haversine_matches_known_distance():
    # Phnom Penh to Siem Reap is about 230 km as the crow flies.
    km = float(engine.haversine_km(11.5564, 104.9282, 13.3633, 103.8564))
    assert 225 < km < 235


def test_nearest_picks_the_closest_site():
    places = pts([(11.556, 104.928), (13.36, 103.86)])
    sites = pts([(13.35, 103.87), (11.55, 104.92)])
    idx, km = engine.nearest(places, sites)
    assert list(idx[:, 0]) == [1, 0]
    assert km[0, 0] < 2 and km[1, 0] < 2


def test_within_radius_counts_places_per_site():
    places = pts([(11.556, 104.928), (11.560, 104.930), (11.70, 104.90)])
    sites = pts([(11.556, 104.928)])
    hits = engine.within_radius(places, sites, radius_km=1.0)
    assert sorted(hits[0].tolist()) == [0, 1]


def test_hotspots_find_the_dense_group():
    rng = np.random.default_rng(3)
    dense = [(11.556 + d1, 104.928 + d2) for d1, d2 in rng.normal(0, 0.001, (40, 2))]
    sparse = [(11.0 + i * 0.2, 104.0 + i * 0.2) for i in range(5)]
    labels = engine.hotspots(pts(dense + sparse), radius_km=0.5, min_points=5)
    assert len(set(labels[:40])) == 1 and labels[0] >= 0
    assert all(l == -1 for l in labels[40:])


def test_circle_is_a_closed_ring_of_the_right_size():
    ring = engine.circle(11.5, 104.9, 5.0)["coordinates"][0]
    assert ring[0] == ring[-1]
    d = engine.haversine_km(11.5, 104.9, np.array([p[1] for p in ring]), np.array([p[0] for p in ring]))
    assert np.allclose(d, 5.0, atol=0.05)


def test_hexbin_and_points_in_areas_use_duckdb_extensions():
    p = pts([(11.556, 104.928)] * 3 + [(13.36, 103.86)], [1, 2, 3, 4])
    cells = engine.hexbin(p, 7)
    assert cells[0]["count"] == 3 and cells[0]["total"] == 6
    assert cells[0]["geometry"]["type"] == "Polygon"
    square = {"type": "Polygon", "coordinates": [[[104.8, 11.4], [105.0, 11.4], [105.0, 11.7], [104.8, 11.7], [104.8, 11.4]]]}
    assert engine.points_in_areas(p, [("Phnom Penh", square)]) == ["Phnom Penh"] * 3 + [None]
    members = engine.area_members(p, [square, square])
    assert [m.tolist() for m in members] == [[0, 1, 2], [0, 1, 2]]
