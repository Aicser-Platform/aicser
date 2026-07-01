"""Dashboard share, embed, export, and filter operations (canonical /api/dashboards)."""

from __future__ import annotations

import logging
import os
import time
import uuid as uuid_lib
import asyncio
import copy
import hashlib
import json
from datetime import datetime
from typing import Any, Dict, List, Optional
from uuid import UUID

from fastapi import HTTPException, Request
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.charts.services.v2.dashboard_chart_service import DashboardChartService
from src.modules.charts.services.v2.dashboard_service import DashboardService
from src.modules.charts.services.v2.chart_service import ChartService
from src.modules.dashboards.models import Dashboard, DashboardShare, PLAN_LIMITS, DashboardChart

logger = logging.getLogger(__name__)

_OPERATOR_ALIASES = {
    "eq": "=",
    "equals": "=",
    "contains": "like",
    "search": "like",
}


def _normalize_filter_entry(rf: dict) -> List[dict]:
    """Normalize one runtime filter; may expand date ranges into two filters."""
    if not isinstance(rf, dict) or not rf.get("field"):
        return []
    field = rf["field"]
    raw_op = str(rf.get("operator") or "eq").lower()
    val = rf.get("value")
    ftype = rf.get("type")

    if raw_op == "between" and isinstance(val, (list, tuple)) and len(val) >= 2:
        out: List[dict] = []
        if val[0] not in (None, ""):
            out.append({"field": field, "operator": ">=", "value": val[0], "type": ftype or "date"})
        if val[1] not in (None, ""):
            out.append({"field": field, "operator": "<=", "value": val[1], "type": ftype or "date"})
        return out

    op = _OPERATOR_ALIASES.get(raw_op, rf.get("operator") or "=")
    if op == "like" and val is not None:
        s = str(val)
        if s and "%" not in s:
            val = f"%{s}%"
    return [{"field": field, "operator": op, "value": val, "type": ftype}]


def _safe_sql_ident(name: str) -> str:
    """Allow simple column/table identifiers only."""
    if not name or not isinstance(name, str):
        return ""
    cleaned = name.replace('"', "").replace("'", "").replace(";", "")
    if not cleaned.replace(".", "").replace("_", "").isalnum():
        return ""
    return cleaned


def _ds_execution_dict(ds: Any, schema_info: dict) -> dict:
    """Full data-source dict for the query engine.

    Must include user_id/project_id/file_path so the engine can fetch a
    multi-sheet file from storage and register every sheet table — without them
    only the primary sheet loads and joins/filters on dimension tables fail with
    "table ... does not exist". Mirrors the chart execution path.
    """
    return {
        "id": str(ds.id),
        "type": ds.type,
        "db_type": getattr(ds, "db_type", None),
        "format": ds.format,
        "schema": schema_info,
        "connection_config": ds.connection_config,
        "project_id": str(ds.project_id) if getattr(ds, "project_id", None) else None,
        "user_id": str(ds.user_id) if getattr(ds, "user_id", None) else None,
        "file_path": getattr(ds, "file_path", None),
    }


def _resolve_table_for_field(
    schema_info: dict,
    field: str,
    table_name: Optional[str] = None,
) -> str:
    """Pick table containing ``field`` from schema; fall back to first table or ``data``."""
    if table_name:
        return table_name
    tables = schema_info.get("tables") or []
    safe_field = _safe_sql_ident(field)
    if safe_field:
        for t in tables:
            if not isinstance(t, dict):
                continue
            tname = str(t.get("name") or "data")
            for col in t.get("columns") or []:
                col_name = col if isinstance(col, str) else (col.get("name") if isinstance(col, dict) else None)
                if col_name and _safe_sql_ident(str(col_name)) == safe_field:
                    return tname
    if tables and isinstance(tables[0], dict):
        return str(tables[0].get("name") or "data")
    return "data"


def _table_column_names(schema_info: dict, table_name: Optional[str]) -> set[str]:
    """Return safe column identifiers for a schema table."""
    if not table_name:
        return set()
    target = _safe_sql_ident(str(table_name).split(".")[-1])
    names: set[str] = set()
    for table in schema_info.get("tables") or []:
        if not isinstance(table, dict):
            continue
        raw_name = str(table.get("name") or "")
        safe_name = _safe_sql_ident(raw_name)
        bare_name = _safe_sql_ident(raw_name.split(".")[-1])
        if safe_name != _safe_sql_ident(str(table_name)) and bare_name != target:
            continue
        for col in table.get("columns") or []:
            col_name = col if isinstance(col, str) else (col.get("name") if isinstance(col, dict) else None)
            safe_col = _safe_sql_ident(str(col_name or ""))
            if safe_col:
                names.add(safe_col)
        break
    return names


