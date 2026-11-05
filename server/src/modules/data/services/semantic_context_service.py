"""
Unified semantic context: relationships, metrics, dimensions.

Single source used by chart execution, NL2SQL hints, and Platform Services.
"""

from __future__ import annotations

import copy
import logging
import re
from typing import Any, Dict, List, Optional

from sqlalchemy import select, text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.data.models import DataModelRelationship, DataSource

logger = logging.getLogger(__name__)

_FIELD_EXPR = re.compile(r"^[a-zA-Z0-9_().,\"'\s*+\-/]+$")


async def list_modeled_join_paths(db: AsyncSession, data_source_id: str) -> List[Dict[str, str]]:
    """Return persisted data-model relationships as join path dicts."""
    if not data_source_id:
        return []
    try:
        result = await db.execute(
            select(DataModelRelationship)
            .where(DataModelRelationship.data_source_id == data_source_id)
            .order_by(DataModelRelationship.created_at.asc())
        )
        return [
            {
                "from_table": r.from_table,
                "from_column": r.from_column,
                "to_table": r.to_table,
                "to_column": r.to_column,
                "join_type": r.join_type or "LEFT",
            }
            for r in result.scalars().all()
        ]
    except Exception as exc:
        logger.debug("list_modeled_join_paths failed: %s", exc)
        return []


def format_join_paths_for_prompt(join_paths: List[Dict[str, str]], limit: int = 15) -> str:
    if not join_paths:
        return ""
    parts = []
    for j in join_paths[:limit]:
        jt = j.get("join_type", "LEFT")
        parts.append(
            f"{jt} JOIN {j['to_table']} ON {j['from_table']}.{j['from_column']} = {j['to_table']}.{j['to_column']}"
        )
    return "Modeled joins: " + "; ".join(parts) + "."


async def _fetch_semantic_metric(db: AsyncSession, metric_id: str) -> Optional[Dict[str, Any]]:
    try:
        result = await db.execute(
            sa_text(
                "SELECT id, name, expression, description, certified, metric_type "
                "FROM semantic_metrics WHERE id = :id AND is_active = true LIMIT 1"
            ),
            {"id": metric_id},
        )
        row = result.fetchone()
        if not row:
            return None
        keys = result.keys()
        return dict(zip(keys, row))
    except Exception:
        return None


async def _fetch_semantic_dimensions(db: AsyncSession, dim_ids: List[str]) -> List[Dict[str, Any]]:
    if not dim_ids:
        return []
    try:
        placeholders = ", ".join(f":id{i}" for i in range(len(dim_ids)))
        params = {f"id{i}": dim_ids[i] for i in range(len(dim_ids))}
        result = await db.execute(
            sa_text(
                f"SELECT id, name, expression, description FROM semantic_dimensions "
                f"WHERE id IN ({placeholders}) AND is_active = true"
            ),
            params,
        )
        rows = result.fetchall()
        keys = result.keys()
        return [dict(zip(keys, row)) for row in rows]
    except Exception:
        return []


