"""
Unified semantic context: relationships, metrics, dimensions.

Single source used by chart execution, NL2SQL hints, and Platform Services.
"""

from __future__ import annotations

import copy
import json
import logging
import re
from typing import Any, Dict, List, Optional

from sqlalchemy import select, text as sa_text
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.data.models import DataModelRelationship, DataSource

logger = logging.getLogger(__name__)

_FIELD_EXPR = re.compile(r"^[a-zA-Z0-9_().,\"'\s*+\-/]+$")


def _table_name_from_source_ref(source_ref: Any) -> Optional[str]:
    """Derive the YAML semantic table name from source_ref=/.../<table>.yml."""
    if not source_ref:
        return None
    leaf = str(source_ref).rstrip("/").split("/")[-1]
    if leaf.endswith((".yml", ".yaml")):
        return leaf.rsplit(".", 1)[0]
    return None


def _table_name_from_expression(expression: Any) -> Optional[str]:
    if not expression:
        return None
    match = re.search(r"\b([A-Za-z_][A-Za-z0-9_]*)\s*\.\s*[A-Za-z_][A-Za-z0-9_]*\b", str(expression))
    return match.group(1) if match else None


def _normalize_semantic_rows(rows: List[Dict[str, Any]]) -> List[Dict[str, Any]]:
    for row in rows:
        raw_params = row.get("type_params")
        if isinstance(raw_params, str):
            try:
                row["type_params"] = json.loads(raw_params)
            except Exception:
                row["type_params"] = {}
        table_name = (
            (row.get("type_params") or {}).get("table")
            if isinstance(row.get("type_params"), dict)
            else None
        ) or _table_name_from_source_ref(row.get("source_ref")) or _table_name_from_expression(row.get("expression"))
        if table_name:
            row["table_name"] = str(table_name)
        if isinstance(row.get("type_params"), dict):
            params = row["type_params"]
            if params.get("ai_context"):
                row["ai_context"] = str(params["ai_context"])
            if isinstance(params.get("drill_fields"), list):
                row["drill_fields"] = [str(v) for v in params["drill_fields"]]
    return rows


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
                "cardinality": r.cardinality or "one_to_many",
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
                "SELECT id, name, expression, description, certified, metric_type, source_ref, type_params "
                "FROM semantic_metrics WHERE id = :id AND is_active = true LIMIT 1"
            ),
            {"id": metric_id},
        )
        row = result.fetchone()
        if not row:
            return None
        keys = result.keys()
        return _normalize_semantic_rows([dict(zip(keys, row))])[0]
    except Exception:
        return None


async def _fetch_semantic_metric_by_name(
    db: AsyncSession, data_source_id: str, metric_name: str
) -> Optional[Dict[str, Any]]:
    try:
        result = await db.execute(
            sa_text(
                "SELECT id, name, expression, description, certified, metric_type, source_ref, type_params "
                "FROM semantic_metrics "
                "WHERE data_source_id = :ds AND name = :name AND is_active = true "
                "ORDER BY certified DESC LIMIT 1"
            ),
            {"ds": data_source_id, "name": metric_name},
        )
        row = result.fetchone()
        if not row:
            return None
        return _normalize_semantic_rows([dict(zip(result.keys(), row))])[0]
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
                f"SELECT id, name, expression, description, source_ref FROM semantic_dimensions "
                f"WHERE id IN ({placeholders}) AND is_active = true"
            ),
            params,
        )
        rows = result.fetchall()
        keys = result.keys()
        return _normalize_semantic_rows([dict(zip(keys, row)) for row in rows])
    except Exception:
        return []