def _runtime_filters_for_table(runtime_filters: Optional[List[dict]], allowed_fields: set[str]) -> List[dict]:
    """Keep only cascade filters that can be applied to the target table."""
    if not runtime_filters or not allowed_fields:
        return []
    kept: List[dict] = []
    for rf in runtime_filters:
        if not isinstance(rf, dict):
            continue
        safe_field = _safe_sql_ident(str(rf.get("field") or ""))
        if safe_field in allowed_fields:
            kept.append(rf)
    return kept


def _build_cascade_where_for_options(
    runtime_filters: Optional[List[dict]], exclude_field: Optional[str]
) -> str:
    """Cascade for distinct-value queries — omit search/like filters so text search does not empty dropdowns."""
    if not runtime_filters:
        return ""
    trimmed = []
    for rf in runtime_filters:
        if not isinstance(rf, dict):
            continue
        op = str(rf.get("operator") or "=").lower()
        if op in ("like", "like_case", "search", "contains"):
            continue
        trimmed.append(rf)
    return _build_cascade_where(trimmed, exclude_field)


def _build_cascade_where(runtime_filters: Optional[List[dict]], exclude_field: Optional[str]) -> str:
    """Build AND clauses for cascading filter-options (excludes the target field)."""
    if not runtime_filters:
        return ""
    clauses: List[str] = []
    for rf in runtime_filters:
        if not isinstance(rf, dict):
            continue
        field = _safe_sql_ident(str(rf.get("field") or ""))
        if not field or field == _safe_sql_ident(exclude_field or ""):
            continue
        for entry in _normalize_filter_entry(rf):
            ef = _safe_sql_ident(str(entry.get("field") or ""))
            if not ef or ef == _safe_sql_ident(exclude_field or ""):
                continue
            op = str(entry.get("operator") or "=").lower()
            val = entry.get("value")
            if val is None or val == "":
                continue
            if op in ("=", "!=", ">", ">=", "<", "<="):
                if isinstance(val, (int, float)):
                    clauses.append(f'"{ef}" {op} {val}')
                else:
                    safe_v = str(val).replace("'", "''")
                    clauses.append(f'"{ef}" {op} \'{safe_v}\'')
            elif op in ("like", "like_case"):
                s = str(val).replace("'", "''")
                pattern = s if (s.startswith("%") or s.endswith("%")) else f"%{s}%"
                clauses.append(f'"{ef}" ILIKE \'{pattern}\'' if op == "like" else f'"{ef}" LIKE \'{pattern}\'')
            elif op in ("in", "not_in"):
                vals = val if isinstance(val, list) else [v.strip() for v in str(val).split(",")]
                formatted = []
                for v in vals:
                    if isinstance(v, (int, float)):
                        formatted.append(str(v))
                    else:
                        formatted.append(f"'{str(v).replace(chr(39), chr(39)+chr(39))}'")
                if formatted:
                    op_sql = "IN" if op == "in" else "NOT IN"
                    clauses.append(f'"{ef}" {op_sql} ({", ".join(formatted)})')
    return " AND ".join(clauses)


def merge_runtime_filters(chart_query: dict, runtime_filters: Optional[List[dict]]) -> dict:
    """Merge dashboard-level runtime filters into chart_query.filters.

    Runtime filters *replace* any existing filter on the same field — regardless
    of operator — so a dashboard-level date filter always wins over the chart's
    default.  The normalisation step (operator aliases, type coercion) is applied
    before de-duplication so the operator comparison is always apples-to-apples.
    """
    if not runtime_filters:
        return chart_query
    merged = dict(chart_query or {})
    existing = list(merged.get("filters") or [])
    for rf in runtime_filters:
        normalized = _normalize_filter_entry(rf)
        for entry in normalized:
            field = entry["field"]
            # Remove ALL existing filters for this field, then append the new one.
            # We match on field only (not operator) because the replace semantics
            # require that a runtime filter for "region" supersedes any previously
            # saved filter on "region", no matter what operator was used.
            existing = [f for f in existing if f.get("field") != field]
            existing.append(entry)
    merged["filters"] = existing
    return merged