async def resolve_semantic_chart_query(
    db: AsyncSession,
    chart_query: Optional[Dict[str, Any]],
    user_id: Optional[str] = None,
    organization_id: Optional[str] = None,
) -> Dict[str, Any]:
    """
    Resolve semantic_metric_id and semantic_dimension_ids to current expressions
    at chart execution time (dbt/Cube-style reference-by-id).
    A bound metric (official or draft: the widget chose it) compiles through SemanticQueryCompiler,
    so the card runs the model's current definition with its joins and calendar.
    """
    cq = copy.deepcopy(chart_query or {})
    metric_id = cq.get("semantic_metric_id")
    data_source_id = cq.get("data_source_id")

    if metric_id and data_source_id:
        try:
            from src.enterprise.modules.semantic.compiler import SemanticQueryCompiler
            from src.enterprise.modules.semantic.query_spec import SemanticQuerySpec

            ctx = await get_unified_semantic_context(db, str(data_source_id))
            metric = await _fetch_semantic_metric(db, str(metric_id))
            if metric:
                dim_keys = [str(i) for i in (cq.get("semantic_dimension_ids") or [])]
                spec = SemanticQuerySpec(
                    data_source_id=str(data_source_id),
                    metric=str(metric.get("name") or metric_id),
                    dimensions=dim_keys,
                    limit=int(cq.get("limit") or 5000),
                )
                from src.enterprise.modules.semantic.rls import rls_filters_for_user

                ds_row = await db.get(DataSource, str(data_source_id))
                schema_info = (ds_row.schema if ds_row and isinstance(ds_row.schema, dict) else {}) or {}
                dialect = (ds_row.db_type or ds_row.type or "postgres") if ds_row else "postgres"
                if ds_row and str(ds_row.type or "").lower() == "file":
                    from src.enterprise.modules.ai.utils.schema_normalization import file_schema_with_tables

                    schema_info = file_schema_with_tables(schema_info, ds_row.name or "")
                    dialect = "file"
                rls_filters = await rls_filters_for_user(user_id, organization_id, str(data_source_id))
                compiler = SemanticQueryCompiler(
                    metrics=ctx.get("metrics") or [],
                    dimensions=ctx.get("dimensions") or [],
                    join_paths=ctx.get("join_paths") or [],
                    schema_info=schema_info,
                    dialect=dialect,
                    rls_filters=rls_filters,
                    calendar=ctx.get("calendar") or {},
                )
                compiled = compiler.compile(spec)
                cq["compiled_semantic_sql"] = compiled.sql
                cq["aggregate"] = True
                return cq
        except Exception as exc:
            logger.debug("semantic compiler path skipped: %s", exc)

    if metric_id:
        metric = await _fetch_semantic_metric(db, str(metric_id))
        if metric and metric.get("expression"):
            expr = str(metric["expression"]).strip()
            if expr and _FIELD_EXPR.match(expr):
                cq["yMetrics"] = [{"field": expr, "aggregation": "sum", "label": metric.get("name")}]
                cq["aggregate"] = True

    dim_ids = cq.get("semantic_dimension_ids")
    if isinstance(dim_ids, list) and dim_ids:
        dims = await _fetch_semantic_dimensions(db, [str(i) for i in dim_ids])
        if dims:
            first_expr = str(dims[0].get("expression") or "").strip()
            if first_expr and _FIELD_EXPR.match(first_expr):
                cq["x"] = first_expr

    return cq


def infer_primary_table_sql(schema_info: Dict[str, Any], data_source_id: Optional[str] = None) -> str:
    """Best-effort base table SQL for Cube export."""
    if not isinstance(schema_info, dict):
        return "SELECT 1"
    tables = schema_info.get("tables") or []
    if tables and isinstance(tables[0], dict) and tables[0].get("name"):
        schema = tables[0].get("schema") or schema_info.get("schema") or "public"
        name = tables[0]["name"]
        return f"SELECT * FROM {schema}.{name}"
    if schema_info.get("table"):
        schema = schema_info.get("schema") or "public"
        return f"SELECT * FROM {schema}.{schema_info['table']}"
    return "SELECT 1"


