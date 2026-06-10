"""Deprecation helpers for legacy /charts/dashboards routes."""

from __future__ import annotations

from starlette.responses import Response

DEPRECATION_HEADER = "299; use /api/dashboards instead"
SUCCESSOR_LINK = '</api/dashboards>; rel="successor-version"'


def apply_dashboard_deprecation(response: Response) -> None:
    response.headers["Deprecation"] = DEPRECATION_HEADER
    response.headers["Link"] = SUCCESSOR_LINK