def apply_drill_context(chart_query: dict, drill_context: Optional[dict]) -> dict:
    """Apply hierarchical drill-down: override x dimension and merge drill filters."""
    if not drill_context:
        return chart_query
    merged = dict(chart_query or {})
    drill_path = drill_context.get("drill_path") or merged.get("drillPath") or []
    if not drill_path:
        return merged
    level = int(drill_context.get("level") or 0)
    if level < 0:
        level = 0
    if level >= len(drill_path):
        level = len(drill_path) - 1
    merged["x"] = drill_path[level]
    drill_filters = drill_context.get("drill_filters")
    if drill_filters:
        merged = merge_runtime_filters(merged, drill_filters)
    return merged


async def verify_dashboard_read_access(
    db: AsyncSession,
    dashboard_id: UUID,
    *,
    current_user: Optional[dict] = None,
    embed_token: Optional[str] = None,
) -> Dashboard:
    """Allow access when user has RBAC, valid embed JWT, or dashboard is published public."""
    dash_svc = DashboardService(db)
    dashboard = await dash_svc.get_by_id(dashboard_id)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    config = dashboard.config if isinstance(dashboard.config, dict) else {}
    if config.get("is_public"):
        return dashboard

    if embed_token:
        if embed_token.startswith("eyJ"):
            try:
                from src.modules.embed import service as embed_service

                verified = await embed_service.verify_embed_token(
                    embed_token, required_scope="dashboard"
                )
                if verified and str(verified.get("resource_id") or verified.get("dashboard_id") or "") in (
                    "",
                    str(dashboard_id),
                ):
                    return dashboard
            except Exception as exc:
                logger.debug("Embed JWT verification failed: %s", exc)
        else:
            from src.modules.dashboards.models import DashboardEmbed

            res = await db.execute(
                select(DashboardEmbed).where(
                    DashboardEmbed.dashboard_id == dashboard_id,
                    DashboardEmbed.embed_token == embed_token,
                    DashboardEmbed.is_active.is_(True),
                )
            )
            if res.scalar_one_or_none():
                return dashboard

    if current_user:
        from src.shared.access_control import check_dashboard_access

        await check_dashboard_access(current_user, str(dashboard_id))
        return dashboard

    raise HTTPException(status_code=401, detail="Authentication or embed token required")


async def build_embed_payload(
    db: AsyncSession,
    dashboard_id: UUID,
    page_id: Optional[str] = None,
    runtime_filters: Optional[List[dict]] = None,
) -> Dict[str, Any]:
    """Build embed/share payload from dashboard_charts + saved layout."""
    import copy

    dash_svc = DashboardService(db)
    dashboard = await dash_svc.get_by_id(dashboard_id)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")

    config = dashboard.config if isinstance(dashboard.config, dict) else {}
    chart_svc = DashboardChartService(db)
    charts_with_layout = await chart_svc.list_charts_with_layout(dashboard_id)

    widgets: List[Dict[str, Any]] = []
    layouts: List[Dict[str, Any]] = []

    for chart, layout in charts_with_layout:
        layout_dict = layout if isinstance(layout, dict) else {}
        if page_id and str(layout_dict.get("page_id") or "") != str(page_id):
            continue
        chart_data = None
        exec_error: Optional[str] = None
        try:
            exec_chart = copy.deepcopy(chart)
            if runtime_filters:
                exec_chart.chart_query = merge_runtime_filters(
                    copy.deepcopy(chart.chart_query or {}), runtime_filters
                )
            chart_data = await chart_svc.chart_service.execute(exec_chart)
        except Exception as exec_err:
            exec_error = str(exec_err)[:300]
            logger.warning("Embed chart execute failed for %s: %s", chart.id, exec_err)

        chart_type = chart.chart_type or "bar"
        is_data_widget = chart_type not in ("text", "slicer", "filter") and chart.data_source_id
        if is_data_widget and not exec_error:
            if chart_data is None:
                exec_error = "No data returned"
            elif chart_type == "stat":
                has_value = isinstance(chart_data, dict) and (
                    chart_data.get("value") is not None
                    or (chart_data.get("y") and len(chart_data.get("y") or []) > 0)
                    or (
                        chart_data.get("series")
                        and isinstance((chart_data.get("series") or [None])[0], dict)
                        and ((chart_data.get("series") or [{}])[0].get("data") or [])
                    )
                )
                if not has_value:
                    exec_error = "KPI returned no value"
            elif isinstance(chart_data, dict):
                empty = not (
                    chart_data.get("series")
                    or chart_data.get("x")
                    or chart_data.get("y")
                    or chart_data.get("value")
                )
                if empty:
                    exec_error = "Chart returned no data"

        option = chart.chart_options if isinstance(chart.chart_options, dict) else {}
        if chart_data and not exec_error:
            option = {**option, **(chart_data if isinstance(chart_data, dict) else {})}

        widgets.append(
            {
                "id": str(chart.id),
                "title": chart.title,
                "type": chart_type,
                "chart_option": option,
                "echarts_option": option,
                "dataSourceId": str(chart.data_source_id) if chart.data_source_id else None,
                "chartQuery": chart.chart_query,
                "error": exec_error,
                "success": exec_error is None,
            }
        )
        grid = {
            "i": str(chart.id),
            "x": int(layout_dict.get("x", 0)),
            "y": int(layout_dict.get("y", 0)),
            "w": int(layout_dict.get("w", 4)),
            "h": int(layout_dict.get("h", 5)),
        }
        if layout_dict.get("page_id"):
            grid["page_id"] = str(layout_dict.get("page_id"))
        layouts.append(grid)

    return {
        "id": str(dashboard.id),
        "name": dashboard.name,
        "title": dashboard.name,
        "description": dashboard.description,
        "theme": config.get("theme", "light"),
        "global_filters": config.get("global_filters") or [],
        "default_page_id": config.get("default_page_id"),
        "widgets": widgets,
        "layout": layouts,
        "config": config,
    }