async def _load_supplemental_metrics(
    db: AsyncSession,
    data_source_id: Optional[str],
    existing_names: set,
    certified_count: int,
) -> tuple[List[Dict[str, Any]], List[Dict[str, Any]]]:
    """Merge domain-template and org KPI definitions as non-certified supplements."""
    extra_metrics: List[Dict[str, Any]] = []
    extra_dims: List[Dict[str, Any]] = []
    if not data_source_id:
        return extra_metrics, extra_dims
    _ = certified_count  # retained for callers; supplements merge regardless

    try:
        ds = await db.get(DataSource, data_source_id)
        if not ds:
            return extra_metrics, extra_dims
        cfg = ds.connection_config or {}
        if isinstance(cfg, str):
            import json
            try:
                cfg = json.loads(cfg)
            except Exception:
                cfg = {}
        domain_id = (cfg.get("domain_template") if isinstance(cfg, dict) else None) or getattr(ds, "domain_template", None)
        if domain_id:
            from src.modules.ai.domain_templates.registry import get_domain_template
            tmpl = get_domain_template(str(domain_id))
            if tmpl:
                for m in tmpl.get("measures") or []:
                    name = str(m)
                    if name in existing_names:
                        continue
                    existing_names.add(name)
                    extra_metrics.append({
                        "id": f"domain:{domain_id}:{name}",
                        "name": name,
                        "expression": name,
                        "description": f"Domain template ({domain_id}) measure",
                        "category": domain_id,
                        "source": "domain",
                        "certified": False,
                    })
                for d in tmpl.get("dimensions") or []:
                    dname = str(d)
                    extra_dims.append({
                        "id": f"domain:{domain_id}:{dname}",
                        "name": dname,
                        "expression": dname,
                        "description": f"Domain template ({domain_id}) dimension",
                        "source": "domain",
                        "certified": False,
                    })
        # Organization metric definitions are certified semantic metrics on their connection, so they
        # arrive with this connection's own metrics above; nothing is added twice here.
        # Core dimensions (date, customer, legal entity…) defined once for the organization, where
        # this connection can join to them.
        if getattr(ds, "organization_id", None):
            from src.modules.semantic_domains.core import core_dimensions

            for dim in await core_dimensions(db, str(ds.organization_id), str(data_source_id)):
                if dim["availability"] == "needs_lakehouse" or dim["name"] in {d.get("name") for d in extra_dims}:
                    continue
                extra_dims.append({
                    "id": dim["id"],
                    "name": dim["name"],
                    "expression": dim["expression"] or dim["name"],
                    "description": dim["description"] or "Core dimension",
                    "source": "core",
                    "certified": True,
                })
    except Exception as exc:
        logger.debug("_load_supplemental_metrics: %s", exc)
    return extra_metrics, extra_dims


def describe_metric_format(fmt: Optional[str]) -> Optional[str]:
    """How a metric's values should be read out: "currency USD", "a percentage" and so on.

    Formats are kind[:code][:decimals], e.g. currency:USD:2, percent:1, number:0, integer.
    Percent values are fractions (0.25 is 25%).
    """
    parts = str(fmt or "").strip().split(":")
    kind = parts[0].lower()
    if kind == "currency":
        code = parts[1].upper() if len(parts) > 1 and parts[1] else ""
        return f"currency {code}".strip()
    if kind == "percent":
        return "a percentage (the value is a fraction: 0.25 means 25%)"
    if kind == "integer":
        return "a whole number"
    return None


