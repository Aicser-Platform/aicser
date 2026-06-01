"""Embed middleware path matching."""

from src.core.middleware import _embed_protected_path, _extract_dashboard_id_from_embed_path


def test_embed_protected_legacy_path():
    assert _embed_protected_path("/embed/dashboards/abc-123")


def test_embed_protected_jwt_frontend_path():
    assert _embed_protected_path("/embed/dashboard/abc-123")


def test_embed_protected_charts_api_path():
    assert _embed_protected_path("/charts/dashboards/abc-123/embed")


def test_embed_protected_unrelated_path():
    assert not _embed_protected_path("/api/dashboards")


def test_extract_dashboard_id_from_charts_embed():
    assert _extract_dashboard_id_from_embed_path("/charts/dashboards/dash-1/embed") == "dash-1"


def test_extract_dashboard_id_from_singular_embed():
    assert _extract_dashboard_id_from_embed_path("/embed/dashboard/dash-2") == "dash-2"