DASHBOARD_REFRESH_CONCURRENCY = int(os.getenv("DASHBOARD_REFRESH_CONCURRENCY", "4"))


async def refresh_dashboard_charts(
    db: AsyncSession,
    dashboard_id: UUID,
    chart_requests: List[Dict[str, Any]],
) -> Dict[str, Any]:
    """Execute multiple dashboard charts in one request (pooled connections, server-side concurrency cap)."""
    if not chart_requests:
        return {"results": [], "ok": 0, "failed": 0, "total": 0}

    chart_svc = DashboardChartService(db)
    sem = asyncio.Semaphore(DASHBOARD_REFRESH_CONCURRENCY)
    dedupe_cache: Dict[str, Dict[str, Any]] = {}

    async def _execute_one(req: Dict[str, Any]) -> Dict[str, Any]:
        chart_id = str(req.get("chart_id") or "").strip()
        widget_id = req.get("widget_id")
        runtime_filters = req.get("runtime_filters")
        drill_context = req.get("drill_context")
        if not chart_id:
            return {
                "chart_id": chart_id,
                "widget_id": widget_id,
                "success": False,
                "error": "chart_id required",
            }

        dedupe_key = f"{chart_id}:{hashlib.md5(json.dumps({'rf': runtime_filters or [], 'drill': drill_context or {}}, sort_keys=True, default=str).encode()).hexdigest()}"
        if dedupe_key in dedupe_cache:
            cached = dict(dedupe_cache[dedupe_key])
            cached["widget_id"] = widget_id
            cached["chart_id"] = chart_id
            return cached

        async with sem:
            try:
                chart = await chart_svc.get_chart(dashboard_id, UUID(chart_id))
                if not chart:
                    result: Dict[str, Any] = {
                        "chart_id": chart_id,
                        "widget_id": widget_id,
                        "success": False,
                        "error": "Chart not found",
                    }
                else:
                    exec_chart = chart
                    if runtime_filters or drill_context:
                        exec_chart = copy.deepcopy(chart)
                        base_query = copy.deepcopy(chart.chart_query or {})
                        if runtime_filters:
                            base_query = merge_runtime_filters(base_query, runtime_filters)
                        if drill_context:
                            base_query = apply_drill_context(base_query, drill_context)
                        exec_chart.chart_query = base_query
                    data = await chart_svc.chart_service.execute(exec_chart)
                    result = {
                        "chart_id": chart_id,
                        "widget_id": widget_id,
                        "success": True,
                        "data": data,
                    }
            except Exception as exc:
                logger.warning("Batch refresh failed for chart %s: %s", chart_id, exc)
                result = {
                    "chart_id": chart_id,
                    "widget_id": widget_id,
                    "success": False,
                    "error": str(exc),
                }

        dedupe_cache[dedupe_key] = result
        return result

    results = list(await asyncio.gather(*[_execute_one(req) for req in chart_requests]))
    ok = sum(1 for r in results if r.get("success"))
    failed = len(results) - ok
    return {"results": results, "ok": ok, "failed": failed, "total": len(results)}


