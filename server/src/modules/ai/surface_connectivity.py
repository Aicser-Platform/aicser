"""Whether embedded surfaces (sheet/notebook/dashboard) have analyzable data — CE-safe."""

from __future__ import annotations

from typing import Any, Dict, Optional


def connectivity_from_surface_context(sc: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    """Derive connectivity flags from ACC payload (client and/or server)."""
    if not isinstance(sc, dict):
        return _empty()
    runtime = sc.get("runtime") if isinstance(sc.get("runtime"), dict) else {}
    pre = runtime.get("data_connectivity") if isinstance(runtime.get("data_connectivity"), dict) else {}
    artifacts = sc.get("artifacts") if isinstance(sc.get("artifacts"), dict) else {}

    tables = artifacts.get("tables") or []
    sheets = artifacts.get("sheets") or []
    ranges = artifacts.get("ranges") or []
    widgets = artifacts.get("widgets") or []
    cells = artifacts.get("cells") or []
    frames = artifacts.get("frames") or []

    table_count = len(tables) if isinstance(tables, list) else 0
    row_samples = 0
    if isinstance(tables, list):
        for t in tables:
            if isinstance(t, dict):
                row_samples += int(t.get("row_count") or len(t.get("sample_rows") or []) or 0)

    ds_ids = list(runtime.get("data_source_ids") or [])
    linked = runtime.get("linked_ask_data_source_id")
    if linked:
        ds_ids.append(str(linked))

    has_warehouse = bool(pre.get("has_warehouse_source")) or bool(ds_ids)
    has_grid = bool(pre.get("has_embedded_grid_data")) or table_count > 0
    has_ranges = bool(pre.get("has_live_sql_ranges")) or (
        isinstance(ranges, list) and len(ranges) > 0
    )
    has_widgets = bool(pre.get("has_dashboard_widgets")) or (
        isinstance(widgets, list) and len(widgets) > 0
    )
    has_notebook = bool(pre.get("has_notebook_data")) or (
        (isinstance(frames, list) and len(frames) > 0)
        or (isinstance(cells, list) and len(cells) > 0)
    )
    sheet_rows = 0
    if isinstance(sheets, list):
        for s in sheets:
            if isinstance(s, dict) and s.get("data_row_count"):
                sheet_rows += int(s["data_row_count"])

    can_analyze = has_warehouse or has_grid or has_ranges or has_widgets or has_notebook

    summary = str(pre.get("summary") or "").strip()
    if not summary:
        parts = []
        if has_grid:
            parts.append(f"{table_count} table(s) in workbook")
        if has_ranges:
            parts.append(f"{len(ranges) if isinstance(ranges, list) else 0} live SQL range(s)")
        if has_warehouse:
            parts.append("warehouse/Ask source linked")
        if has_widgets:
            parts.append(f"{len(widgets) if isinstance(widgets, list) else 0} dashboard widget(s)")
        if has_notebook:
            parts.append("notebook cells/frames")
        if not parts:
            summary = "No data detected in this artifact yet"
        else:
            summary = "; ".join(parts)

    return {
        "has_warehouse_source": has_warehouse,
        "has_embedded_grid_data": has_grid,
        "has_live_sql_ranges": has_ranges,
        "has_dashboard_widgets": has_widgets,
        "has_notebook_data": has_notebook,
        "embedded_table_count": table_count,
        "embedded_row_sample_count": row_samples or sheet_rows,
        "can_analyze_without_sidebar_source": can_analyze,
        "summary": summary,
    }


def surface_has_embedded_data(state: Dict[str, Any]) -> bool:
    sc = state.get("surface_context")
    conn = connectivity_from_surface_context(sc if isinstance(sc, dict) else None)
    return bool(conn.get("can_analyze_without_sidebar_source"))


def request_has_analyzable_data(
    data_source_id: Optional[str],
    surface_context: Optional[Dict[str, Any]],
) -> bool:
    """Sidebar warehouse id OR embedded artifact tables/widgets/cells."""
    if data_source_id:
        return True
    conn = connectivity_from_surface_context(surface_context)
    return bool(conn.get("can_analyze_without_sidebar_source"))


def _empty() -> Dict[str, Any]:
    return {
        "has_warehouse_source": False,
        "has_embedded_grid_data": False,
        "has_live_sql_ranges": False,
        "has_dashboard_widgets": False,
        "has_notebook_data": False,
        "embedded_table_count": 0,
        "embedded_row_sample_count": 0,
        "can_analyze_without_sidebar_source": False,
        "summary": "No data detected in this artifact yet",
    }
