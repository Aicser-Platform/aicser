import pytest

from src.modules.dashboards.collaboration_chart_service import (
    chart_id_from_widget,
    resolve_socket_user_id,
    _layout_from_client,
)


def test_resolve_socket_user_id_prefers_user_id():
    assert resolve_socket_user_id({"user_id": "u1", "id": "u2"}) == "u1"
    assert resolve_socket_user_id({"id": "u2"}) == "u2"
    assert resolve_socket_user_id({}) is None


def test_chart_id_from_widget_prefix():
    assert chart_id_from_widget("widget-deadbeef", None) == "deadbeef"
    assert chart_id_from_widget("widget-abc", {"chartId": "override"}) == "override"


def test_layout_from_client_maps_page_id():
    layout = _layout_from_client({"x": 1, "y": 2, "w": 6, "h": 4, "pageId": "page-1"})
    assert layout == {"x": 1, "y": 2, "w": 6, "h": 4, "page_id": "page-1"}
