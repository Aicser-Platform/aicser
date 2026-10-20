"""What depends on an object, so a change or delete can say what it would affect.

One answer for every kind of object (connection, chart, dashboard, metric, recipe), read from
the references that already exist: a chart's connection, a dashboard's charts, an alert's chart,
a shared post's asset, a pipeline's source. Dependents in projects the caller can't open are
counted, never named.
"""

from __future__ import annotations

import logging
import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Optional, Sequence

from sqlalchemy import text
from sqlalchemy.exc import ProgrammingError

from src.core.edition import is_ee_enabled
from src.modules.data.services.governed_sql import Caller

logger = logging.getLogger(__name__)

KINDS = ("data_source", "chart", "dashboard", "metric", "recipe", "model", "decision")

# The permission that lets someone open each kind of dependent.
VIEW_PERMISSION = {
    "chart": "chart:view",
    "dashboard": "dashboard:view",
    "alert": "alert:view",
    "post": "dashboard:view",
    "metric": "semantic:view",
    "pipeline": "data:view",
    "recipe": "data:view",
    "share": "dashboard:view",
    "embed": "embed:view",
    "model": "query:execute",
    "decision": "query:execute",
    "data_source": "data:view",
}

HREF = {
    "chart": "/chart-designer?chart={id}",
    "dashboard": "/dashboards?id={id}",
    "alert": "/alerts",
    "post": "/feed/{id}",
    "metric": "/semantic-layer",
    "pipeline": "/pipelines/{id}",
    "recipe": "/prepare/{id}",
    "model": "/models/{id}",
    "decision": "/ai-decisions/{id}",
    "data_source": "/data/sources/{id}",
}


@dataclass
class Dependent:
    kind: str
    id: str
    name: str
    project_id: Optional[str] = None
    # Why it depends, e.g. "uses this connection", as a short key the UI translates.
    relation: str = ""
    owner_id: Optional[str] = None

    def as_dict(self) -> Dict[str, Any]:
        href = HREF.get(self.kind)
        return {
            "kind": self.kind,
            "id": self.id,
            "name": self.name,
            "relation": self.relation,
            "href": href.format(id=self.id) if href else None,
        }


@dataclass
class Impact:
    items: List[Dependent] = field(default_factory=list)
    hidden: int = 0

    def as_dict(self) -> Dict[str, Any]:
        counts: Dict[str, int] = {}
        for item in self.items:
            counts[item.kind] = counts.get(item.kind, 0) + 1
        return {"items": [i.as_dict() for i in self.items], "counts": counts, "hidden": self.hidden}


async def _rows(db, sql: str, params: Dict[str, Any]) -> Sequence[Any]:
    """Rows of a reference query; tables that only exist in Enterprise read as empty."""
    try:
        return (await db.execute(text(sql), params)).all()
    except ProgrammingError as exc:
        if "does not exist" not in str(exc):
            raise
        await db.rollback()
        return []


def _s(value: Any) -> Optional[str]:
    return str(value) if value else None


async def _can_view(caller: Caller, permission: str, project_id: Optional[str]) -> bool:
    """Enterprise: the role's permission in that project. Community has no shared projects."""
    if not is_ee_enabled():
        return False
    try:
        from src.modules.authentication.rbac.rbac_service import RBACService
    except ImportError:
        return False
    return await RBACService.check_permission(caller.user_id, permission, caller.organization_id, project_id)


async def visible(caller: Caller, permission: str, project_id: Optional[str], owner_id: Optional[str]) -> bool:
    """Same rule as opening the object: its owner always can; others need the permission."""
    if owner_id and owner_id == str(caller.user_id):
        return True
    return await _can_view(caller, permission, project_id)


# Projects of the caller's organization: every reference query stays inside them.
_ORG_PROJECTS = "SELECT id FROM projects WHERE organization_id = CAST(:org AS uuid) AND is_deleted IS NOT TRUE"


