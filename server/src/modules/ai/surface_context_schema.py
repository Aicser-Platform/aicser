"""
Agent Context Contract (ACC) — shared surface envelope for /ai/analyze.

CE: schema only (no EE imports). EE hydrates and routes from this payload.
"""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field


SurfaceKind = Literal["chat", "dashboard", "notebook", "sheet"]
SurfaceIntent = Literal["ask", "explain", "build", "refine", "mutate"]


class SurfaceRef(BaseModel):
    id: Optional[str] = None
    version: Optional[int] = None
    title: Optional[str] = None


class SurfaceSelection(BaseModel):
    """Surface-specific selection (optional)."""

    widget_id: Optional[str] = None
    cell_id: Optional[str] = None
    sheet_name: Optional[str] = None
    range_a1: Optional[str] = None
    table_name: Optional[str] = None


class SurfaceDataConnectivity(BaseModel):
    """Explicit data availability for embedded Ask (grid vs warehouse)."""

    has_warehouse_source: bool = False
    has_embedded_grid_data: bool = False
    has_live_sql_ranges: bool = False
    has_dashboard_widgets: bool = False
    has_notebook_data: bool = False
    embedded_table_count: int = 0
    embedded_row_sample_count: int = 0
    can_analyze_without_sidebar_source: bool = False
    summary: str = ""


class SurfaceRuntime(BaseModel):
    filters: Optional[List[Dict[str, Any]]] = None
    parameters: Optional[Dict[str, Any]] = None
    data_source_ids: Optional[List[str]] = None
    ask_snapshot_stale: Optional[bool] = None
    linked_ask_data_source_id: Optional[str] = None
    data_connectivity: Optional[SurfaceDataConnectivity] = None


class SurfaceArtifacts(BaseModel):
    """Lightweight artifact summaries — not full document bodies."""

    widgets: Optional[List[Dict[str, Any]]] = None
    cells: Optional[List[Dict[str, Any]]] = None
    ranges: Optional[List[Dict[str, Any]]] = None
    frames: Optional[List[Dict[str, Any]]] = None
    sheets: Optional[List[Dict[str, Any]]] = None
    tables: Optional[List[Dict[str, Any]]] = None
    data_quality: Optional[Dict[str, Any]] = None


class SurfaceContext(BaseModel):
    surface: SurfaceKind = "chat"
    surface_ref: Optional[SurfaceRef] = None
    intent: SurfaceIntent = "ask"
    selection: Optional[SurfaceSelection] = None
    runtime: Optional[SurfaceRuntime] = None
    artifacts: Optional[SurfaceArtifacts] = None
    mutation_policy: Literal["read_only", "propose", "auto_if_descriptive"] = "propose"


def parse_surface_context(raw: Any) -> Optional[SurfaceContext]:
    if raw is None:
        return None
    if isinstance(raw, SurfaceContext):
        return raw
    if not isinstance(raw, dict):
        return None
    try:
        return SurfaceContext.model_validate(raw)
    except Exception:
        return None


def surface_context_to_state_patch(ctx: SurfaceContext) -> Dict[str, Any]:
    """Map ACC onto workflow lifecycle fields (no hydration)."""
    patch: Dict[str, Any] = {"surface_context": ctx.model_dump(mode="json")}
    ref = ctx.surface_ref
    sel = ctx.selection or SurfaceSelection()

    if ctx.surface == "dashboard" and ref and ref.id:
        patch["target_dashboard_id"] = ref.id
        if sel.widget_id:
            patch["target_widget_id"] = sel.widget_id
        if ctx.intent in ("ask", "explain"):
            # Embedded dashboard / Ask copilot: default to cross-widget analysis, not PESD create.
            patch["dashboard_lifecycle_action"] = "analyze"
        elif ctx.intent in ("build", "mutate"):
            patch["dashboard_lifecycle_action"] = "create"
        elif ctx.intent == "refine":
            patch["dashboard_lifecycle_action"] = "refine"

    mode_map = {
        "dashboard": "dashboard",
        "notebook": "notebook",
        "sheet": "sheet",
    }
    if ctx.surface in mode_map and ctx.intent in ("build", "mutate"):
        patch["_analysis_mode_override"] = mode_map[ctx.surface]
    elif ctx.surface == "notebook" and ctx.intent in ("ask", "explain", "refine"):
        patch["_analysis_mode_override"] = "notebook_advisor"
    elif ctx.surface == "sheet" and ctx.intent in ("ask", "explain", "refine"):
        patch["_analysis_mode_override"] = "sheet_advisor"

    try:
        from src.modules.ai.surface_connectivity import connectivity_from_surface_context

        conn = connectivity_from_surface_context(ctx.model_dump(mode="json"))
        patch["surface_data_connectivity"] = conn
        if conn.get("can_analyze_without_sidebar_source"):
            patch["surface_embedded_data"] = True
    except Exception:
        pass

    return patch