async def get_unified_semantic_context(
    db: AsyncSession,
    data_source_id: Optional[str] = None,
    project_id: Optional[str] = None,
) -> Dict[str, Any]:
    """Metrics, dimensions, and modeled joins for NL2SQL / platform UI."""
    metrics: List[Dict[str, Any]] = []
    dimensions: List[Dict[str, Any]] = []
    join_paths: List[Dict[str, str]] = []
    certified_count = 0

    if data_source_id:
        join_paths = await list_modeled_join_paths(db, data_source_id)

    try:
        conditions_m = ["is_active = true"]
        conditions_d = ["is_active = true"]
        params: Dict[str, Any] = {}
        if data_source_id:
            conditions_m.append("data_source_id = :ds_id")
            conditions_d.append("data_source_id = :ds_id")
            params["ds_id"] = data_source_id
        if project_id:
            conditions_m.append("(project_id = :proj_id OR project_id IS NULL)")
            conditions_d.append("(project_id = :proj_id OR project_id IS NULL)")
            params["proj_id"] = project_id

        m_where = " AND ".join(conditions_m)
        d_where = " AND ".join(conditions_d)

        m_res = await db.execute(
            sa_text(
                f"SELECT id, name, expression, description, category, certified, metric_type, source, format, "
                f"COALESCE(type_params->'synonyms', '[]'::jsonb) AS synonyms "
                f"FROM semantic_metrics WHERE {m_where} ORDER BY certified DESC, name LIMIT 50"
            ),
            params,
        )
        metrics = [dict(zip(m_res.keys(), row)) for row in m_res.fetchall()]
        certified_count = sum(1 for m in metrics if m.get("certified"))

        d_res = await db.execute(
            sa_text(
                f"SELECT id, name, expression, description, certified, dimension_type, default_grain "
                f"FROM semantic_dimensions WHERE {d_where} ORDER BY name LIMIT 50"
            ),
            params,
        )
        dimensions = [dict(zip(d_res.keys(), row)) for row in d_res.fetchall()]
    except Exception as exc:
        logger.debug("get_unified_semantic_context semantic tables: %s", exc)

    certified_count = sum(1 for m in metrics if m.get("certified"))
    existing_names = {m.get("name") for m in metrics if m.get("name")}
    sup_m, sup_d = await _load_supplemental_metrics(db, data_source_id, existing_names, certified_count)
    if sup_m:
        metrics.extend(sup_m)
    if sup_d:
        # The connection's own definition wins over a supplement of the same name.
        own = {d.get("name") for d in dimensions}
        dimensions.extend(d for d in sup_d if d.get("name") not in own)

    # Time is a dimension type; the organization calendar (Core domain) sets fiscal year and week start.
    time_dimensions = [d for d in dimensions if str(d.get("dimension_type") or "") == "time"]
    calendar: Dict[str, Any] = {}
    if data_source_id:
        from src.modules.semantic_domains.core import org_calendar

        calendar = await org_calendar(db, data_source_id)

    # ── Build structured, actionable prompt_hint ─────────────────────────────
    # Certified metrics are highest-trust SQL expressions — inject them as
    # explicit snippets the LLM MUST use when the user asks for that concept.
    # Non-certified metrics are suggestions only.
    certified = [m for m in metrics if m.get("certified")]
    uncertified = [m for m in metrics if not m.get("certified")]

    prompt_sections: List[str] = []

    if certified:
        def _named(m: Dict[str, Any]) -> str:
            also = [w for w in (m.get("synonyms") or []) if isinstance(w, str) and w.strip()][:4]
            notes = [f"also called {', '.join(also)}"] if also else []
            shown = describe_metric_format(m.get("format"))
            if shown:
                notes.append(f"report as {shown}")
            return f"{m['name']} ({'; '.join(notes)})" if notes else m["name"]

        sql_snippets = "; ".join(
            f"{_named(m)}: {m['expression']}" for m in certified[:10]
        )
        prompt_sections.append(
            f"CERTIFIED METRICS — use these exact SQL expressions when asked for these KPIs: {sql_snippets}."
        )

    if uncertified:
        names = ", ".join(
            f"{m['name']}={m['expression']}" for m in uncertified[:8]
        )
        prompt_sections.append(f"Additional inferred metrics (use as reference): {names}.")

    if dimensions:
        dim_parts = []
        for d in dimensions[:12]:
            entry = d["name"]
            expr = (d.get("expression") or "").strip()
            if expr and expr != d["name"]:
                entry += f"={expr}"
            dim_parts.append(entry)
        prompt_sections.append("Grouping dimensions: " + ", ".join(dim_parts) + ".")

    if time_dimensions:
        ts_parts = [
            f"{d['name']}={d.get('expression') or d['name']} (default grain: {d.get('default_grain') or 'day'})"
            for d in time_dimensions[:4]
        ]
        months = ["January", "February", "March", "April", "May", "June", "July", "August", "September",
                  "October", "November", "December"]
        start = int(calendar.get("fiscal_year_start_month") or 1)
        cal_note = (f" The fiscal year starts in {months[start - 1]}." if start != 1 else "") + (
            " Weeks start on Sunday." if calendar.get("week_start") == "sunday" else "")
        prompt_sections.append(
            "Time dimensions for trend analysis: " + ", ".join(ts_parts) + ". "
            "Use DATE_TRUNC(grain, column) for time bucketing." + cal_note
        )

    if join_paths:
        join_sql_parts = [
            f"{j['from_table']}.{j['from_column']} → {j['to_table']}.{j['to_column']} "
            f"[{j.get('join_type', 'LEFT')} JOIN]"
            for j in join_paths[:10]
        ]
        prompt_sections.append(
            "Modeled table relationships (use these for JOINs): " + "; ".join(join_sql_parts) + "."
        )

    prompt_hint = " ".join(prompt_sections)

    return {
        "metrics": metrics,
        "dimensions": dimensions,
        "join_paths": join_paths,
        "time_dimensions": time_dimensions,
        "calendar": calendar,
        "total_metrics": len(metrics),
        "total_dimensions": len(dimensions),
        "total_joins": len(join_paths),
        "certified_metric_count": certified_count,
        "certified_metrics": certified,
        "prompt_hint": prompt_hint,
    }
