"""Tests for feed snapshot publication helpers."""
from uuid import uuid4

import pytest
from fastapi import HTTPException

from src.modules.feed.snapshot_utils import (
    build_snapshot_payload_from_preview,
    normalize_snapshot_payload,
    validate_snapshot_payload,
)


def test_build_snapshot_payload_from_chart_widget():
    payload = build_snapshot_payload_from_preview(
        "insight",
        {
            "chartWidget": {
                "chartType": "bar",
                "chartData": {"x": ["A"], "y": [1]},
                "chartOptions": {},
            },
            "questionTitle": "Revenue?",
        },
        title="Revenue by region",
        description="Q1 summary",
    )
    assert payload is not None
    assert payload["assetType"] == "insight"
    assert payload["visuals"]["widgets"][0]["chartType"] == "bar"
    assert payload["narrative"]["title"] == "Revenue by region"


def test_validate_snapshot_payload_requires_content():
    with pytest.raises(HTTPException):
        validate_snapshot_payload({})


def test_normalize_snapshot_payload_empty():
    assert normalize_snapshot_payload(None) == {}


def test_build_snapshot_payload_dashboard_layout():
    payload = build_snapshot_payload_from_preview(
        "dashboard",
        {
            "layoutSummary": [{"i": "w1", "x": 0, "y": 0, "w": 6, "h": 4}],
            "dashboardId": str(uuid4()),
            "widgets": [{"id": "w1", "chartType": "bar"}],
        },
        title="Ops dashboard",
    )
    assert payload is not None
    assert payload["assetType"] == "dashboard"
    assert len(payload["visuals"]["widgets"]) == 1