async def _data_source(db, ref: str, org: str) -> List[Dependent]:
    p = {"ref": ref, "org": org}
    out: List[Dependent] = []
    for r in await _rows(db, f"""
        SELECT id, COALESCE(title, 'Untitled chart'), project_id, user_id FROM charts
        WHERE data_source_id = :ref AND is_deleted IS NOT TRUE AND project_id IN ({_ORG_PROJECTS})""", p):
        out.append(Dependent("chart", str(r[0]), r[1], _s(r[2]), "uses_connection", _s(r[3])))
    for r in await _rows(db, """
        SELECT id, name, project_id, created_by FROM alert_rules
        WHERE data_source_id = :ref AND org_id = CAST(:org AS uuid)""", p):
        out.append(Dependent("alert", str(r[0]), r[1], _s(r[2]), "checks_connection", _s(r[3])))
    for r in await _rows(db, f"""
        SELECT id, name, project_id FROM semantic_metrics
        WHERE data_source_id = :ref AND is_active IS NOT FALSE AND project_id IN ({_ORG_PROJECTS})""", p):
        out.append(Dependent("metric", str(r[0]), r[1], _s(r[2]), "defined_on_connection"))
    for r in await _rows(db, """
        SELECT id, name, created_by FROM data_pipelines
        WHERE source_asset_id = :ref AND organization_id = CAST(:org AS uuid) AND is_deleted IS NOT TRUE""", p):
        out.append(Dependent("pipeline", str(r[0]), r[1], None, "reads_connection", _s(r[2])))
    for r in await _rows(db, """
        SELECT id, name, project_id, user_id FROM prep_recipes
        WHERE data_source_id = :ref AND organization_id = CAST(:org AS uuid)""", p):
        out.append(Dependent("recipe", str(r[0]), r[1], _s(r[2]), "cleans_connection", _s(r[3])))
    for r in await _rows(db, """
        SELECT id, name, project_id, created_by FROM ml_models
        WHERE data_source_id = :ref AND organization_id = CAST(:org AS uuid) AND is_deleted IS NOT TRUE""", p):
        out.append(Dependent("model", str(r[0]), r[1], _s(r[2]), "learns_from_connection", _s(r[3])))
    for r in await _rows(db, """
        SELECT id, name, project_id, created_by FROM ai_decision_definitions
        WHERE source->>'data_source_id' = :ref AND organization_id = CAST(:org AS uuid) AND is_active IS TRUE""", p):
        out.append(Dependent("decision", str(r[0]), r[1], _s(r[2]), "decides_on_connection", _s(r[3])))
    return out


async def _chart(db, ref: str, org: str) -> List[Dependent]:
    p = {"ref": ref, "org": org}
    out: List[Dependent] = []
    for r in await _rows(db, f"""
        SELECT DISTINCT d.id, d.name, d.project_id, d.created_by FROM dashboard_charts dc
        JOIN dashboards d ON d.id = dc.dashboard_id
        WHERE dc.chart_id = CAST(:ref AS uuid) AND d.is_deleted IS NOT TRUE AND d.project_id IN ({_ORG_PROJECTS})""", p):
        out.append(Dependent("dashboard", str(r[0]), r[1], _s(r[2]), "shows_chart", _s(r[3])))
    for r in await _rows(db, """
        SELECT id, name, project_id, created_by FROM alert_rules
        WHERE source->>'chart_id' = :ref AND org_id = CAST(:org AS uuid)""", p):
        out.append(Dependent("alert", str(r[0]), r[1], _s(r[2]), "watches_chart", _s(r[3])))
    out += await _posts(db, "chart", ref, org)
    return out


async def _dashboard(db, ref: str, org: str) -> List[Dependent]:
    p = {"ref": ref, "org": org}
    out = await _posts(db, "dashboard", ref, org)
    for r in await _rows(db, """
        SELECT s.id, COALESCE(s.permission, 'view'), s.shared_by FROM dashboard_shares s
        WHERE s.dashboard_id = CAST(:ref AS uuid) AND s.is_active IS TRUE AND s.is_deleted IS NOT TRUE
          AND s.organization_id = CAST(:org AS uuid)""", p):
        out.append(Dependent("share", str(r[0]), str(r[1]), None, "share_link", _s(r[2])))
    for r in await _rows(db, f"""
        SELECT e.id, 'embed', e.created_by FROM dashboard_embeds e JOIN dashboards d ON d.id = e.dashboard_id
        WHERE e.dashboard_id = CAST(:ref AS uuid) AND e.is_active IS TRUE AND e.is_deleted IS NOT TRUE
          AND d.project_id IN ({_ORG_PROJECTS})""", p):
        out.append(Dependent("embed", str(r[0]), str(r[1]), None, "embedded", _s(r[2])))
    return out


async def _posts(db, asset_type: str, ref: str, org: str) -> List[Dependent]:
    rows = await _rows(db, """
        SELECT id, title, project_id, author_id FROM feed_posts
        WHERE CAST(asset_type AS text) = :kind AND asset_id = CAST(:ref AS uuid)
          AND organization_id = CAST(:org AS uuid)""", {"kind": asset_type, "ref": ref, "org": org})
    return [Dependent("post", str(r[0]), r[1] or "Shared insight", _s(r[2]), "shared_in_feed", _s(r[3])) for r in rows]


def _like_literal(value: str) -> str:
    return value.replace("\\", "\\\\").replace("%", "\\%").replace("_", "\\_")