async def get_filter_options(
    db: AsyncSession,
    dashboard_id: UUID,
    field: str,
    data_source_id: str,
    limit: int = 100,
    table_name: Optional[str] = None,
    runtime_filters: Optional[List[dict]] = None,
    exclude_field: Optional[str] = None,
) -> List[Any]:
    """Distinct values for slicer / global filter dropdowns, with optional cascade."""
    if not field or not data_source_id:
        return []
    from src.modules.data.models import DataSource

    ds = await db.get(DataSource, data_source_id)
    if not ds:
        return []

    safe_field = _safe_sql_ident(field)
    if not safe_field:
        return []

    schema_info = ds.schema if isinstance(ds.schema, dict) else {}
    table = _resolve_table_for_field(schema_info, field, table_name)
    safe_table = _safe_sql_ident(str(table))
    if not safe_table:
        return []

    table_fields = _table_column_names(schema_info, table)
    cascade_filters = _runtime_filters_for_table(runtime_filters, table_fields)
    cascade = _build_cascade_where_for_options(cascade_filters, exclude_field or field)
    where_parts = [f'"{safe_field}" IS NOT NULL']
    if cascade:
        where_parts.append(f"({cascade})")
    where_sql = " AND ".join(where_parts)

    query = (
        f'SELECT DISTINCT "{safe_field}" AS v FROM "{safe_table}" '
        f"WHERE {where_sql} ORDER BY v LIMIT {int(limit)}"
    )
    try:
        ds_dict = _ds_execution_dict(ds, schema_info)
        from src.modules.data.services.multi_engine_query_service import get_multi_engine_query_service

        engine = get_multi_engine_query_service()
        result = await engine.execute_query(query, ds_dict, {})
        rows = result.get("data") or result.get("rows") or []
        if isinstance(rows, list):
            return [r.get("v") if isinstance(r, dict) else r for r in rows]
    except Exception as e:
        logger.warning("filter-options query failed: %s", e)
    return []


async def get_filter_field_stats(
    db: AsyncSession,
    dashboard_id: UUID,
    field: str,
    data_source_id: str,
    table_name: Optional[str] = None,
    runtime_filters: Optional[List[dict]] = None,
) -> dict:
    """Min/max numeric bounds for slider filters and numeric slicers."""
    if not field or not data_source_id:
        return {"min": None, "max": None}
    from src.modules.data.models import DataSource

    ds = await db.get(DataSource, data_source_id)
    if not ds:
        return {"min": None, "max": None}

    safe_field = _safe_sql_ident(field)
    if not safe_field:
        return {"min": None, "max": None}

    schema_info = ds.schema if isinstance(ds.schema, dict) else {}
    table = _resolve_table_for_field(schema_info, field, table_name)
    safe_table = _safe_sql_ident(str(table))
    if not safe_table:
        return {"min": None, "max": None}

    table_fields = _table_column_names(schema_info, table)
    cascade_filters = _runtime_filters_for_table(runtime_filters, table_fields)
    cascade = _build_cascade_where_for_options(cascade_filters, field)
    where_parts = [f'"{safe_field}" IS NOT NULL']
    if cascade:
        where_parts.append(f"({cascade})")
    where_sql = " AND ".join(where_parts)

    query = (
        f'SELECT MIN("{safe_field}") AS mn, MAX("{safe_field}") AS mx '
        f'FROM "{safe_table}" WHERE {where_sql}'
    )

    def _serialize_stat_value(value: Any) -> Any:
        if value is None:
            return None
        if isinstance(value, (int, float)):
            return float(value)
        if hasattr(value, "isoformat"):
            return value.isoformat()
        try:
            return float(value)
        except (TypeError, ValueError):
            return str(value)

    try:
        ds_dict = _ds_execution_dict(ds, schema_info)
        from src.modules.data.services.multi_engine_query_service import get_multi_engine_query_service

        engine = get_multi_engine_query_service()
        result = await engine.execute_query(query, ds_dict, {})
        rows = result.get("data") or result.get("rows") or []
        if isinstance(rows, list) and rows:
            row = rows[0] if isinstance(rows[0], dict) else {}
            mn = row.get("mn")
            mx = row.get("mx")
            if mn is None and mx is None:
                return {"min": None, "max": None}
            return {"min": _serialize_stat_value(mn), "max": _serialize_stat_value(mx)}
    except Exception as e:
        logger.warning("filter-field-stats query failed: %s", e)
    return {"min": None, "max": None}


