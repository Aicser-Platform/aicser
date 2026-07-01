"""Tests for feed preview payload shaping."""

from types import SimpleNamespace

from src.modules.feed.service_preview import FeedServicePreviewMixin


def test_snapshot_preview_can_limit_widgets_without_mutating_snapshot():
    service = FeedServicePreviewMixin()
    raw = {
        "narrative": {"title": "Portfolio"},
        "visuals": {
            "widgets": [
                {"id": "one", "chartType": "bar"},
                {"id": "two", "chartType": "line"},
                {"id": "three", "chartType": "pie"},
            ],
            "layout": [
                {"i": "one", "x": 0},
                {"i": "two", "x": 6},
                {"i": "three", "x": 0},
            ],
            "presentation": {"featuredWidgetIds": ["three", "one"]},
        },
    }
    post = SimpleNamespace(asset_type="dashboard", title="Portfolio", description="")
    snapshot = SimpleNamespace(payload=raw, captured_at=None, thumbnail_url=None)

    payload = service._payload_from_snapshot(post, snapshot, max_widgets=2)

    snapshot_payload = payload["snapshotPayload"]
    assert payload["widgetCount"] == 3
    assert [widget["id"] for widget in snapshot_payload["visuals"]["widgets"]] == ["three", "one"]
    assert [item["i"] for item in snapshot_payload["visuals"]["layout"]] == [
        "one",
        "three",
    ]
    assert len(raw["visuals"]["widgets"]) == 3
