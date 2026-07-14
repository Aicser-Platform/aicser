"""Validation for dashboard chart result payloads.

Chart execution can succeed at the SQL layer while still returning data that a
widget cannot render correctly. These checks keep that mismatch from being
reported as a successful dashboard/widget sync.
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any, Dict, Iterable, Optional


STATIC_WIDGET_TYPES = {"text", "divider", "image", "embed", "slicer", "filter"}
SERIES_CHART_TYPES = {
    "bar",
    "line",
    "area",
    "pie",
    "donut",
    "radar",
    "funnel",
    "gauge",
    "bullet",
    "geo",
}


@dataclass(frozen=True)
class ChartDataValidationResult:
    valid: bool
    reason: Optional[str] = None


def _is_present(value: Any) -> bool:
    return value is not None and value != ""


def _non_empty_list(value: Any) -> bool:
    return isinstance(value, list) and len(value) > 0


def _series_items(data: Dict[str, Any]) -> list:
    series = data.get("series")
    return series if isinstance(series, list) else []


def _series_has_points(series: Iterable[Any]) -> bool:
    for item in series:
        if isinstance(item, dict) and _non_empty_list(item.get("data")):
            return True
    return False


def _first_series_len(data: Dict[str, Any]) -> int:
    series = _series_items(data)
    if not series or not isinstance(series[0], dict):
        return 0
    points = series[0].get("data")
    return len(points) if isinstance(points, list) else 0


def _list_lengths_match(left: Any, right: Any) -> bool:
    return isinstance(left, list) and isinstance(right, list) and len(left) == len(right)


def validate_chart_data(
    chart_type: Optional[str],
    data: Any,
    *,
    chart_query: Optional[Dict[str, Any]] = None,
) -> ChartDataValidationResult:
    """Return whether a chart result can be rendered by its widget type."""
    ctype = str(chart_type or "").strip().lower() or "bar"
    if ctype in STATIC_WIDGET_TYPES:
        return ChartDataValidationResult(True)

    if not isinstance(data, dict):
        return ChartDataValidationResult(False, "Chart returned an invalid data payload")

    if ctype == "stat":
        if _is_present(data.get("value")):
            return ChartDataValidationResult(True)
        y_data = data.get("y")
        if _non_empty_list(y_data) and any(_is_present(v) for v in y_data):
            return ChartDataValidationResult(True)
        if _series_has_points(_series_items(data)):
            return ChartDataValidationResult(True)
        return ChartDataValidationResult(False, "KPI returned no value")

    if ctype == "table":
        rows = data.get("rows") or data.get("data")
        columns = data.get("columns")
        if _non_empty_list(rows):
            return ChartDataValidationResult(True)
        if _non_empty_list(data.get("x")) or _non_empty_list(data.get("series")):
            return ChartDataValidationResult(True)
        if _non_empty_list(columns):
            return ChartDataValidationResult(False, "Table returned columns but no rows")
        return ChartDataValidationResult(False, "Table returned no rows")

    if ctype == "scatter":
        series = _series_items(data)
        if not _series_has_points(series):
            return ChartDataValidationResult(False, "Scatter chart returned no points")
        for item in series:
            points = item.get("data") if isinstance(item, dict) else None
            if not isinstance(points, list):
                continue
            for point in points:
                if (
                    isinstance(point, (list, tuple))
                    and len(point) >= 2
                    and _is_present(point[0])
                    and _is_present(point[1])
                ):
                    return ChartDataValidationResult(True)
        return ChartDataValidationResult(False, "Scatter chart has no x/y points")

    x_values = data.get("x")
    y_values = data.get("y")
    series = _series_items(data)

    if ctype in {"pie", "donut"}:
        if _list_lengths_match(x_values, y_values) and len(x_values) > 0:
            return ChartDataValidationResult(True)
        if _series_has_points(series):
            return ChartDataValidationResult(True)
        return ChartDataValidationResult(False, f"{ctype.title()} chart returned no category/value pairs")

    if ctype in SERIES_CHART_TYPES:
        if _non_empty_list(x_values) and _series_has_points(series):
            first_len = _first_series_len(data)
            if first_len == len(x_values):
                return ChartDataValidationResult(True)
            return ChartDataValidationResult(False, "Chart categories and values are different lengths")
        if _list_lengths_match(x_values, y_values) and len(x_values) > 0:
            return ChartDataValidationResult(True)
        if _is_present(data.get("value")):
            return ChartDataValidationResult(True)
        return ChartDataValidationResult(False, "Chart returned no renderable series")

    has_any_data = (
        _non_empty_list(data.get("x"))
        or _non_empty_list(data.get("y"))
        or _series_has_points(series)
        or _is_present(data.get("value"))
    )
    if has_any_data:
        return ChartDataValidationResult(True)
    return ChartDataValidationResult(False, "Chart returned no data")