async def share_dashboard(
    db: AsyncSession,
    dashboard_id: UUID,
    shared_by: str,
    shared_with: Optional[str],
    permission: str = "view",
) -> dict:
    share = DashboardShare(
        id=uuid_lib.uuid4(),
        dashboard_id=dashboard_id,
        shared_by=UUID(shared_by) if _is_uuid(shared_by) else shared_by,
        shared_with=UUID(shared_with) if shared_with and _is_uuid(shared_with) else shared_with,
        permission=permission,
        share_token=f"share_{uuid_lib.uuid4().hex[:16]}",
        is_active=True,
    )
    db.add(share)
    await db.commit()
    await db.refresh(share)
    return {
        "id": str(share.id),
        "dashboard_id": str(dashboard_id),
        "share_token": share.share_token,
        "permission": share.permission,
    }


async def publish_dashboard(db: AsyncSession, dashboard_id: UUID, make_public: bool) -> dict:
    dash_svc = DashboardService(db)
    dashboard = await dash_svc.get_by_id(dashboard_id)
    if not dashboard:
        raise HTTPException(status_code=404, detail="Dashboard not found")
    config = dict(dashboard.config or {})
    config["is_public"] = bool(make_public)
    await dash_svc.update(dashboard, {"config": config})
    return {"success": True, "dashboard_id": str(dashboard_id), "is_public": make_public}


async def export_dashboard(
    dashboard_id: str,
    export_format: str,
    request: Request,
) -> dict:
    export_format = (export_format or "png").lower()
    if export_format not in ("png", "pdf", "html"):
        raise HTTPException(status_code=400, detail=f"Unsupported format: {export_format}")

    base_url = str(request.base_url).rstrip("/")
    dashboard_url = f"{base_url}/embed/dashboard/{dashboard_id}"

    exports_dir = os.path.join(os.getcwd(), "exports")
    os.makedirs(exports_dir, exist_ok=True)
    export_filename = f"dashboard_{dashboard_id}_{int(time.time())}.{export_format}"
    export_path = os.path.join(exports_dir, export_filename)

    try:
        from playwright.async_api import async_playwright

        async with async_playwright() as pw:
            browser = await pw.chromium.launch(args=["--no-sandbox", "--disable-setuid-sandbox"])
            page = await browser.new_page(viewport={"width": 1400, "height": 900})
            await page.goto(dashboard_url, wait_until="networkidle", timeout=30000)
            await page.wait_for_timeout(2000)
            if export_format == "png":
                await page.screenshot(path=export_path, full_page=True)
            elif export_format == "pdf":
                await page.pdf(path=export_path, format="A4", print_background=True)
            else:
                content = await page.content()
                with open(export_path, "w", encoding="utf-8") as f:
                    f.write(content)
            await browser.close()
        file_size = os.path.getsize(export_path)
        return {
            "success": True,
            "export_url": f"/exports/{export_filename}",
            "file_size": file_size,
            "format": export_format,
        }
    except ImportError:
        return {
            "success": True,
            "export_url": dashboard_url,
            "file_size": 0,
            "format": export_format,
            "message": "Playwright not installed; use client-side export",
        }


def get_plan_limits(plan: str = "free") -> dict:
    limits = PLAN_LIMITS.get(plan, PLAN_LIMITS["free"])
    return {"plan": plan, "limits": limits}