async def _fetch_semantic_dimensions_by_names(
    db: AsyncSession, data_source_id: str, names: List[str]
) -> List[Dict[str, Any]]:
    if not names:
        return []
    try:
        placeholders = ", ".join(f":name{i}" for i in range(len(names)))
        params = {f"name{i}": names[i] for i in range(len(names))}
        params["ds"] = data_source_id
        result = await db.execute(
            sa_text(
                f"SELECT id, name, expression, description, source_ref FROM semantic_dimensions "
                f"WHERE data_source_id = :ds AND name IN ({placeholders}) AND is_active = true"
            ),
            params,
        )
        return _normalize_semantic_rows([dict(zip(result.keys(), row)) for row in result.fetchall()])
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
    When a certified metric is bound, compile through SemanticQueryCompiler when possible.
    """
    cq = copy.deepcopy(chart_query or {})
    metric_id = cq.get("semantic_metric_id")
    metric_name = cq.get("semantic_metric_name")
    data_source_id = cq.get("data_source_id")

    if (metric_id or metric_name) and data_source_id:
        try:
            from ee.modules.semantic.compiler import SemanticQueryCompiler
            from ee.modules.semantic.query_spec import SemanticFilter, SemanticQuerySpec

            ctx = await get_unified_semantic_context(db, str(data_source_id))
            metric = (
                await _fetch_semantic_metric(db, str(metric_id))
                if metric_id
                else await _fetch_semantic_metric_by_name(db, str(data_source_id), str(metric_name))
            )
            if metric and metric.get("certified"):
                dim_keys = [str(i) for i in (cq.get("semantic_dimension_ids") or [])]
                if not dim_keys and cq.get("semantic_dimension_names"):
                    dim_names = [str(i) for i in (cq.get("semantic_dimension_names") or [])]
                    dim_rows = await _fetch_semantic_dimensions_by_names(db, str(data_source_id), dim_names)
                    dim_keys = [str(d.get("name") or d.get("id")) for d in dim_rows if d.get("name") or d.get("id")]
                filters = [
                    SemanticFilter(
                        field=str(f["field"]),
                        operator=str(f.get("operator") or f.get("op") or "eq"),
                        value=f.get("value"),
                    )
                    for f in (cq.get("filters") or [])
                    if isinstance(f, dict) and f.get("field")
                ]
                spec = SemanticQuerySpec(
                    data_source_id=str(data_source_id),
                    metric=str(metric.get("name") or metric_id),
                    dimensions=dim_keys,
                    filters=filters,
                    time_grain=cq.get("time_grain") or cq.get("xGrain"),
                    limit=int(cq.get("limit") or 5000),
                )
                from ee.modules.semantic.rls import rls_filters_for_user

                ds_row = await db.get(DataSource, str(data_source_id))
                schema_info = (ds_row.schema if ds_row and isinstance(ds_row.schema, dict) else {}) or {}
                dialect = (ds_row.db_type or ds_row.type or "postgres") if ds_row else "postgres"
                rls_filters = await rls_filters_for_user(user_id, organization_id, str(data_source_id))
                compiler = SemanticQueryCompiler(
                    metrics=ctx.get("metrics") or [],
                    dimensions=ctx.get("dimensions") or [],
                    join_paths=ctx.get("join_paths") or [],
                    schema_info=schema_info,
                    dialect=dialect,
                    rls_filters=rls_filters,
                    time_spines=ctx.get("time_spines") or [],
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
        org_id = getattr(ds, "organization_id", None)
        if org_id:
            from ee.modules.ai.services.kpi_memory_service import _fetch_matching_definitions
            kpis = await _fetch_matching_definitions(
                organization_id=str(org_id),
                query="",
                data_source_id=data_source_id,
                db_session=db,
                limit=12,
            )
            for k in kpis or []:
                name = k.get("kpi_name") or k.get("name")
                if not name or name in existing_names:
                    continue
                existing_names.add(name)
                extra_metrics.append({
                    "id": f"kpi:{org_id}:{name}",
                    "name": name,
                    "expression": k.get("sql_expression") or name,
                    "description": "Org-verified KPI",
                    "source": "kpi",
                    "certified": False,
                })
    except Exception as exc:
        logger.debug("_load_supplemental_metrics: %s", exc)
    return extra_metrics, extra_dims


async def list_time_spines(db: AsyncSession, data_source_id: str) -> List[Dict[str, Any]]:
    try:
        result = await db.execute(
            sa_text(
                "SELECT id, name, base_column, grain, sql_template, is_active "
                "FROM semantic_time_spines WHERE data_source_id = :ds AND is_active = true ORDER BY name"
            ),
            {"ds": data_source_id},
        )
        return [dict(zip(result.keys(), row)) for row in result.fetchall()]
    except Exception:
        return []


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
                f"SELECT id, name, expression, description, category, certified, metric_type, source, "
                f"source_ref, type_params "
                f"FROM semantic_metrics WHERE {m_where} ORDER BY name LIMIT 500"
            ),
            params,
        )
        metrics = _normalize_semantic_rows([dict(zip(m_res.keys(), row)) for row in m_res.fetchall()])
        certified_count = sum(1 for m in metrics if m.get("certified"))

        d_res = await db.execute(
            sa_text(
                f"SELECT id, name, expression, description, certified, values_sample, source_ref "
                f"FROM semantic_dimensions WHERE {d_where} ORDER BY name LIMIT 500"
            ),
            params,
        )
        dimensions = _normalize_semantic_rows([dict(zip(d_res.keys(), row)) for row in d_res.fetchall()])
    except Exception as exc:
        logger.debug("get_unified_semantic_context semantic tables: %s", exc)

    certified_count = sum(1 for m in metrics if m.get("certified"))
    existing_names = {m.get("name") for m in metrics if m.get("name")}
    sup_m, sup_d = await _load_supplemental_metrics(db, data_source_id, existing_names, certified_count)
    if sup_m:
        metrics.extend(sup_m)
    if sup_d:
        dimensions.extend(sup_d)

    time_spines: List[Dict[str, Any]] = []
    if data_source_id:
        time_spines = await list_time_spines(db, data_source_id)

    # ── Build structured, actionable prompt_hint ─────────────────────────────
    # Certified metrics are highest-trust SQL expressions — inject them as
    # explicit snippets the LLM MUST use when the user asks for that concept.
    # Non-certified metrics are suggestions only.
    certified = [m for m in metrics if m.get("certified")]
    uncertified = [m for m in metrics if not m.get("certified")]

    prompt_sections: List[str] = []

    if certified:
        sql_snippets = "; ".join(
            f"{m['name']}: {m['expression']}" for m in certified[:10]
        )
        prompt_sections.append(
            f"CERTIFIED METRICS — use these exact SQL expressions when asked for these KPIs: {sql_snippets}."
        )
        ai_notes = [
            f"{m['name']}: {m['ai_context']}"
            for m in certified[:10]
            if m.get("ai_context")
        ]
        if ai_notes:
            prompt_sections.append("CERTIFIED METRIC AI CONTEXT: " + " ".join(ai_notes))
        drill_notes = [
            f"{m['name']} drill fields: {', '.join(m['drill_fields'][:8])}"
            for m in certified[:10]
            if m.get("drill_fields")
        ]
        if drill_notes:
            prompt_sections.append("DEFAULT DRILL FIELDS: " + "; ".join(drill_notes) + ".")

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
            raw_vals = d.get("values_sample")
            try:
                vals = json.loads(raw_vals) if isinstance(raw_vals, str) else (raw_vals or [])
            except Exception:
                vals = []
            if vals:
                entry += " (e.g. " + ", ".join(str(v) for v in vals[:4]) + ")"
            dim_parts.append(entry)
        prompt_sections.append("Grouping dimensions: " + ", ".join(dim_parts) + ".")

    if time_spines:
        ts_parts = [
            f"{ts['base_column']} (grain: {ts['grain']})" for ts in time_spines[:4]
        ]
        prompt_sections.append(
            "Time dimensions for trend analysis: " + ", ".join(ts_parts) + ". "
            "Use DATE_TRUNC(grain, column) for time bucketing."
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
        "time_spines": time_spines,
        "total_metrics": len(metrics),
        "total_dimensions": len(dimensions),
        "total_joins": len(join_paths),
        "certified_metric_count": certified_count,
        "certified_metrics": certified,
        "prompt_hint": prompt_hint,
    }
