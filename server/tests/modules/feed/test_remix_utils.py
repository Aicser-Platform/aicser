"""Tests for feed remix helpers."""
from uuid import uuid4

from src.modules.feed.remix_utils import _layout_for_widget


def test_layout_for_widget_uses_existing_layout():
    layout = _layout_for_widget(
        "w1",
        0,
        [{"i": "w1", "x": 2, "y": 3, "w": 8, "h": 6}],
    )
    assert layout["x"] == 2
    assert layout["w"] == 8


def test_layout_for_widget_defaults_when_missing():
    layout = _layout_for_widget("missing", 1, [])
    assert layout["i"] == "missing"
    assert layout["y"] == 5