async def _resolve_plan_limits(user_id: str, db: AsyncSession) -> dict:
    """Resolve effective dashboard plan limits for the user's organization."""
    from src.core.edition import is_ee_enabled

    if not is_ee_enabled():
        return PLAN_LIMITS["free"]

    try:
        from src.modules.billing.models import OrganizationSubscription, SubscriptionPlan
        from src.modules.pricing.usage_tracker import resolve_organization_id
        from src.modules.pricing.plans import PLAN_CONFIGS
        from sqlalchemy import select, and_, or_ as _or
        from datetime import datetime, timezone

        org_id = await resolve_organization_id(user_id, db)
        if not org_id:
            return PLAN_CONFIGS.get("free", PLAN_LIMITS["free"])

        now = datetime.now(timezone.utc)
        plan_stmt = (
            select(SubscriptionPlan.limits, SubscriptionPlan.slug)
            .join(OrganizationSubscription, OrganizationSubscription.plan_id == SubscriptionPlan.id)
            .where(
                and_(
                    OrganizationSubscription.organization_id == org_id,
                    _or(
                        OrganizationSubscription.status.in_(["active", "trialing"]),
                        and_(
                            OrganizationSubscription.status == "canceled",
                            OrganizationSubscription.current_period_end > now,
                        ),
                    ),
                )
            )
            .limit(1)
        )
        row = (await db.execute(plan_stmt)).first()
        if not row:
            return PLAN_CONFIGS.get("free", PLAN_LIMITS["free"])
        limits, slug = row
        base = PLAN_CONFIGS.get(slug, PLAN_LIMITS.get(slug, PLAN_LIMITS["free"]))
        if isinstance(limits, dict):
            return {**base, **limits}
        return base
    except Exception as exc:
        logger.debug("Plan limit resolution failed, using free defaults: %s", exc)
        return PLAN_LIMITS["free"]


async def enforce_dashboard_create_limit(db: AsyncSession, user_id: str, project_id: Optional[UUID] = None) -> None:
    """Raise 403 when org has reached max_dashboards for its plan."""
    from src.core.edition import is_ee_enabled

    if not is_ee_enabled():
        return

    limits = await _resolve_plan_limits(user_id, db)
    max_dashboards = limits.get("max_dashboards", -1)
    if max_dashboards is None or max_dashboards < 0:
        return

    from sqlalchemy import func, select

    stmt = select(func.count()).select_from(Dashboard)
    if project_id:
        stmt = stmt.where(Dashboard.project_id == project_id)
    count = (await db.execute(stmt)).scalar() or 0
    if count >= max_dashboards:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "dashboard_limit_reached",
                "message": f"Reached your plan limit of {max_dashboards} dashboards",
                "limit": max_dashboards,
                "current": count,
            },
        )


async def enforce_widget_create_limit(db: AsyncSession, dashboard_id: UUID, user_id: str) -> None:
    """Raise 403 when dashboard has reached max_widgets_per_dashboard for its plan."""
    from src.core.edition import is_ee_enabled

    if not is_ee_enabled():
        return

    limits = await _resolve_plan_limits(user_id, db)
    max_widgets = limits.get("max_widgets_per_dashboard", -1)
    if max_widgets is None or max_widgets < 0:
        return

    from sqlalchemy import func, select

    stmt = (
        select(func.count())
        .select_from(DashboardChart)
        .where(DashboardChart.dashboard_id == dashboard_id)
    )
    count = (await db.execute(stmt)).scalar() or 0
    if count >= max_widgets:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "widget_limit_reached",
                "message": f"Reached your plan limit of {max_widgets} widgets per dashboard",
                "limit": max_widgets,
                "current": count,
            },
        )


async def assert_widget_quota_for_batch(
    db: AsyncSession,
    dashboard_id: UUID,
    user_id: str,
    batch_size: int,
) -> None:
    """Raise 403 when the dashboard cannot accept `batch_size` more widgets."""
    from src.core.edition import is_ee_enabled

    if not is_ee_enabled() or batch_size <= 0:
        return

    limits = await _resolve_plan_limits(user_id, db)
    max_widgets = limits.get("max_widgets_per_dashboard", -1)
    if max_widgets is None or max_widgets < 0:
        return

    from sqlalchemy import func, select

    stmt = (
        select(func.count())
        .select_from(DashboardChart)
        .where(DashboardChart.dashboard_id == dashboard_id)
    )
    count = (await db.execute(stmt)).scalar() or 0
    if count + batch_size > max_widgets:
        raise HTTPException(
            status_code=403,
            detail={
                "error": "widget_limit_reached",
                "message": (
                    f"Cannot add {batch_size} widgets — plan limit is {max_widgets} "
                    f"({count} already on this dashboard)"
                ),
                "limit": max_widgets,
                "current": count,
                "requested": batch_size,
            },
        )


def _is_uuid(value: str) -> bool:
    try:
        UUID(str(value))
        return True
    except (ValueError, TypeError):
        return False