async def _metric(db, ref: str, org: str) -> List[Dependent]:
    """Other metrics built on this one (ratios, derived metrics name it in their definition)."""
    me = await _rows(db, f"""
        SELECT name, data_source_id FROM semantic_metrics
        WHERE id = :ref AND project_id IN ({_ORG_PROJECTS})""", {"ref": ref, "org": org})
    if not me:
        return []
    name, ds = me[0]
    # Charts bound to the metric (the dashboard/chart metric picker), and the boards showing them.
    charts = await _rows(db, f"""
        SELECT id, COALESCE(title, 'Untitled chart'), project_id, user_id FROM charts
        WHERE chart_query->>'semantic_metric_id' = :ref AND is_deleted IS NOT TRUE
          AND project_id IN ({_ORG_PROJECTS})""", {"ref": ref, "org": org})
    out: List[Dependent] = [Dependent("chart", str(r[0]), r[1], _s(r[2]), "shows_metric", _s(r[3])) for r in charts]
    for c in charts:
        out += await _chart(db, str(c[0]), org)
    rows = await _rows(db, f"""
        SELECT id, name, project_id FROM semantic_metrics
        WHERE id <> :ref AND data_source_id = :ds AND is_active IS NOT FALSE
          AND (CAST(type_params AS text) LIKE :quoted OR expression ~ :word)
          AND project_id IN ({_ORG_PROJECTS})""",
        {"ref": ref, "ds": ds, "org": org, "quoted": f'%"{_like_literal(name)}"%', "word": rf"\m{re.escape(name)}\M"})
    return out + [Dependent("metric", str(r[0]), r[1], _s(r[2]), "built_on_metric") for r in rows]


async def _recipe(db, ref: str, org: str) -> List[Dependent]:
    rows = await _rows(db, """
        SELECT id, name, created_by FROM data_pipelines
        WHERE organization_id = CAST(:org AS uuid) AND is_deleted IS NOT TRUE
          AND CAST(options AS text) LIKE :needle""", {"org": org, "needle": f"%{ref}%"})
    return [Dependent("pipeline", str(r[0]), r[1], None, "runs_recipe", _s(r[2])) for r in rows]


async def _uses_step(db, field: str, ref: str, org: str) -> List[Dependent]:
    """Recipes with a prediction / AI answer step naming this model or decision."""
    rows = await _rows(db, """
        SELECT id, name, project_id, user_id FROM prep_recipes
        WHERE organization_id = CAST(:org AS uuid) AND CAST(steps AS text) LIKE :needle""",
        {"org": org, "needle": f'%"{field}": "{_like_literal(ref)}"%'})
    return [Dependent("recipe", str(r[0]), r[1], _s(r[2]), "adds_step", _s(r[3])) for r in rows]


async def _dataset(db, dataset_id: Optional[str], org: str, relation: str) -> List[Dependent]:
    if not dataset_id:
        return []
    rows = await _rows(db, """
        SELECT id, name FROM data_sources WHERE id = :id AND organization_id = CAST(:org AS uuid)""",
        {"id": dataset_id, "org": org})
    return [Dependent("data_source", str(r[0]), r[1], None, relation) for r in rows]


async def _model(db, ref: str, org: str) -> List[Dependent]:
    """Where a model's answers go: its scored dataset (and what's built on it), recipes."""
    me = await _rows(db, """
        SELECT settings->'ops'->'score'->>'dataset_id' FROM ml_models
        WHERE id = CAST(:ref AS uuid) AND organization_id = CAST(:org AS uuid)""", {"ref": ref, "org": org})
    dataset = me[0][0] if me else None
    out = await _dataset(db, dataset, org, "holds_scores")
    if dataset:
        out += await _data_source(db, dataset, org)
    return out + await _uses_step(db, "model_id", ref, org)


async def _decision(db, ref: str, org: str) -> List[Dependent]:
    """Where a decision's answers go: its saved dataset (and what's built on it), recipes."""
    me = await _rows(db, """
        SELECT output->>'dataset_id' FROM ai_decision_definitions
        WHERE id = CAST(:ref AS uuid) AND organization_id = CAST(:org AS uuid)""", {"ref": ref, "org": org})
    dataset = me[0][0] if me else None
    out = await _dataset(db, dataset, org, "holds_answers")
    if dataset:
        out += await _data_source(db, dataset, org)
    return out + await _uses_step(db, "decision_id", ref, org)


_FINDERS = {"data_source": _data_source, "chart": _chart, "dashboard": _dashboard, "metric": _metric, "recipe": _recipe,
            "model": _model, "decision": _decision}


async def dependents(db, caller: Caller, kind: str, ref: str) -> Impact:
    """Everything that would notice if `kind`/`ref` changed or went away."""
    if kind not in _FINDERS:
        raise ValueError(f"Unknown kind {kind!r}")
    if not caller.organization_id:
        return Impact()
    found = await _FINDERS[kind](db, ref, caller.organization_id)
    impact = Impact()
    allowed: Dict[tuple, bool] = {}
    for dep in found:
        permission = VIEW_PERMISSION.get(dep.kind, "project:view")
        if dep.owner_id and dep.owner_id == str(caller.user_id):
            ok = True
        elif dep.kind == "metric" and not is_ee_enabled():
            # Community: metrics are shared definitions on a connection the caller can already open.
            ok = True
        else:
            key = (permission, dep.project_id)
            if key not in allowed:
                allowed[key] = await _can_view(caller, *key)
            ok = allowed[key]
        if ok:
            impact.items.append(dep)
        else:
            impact.hidden += 1
    return impact
