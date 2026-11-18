"""Prepare: run recipe steps over a governed sample of a source table.

Rows are always read through ``governed_sql`` (the query editor's path), so a person sees in
Prepare exactly the rows and columns their access rules allow. The engine then runs locally in
DuckDB over that sample.
"""

from __future__ import annotations

import asyncio
import dataclasses
import os
import re
import tempfile
from typing import Any, Dict, List, Optional

import pandas as pd
import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import HTTPException

from src.modules.data.services.governed_sql import Caller, load_source_for, quote_table, rows_as_records, run_sql
from src.modules.prep.engine.compiler import compile_steps
from src.modules.prep.engine import runtime
from src.modules.prep.engine.executor import as_table, connect, preview_steps
from src.modules.prep.engine.profiler import profile_object
from src.modules.prep.engine.scoring import health_with_findings
from src.modules.prep.engine.steps import STEP_REGISTRY

# Saving a recipe as a table reads at most this many rows.
MAX_SAVE_ROWS = 1_000_000
FILE_TABLE = "data"


def step_catalog() -> List[Dict[str, Any]]:
    out = []
    for kind, cls in STEP_REGISTRY.items():
        out.append({"kind": kind, "group": cls.group, "label": cls.label, "schema": cls.model_json_schema()})
    return sorted(out, key=lambda s: (s["group"], s["kind"]))


def resolve_table(source: Dict[str, Any], table: Optional[str]) -> str:
    """The table to read: what was asked, else the only/first table the source has."""
    if table:
        return table
    if (source.get("type") or "").lower() == "file":
        return FILE_TABLE
    schema = source.get("schema") or {}
    tables = schema.get("tables") if isinstance(schema, dict) else None
    if isinstance(tables, list) and tables:
        first = tables[0]
        name = first.get("name") if isinstance(first, dict) else str(first)
        parent = first.get("schema") if isinstance(first, dict) else None
        if name:
            return f"{parent}.{name}" if parent and parent not in ("public", "main") else name
    raise HTTPException(status_code=400, detail="Choose a table to prepare.")


def _to_arrow(result: Dict[str, Any]) -> pa.Table:
    records = rows_as_records(result)
    if not records:
        return pa.table({c: pa.array([], type=pa.string()) for c in result.get("columns") or []})
    try:
        return pa.Table.from_pylist(records)
    except (pa.ArrowInvalid, pa.ArrowTypeError):
        # Mixed types in a column: let pandas settle on a common type.
        return pa.Table.from_pandas(pd.DataFrame.from_records(records), preserve_index=False)


def _schema_tables(source: Dict[str, Any]) -> List[str]:
    schema = source.get("schema") or {}
    tables = schema.get("tables") if isinstance(schema, dict) else None
    out: List[str] = []
    for item in tables or []:
        name = item.get("name") if isinstance(item, dict) else str(item)
        if name:
            out.append(name)
    return out


SAMPLE_MODES = ("first", "random", "full")
# "Full" still has a ceiling so the editor stays responsive; the label says when it's reached.
FULL_CAP = 100_000
_RANDOM_BY_ENGINE = {"mysql": "RAND()", "mariadb": "RAND()", "bigquery": "RAND()", "clickhouse": "rand()",
                     "sqlserver": "NEWID()", "mssql": "NEWID()", "azure_sql": "NEWID()"}


def _sample_sql(source: Dict[str, Any], table: str, rows: int, mode: str) -> str:
    base = f"SELECT * FROM {quote_table(table)}"
    if mode == "random":
        engine = str(source.get("db_type") or "").lower()
        if engine in ("sqlserver", "mssql", "azure_sql"):
            return f"SELECT TOP {int(rows)} * FROM {quote_table(table)} ORDER BY NEWID()"
        return f"{base} ORDER BY {_RANDOM_BY_ENGINE.get(engine, 'random()')} LIMIT {int(rows)}"
    if mode == "full":
        return f"{base} LIMIT {FULL_CAP}"
    return f"{base} LIMIT {int(rows)}"


async def _lake_sample(caller: Caller, data_source_id: str, lake_object_id: str, rows: int) -> tuple[str, pa.Table]:
    from src.core.edition import is_ee_enabled

    if not is_ee_enabled():
        raise HTTPException(status_code=400, detail="Lake tables need the Enterprise edition.")
    from src.modules.pipeline.catalog.lake_rows import lake_object_source, read_lake_rows

    obj = await lake_object_source(caller.organization_id, lake_object_id)
    if str(obj.data_source_id) != str(data_source_id):
        raise HTTPException(status_code=404, detail="Lake table not found")
    return obj.source_table or "data", await read_lake_rows(obj, rows)


async def load_sample(caller: Caller, data_source_id: str, table: Optional[str], rows: int,
                      mode: str = "first", lake_object_id: Optional[str] = None) -> tuple[Dict[str, Any], str, pa.Table]:
    if mode not in SAMPLE_MODES:
        raise HTTPException(status_code=400, detail="Sample must be first, random or full.")
    source = await load_source_for(caller, data_source_id)
    if lake_object_id:
        return source, *(await _lake_sample(caller, data_source_id, lake_object_id, FULL_CAP if mode == "full" else rows))
    name = resolve_table(source, table)
    try:
        result = await run_sql(caller, source, _sample_sql(source, name, rows, mode))
    except HTTPException:
        # A file served from the lakehouse exposes its real table names instead of "data".
        fallback = [t for t in _schema_tables(source) if t != name]
        if table or name != FILE_TABLE or not fallback:
            raise
        name = fallback[0]
        result = await run_sql(caller, source, _sample_sql(source, name, rows, mode))
    return source, name, _to_arrow(result)


def _connection_over(sample: pa.Table, assets: Optional[Dict[str, pa.Table]] = None):
    """In-memory engine over governed samples only. Steps may carry SQL (formulas, raw SQL,
    metrics), so files, network and settings are closed off before any of it runs."""
    conn = connect()
    conn.register("src", sample)
    for alias, table in (assets or {}).items():
        conn.register(alias, table)
    conn.execute("SET enable_external_access = false")
    conn.execute("SET lock_configuration = true")
    return conn


_ASSET_NAME = re.compile(r"^[A-Za-z0-9_ .\-$]{1,255}$")


async def _load_assets(caller: Caller, source: Dict[str, Any], steps: List[Dict[str, Any]],
                       rows: int) -> tuple[List[Dict[str, Any]], Dict[str, pa.Table]]:
    """Merge/Append name another table of the same connection; load a governed sample of each
    and point the step at it, so the preview shows the combined result."""
    out: List[Dict[str, Any]] = []
    assets: Dict[str, pa.Table] = {}
    by_name: Dict[str, str] = {}
    for raw in steps:
        kind, payload = (next(iter(raw.items())) if isinstance(raw, dict) and len(raw) == 1 else (None, None))
        name = payload.get("asset") if isinstance(payload, dict) and kind in ("join", "union") else None
        if not isinstance(name, str) or not _ASSET_NAME.match(name):
            out.append(raw)
            continue
        if name not in by_name:
            alias = f"asset_{len(by_name) + 1}"
            result = await run_sql(caller, source, f"SELECT * FROM {quote_table(name)} LIMIT {int(rows)}")
            assets[alias] = _to_arrow(result)
            by_name[name] = alias
        out.append({kind: {**payload, "asset": by_name[name]}})
    return out, assets


async def _with_runtime(caller: Caller, steps: List[Dict[str, Any]], sample: pa.Table,
                        assets: Dict[str, pa.Table], *, source: Optional[Dict[str, Any]] = None,
                        dry: bool = False) -> Dict[str, pa.Table]:
    """The assets plus the output of every prediction / AI answer step over these rows.
    Models and decisions belong to an organization: the connection's (when the caller is a
    member), so a sign-in token without one still finds them."""
    if not runtime.has_runtime_steps(steps):
        return assets
    if not caller.organization_id:
        from src.db.session import async_session
        from src.modules.data.services.governed_sql import resolve_organization

        org = (source or {}).get("organization_id")
        async with async_session() as db:
            caller = await resolve_organization(dataclasses.replace(caller), db, str(org) if org else None)
    conn = _connection_over(sample, assets)
    try:
        filled = await runtime.materialize(caller, steps, source_sql="SELECT * FROM src", conn=conn, dry=dry)
    finally:
        conn.close()
    return {**assets, **filled}


def _sample_info(req, sample: pa.Table, table: str) -> Dict[str, Any]:
    cap = FULL_CAP if req.sample_mode == "full" else req.sample_rows
    return {"table": table, "sample_rows": sample.num_rows, "sample_mode": req.sample_mode,
            "sampled": sample.num_rows >= cap}


async def preview(caller: Caller, req) -> Dict[str, Any]:
    from src.modules.prep import insights

    source, table, sample = await load_sample(caller, req.data_source_id, req.table, req.sample_rows, req.sample_mode, req.lake_object_id)
    steps, assets = await _load_assets(caller, source, req.steps, req.sample_rows)
    try:
        assets = await _with_runtime(caller, steps, sample, assets, source=source)
    except runtime.RuntimeStepError as exc:
        return {"columns": [], "rows": [], "sql": None, "quarantined_count": 0,
                "step_errors": [{"step": exc.step, "message": exc.message}], **_sample_info(req, sample, table)}

    def run():
        conn = _connection_over(sample, assets)
        result = preview_steps(steps, source_sql="SELECT * FROM src", up_to_step=req.up_to_step,
                               limit=req.limit, connection=conn)
        if not result["step_errors"]:
            result["step_stats"] = insights.step_stats(conn, steps, "SELECT * FROM src")
            shown = len(steps) - 1 if req.up_to_step is None else req.up_to_step
            if 0 <= shown < len(steps):
                result["changes"] = insights.step_changes(conn, steps, "SELECT * FROM src", shown, req.limit)
        return result

    result = await asyncio.to_thread(run)
    result.update(_sample_info(req, sample, table))
    return result


async def profile(caller: Caller, req) -> Dict[str, Any]:
    """The data after the current steps: health, column distributions and suggested fixes."""
    from src.modules.prep import insights

    source, table, sample = await load_sample(caller, req.data_source_id, req.table, req.sample_rows, req.sample_mode, req.lake_object_id)
    steps, assets = await _load_assets(caller, source, req.steps, req.sample_rows)
    try:
        assets = await _with_runtime(caller, steps, sample, assets, source=source)
    except runtime.RuntimeStepError as exc:
        return {"table": table, "profile": None, "health": None, "distributions": {}, "findings": [], "error": exc.message}

    def run():
        conn = _connection_over(sample, assets)
        compiled = compile_steps(steps, source_sql="SELECT * FROM src")
        conn.execute(f"CREATE OR REPLACE TEMP VIEW _prepared AS {compiled.sql}")
        prof = profile_object("SELECT * FROM _prepared", connection=conn)
        info = _sample_info(req, sample, table)
        findings = insights.suggestions(conn, "_prepared") + insights.review_items(conn, "_prepared")
        return {
            "table": table,
            # Whether these stats cover every row or the first N, so the UI can say "in a sample".
            "profile": {**prof.model_dump(), "sampled": info["sampled"]},
            **info,
            "health": health_with_findings(prof, findings),
            "distributions": insights.distributions(conn, "_prepared"),
            "findings": findings,
        }

    try:
        return await asyncio.to_thread(run)
    except Exception as exc:  # noqa: BLE001 - a failing step is shown by the preview; suggestions just wait
        return {"table": table, "profile": None, "health": None, "distributions": {}, "findings": [], "error": str(exc)}


async def detect(caller: Caller, req) -> Dict[str, Any]:
    """Suggested types for every column after the current steps."""
    from src.modules.prep.detect import detect_types, failing_examples

    source, table, sample = await load_sample(caller, req.data_source_id, req.table, req.sample_rows, req.sample_mode, req.lake_object_id)
    steps, assets = await _load_assets(caller, source, req.steps, req.sample_rows)
    try:
        assets = await _with_runtime(caller, steps, sample, assets, source=source)
    except runtime.RuntimeStepError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc

    def run():
        conn = _connection_over(sample, assets)
        compiled = compile_steps(steps, source_sql="SELECT * FROM src")
        conn.execute(f"CREATE OR REPLACE TEMP VIEW _prepared AS {compiled.sql}")
        found = detect_types(conn, "_prepared")
        for column, spec in found.items():
            clean = {k: v for k, v in spec.items() if k not in ("coverage", "ambiguous")}
            spec["failing"] = failing_examples(conn, "_prepared", column, clean)
        return {"table": table, "columns": found}

    try:
        return await asyncio.to_thread(run)
    except ValueError as exc:
        raise HTTPException(status_code=400, detail=str(exc)) from exc


async def failures(caller: Caller, req) -> Dict[str, Any]:
    """The values one step turned empty in one column."""
    from src.modules.prep import insights

    source, _table, sample = await load_sample(caller, req.data_source_id, req.table, req.sample_rows, req.sample_mode, req.lake_object_id)
    steps, assets = await _load_assets(caller, source, req.steps, req.sample_rows)
    try:
        assets = await _with_runtime(caller, steps, sample, assets, source=source)
    except runtime.RuntimeStepError as exc:
        raise HTTPException(status_code=400, detail=exc.message) from exc

    def run():
        return insights.failed_values(_connection_over(sample, assets), steps, "SELECT * FROM src", req.step, req.column)

    try:
        return {"values": await asyncio.to_thread(run)}
    except Exception as exc:  # noqa: BLE001
        raise HTTPException(status_code=400, detail=str(exc)) from exc


async def save_arrow_as_connection(caller: Caller, table: pa.Table, name: str) -> Dict[str, Any]:
    """Store rows as a new file connection in the caller's project; returns the data source."""
    from src.modules.data.services.data_connectivity_service import DataConnectivityService

    fd, path = tempfile.mkstemp(suffix=".parquet")
    os.close(fd)
    try:
        await asyncio.to_thread(pq.write_table, table, path)
        upload = await DataConnectivityService().upload_file_from_path(
            tmp_file_path=path,
            filename=f"{name}.parquet",
            file_size=os.path.getsize(path),
            options={
                "user_id": caller.user_id,
                "project_id": caller.project_id,
                "organization_id": caller.organization_id,
                "name": name,
                "include_data": False,
            },
        )
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass
    if not upload.get("success"):
        raise HTTPException(status_code=400, detail=str(upload.get("error") or "Saving the table failed."))
    return upload.get("data_source") or {}


async def run_full(caller: Caller, data_source_id: str, table: Optional[str],
                   steps: List[Dict[str, Any]]) -> tuple[Dict[str, Any], str, pa.Table, bool]:
    """``steps`` over the whole table (up to MAX_SAVE_ROWS rows): (source, table, rows, truncated)."""
    source, name, rows = await load_sample(caller, data_source_id, table, MAX_SAVE_ROWS)
    steps, assets = await _load_assets(caller, source, list(steps or []), MAX_SAVE_ROWS)
    try:
        assets = await _with_runtime(caller, steps, rows, assets, source=source)
    except runtime.RuntimeStepError as exc:
        raise HTTPException(status_code=400, detail=f"Step {exc.step + 1}: {exc.message}") from exc

    def run() -> pa.Table:
        compiled = compile_steps(steps, source_sql="SELECT * FROM src")
        return as_table(_connection_over(rows, assets).execute(compiled.sql))

    try:
        result = await asyncio.to_thread(run)
    except Exception as exc:  # noqa: BLE001 - the person needs the engine's reason
        raise HTTPException(status_code=400, detail=f"The recipe could not run: {exc}") from exc
    return source, name, result, rows.num_rows >= MAX_SAVE_ROWS


async def save_as_table(caller: Caller, recipe, name: Optional[str], db) -> Dict[str, Any]:
    """Run the recipe over the whole table and put the result in its source's clean copy (one
    connection per source, made on the first save), replacing that table there."""
    from src.modules.prep import clean_copy

    source, table, result, truncated = await run_full(caller, recipe.data_source_id, recipe.source_table, recipe.steps)
    target = clean_copy.table_name_for(source, table)
    saved = await clean_copy.save(
        caller, db, source, {target: result},
        {target: {"recipe_id": str(recipe.id), "recipe_version": recipe.version, "rows": result.num_rows,
                  "source_table": table, "truncated": truncated}},
        name=name,
    )
    return {
        "data_source_id": saved["id"],
        "name": saved["name"],
        "table": target,
        "rows": result.num_rows,
        "columns": result.num_columns,
        "truncated": truncated,
        "tables": len(saved["tables"]),
    }


def source_tables(source: Dict[str, Any]) -> List[Dict[str, Any]]:
    """The source's tables as Prepare names them (``schema.table`` outside the default schema),
    with the row count the connection last reported."""
    out = []
    for item in ((source.get("schema") or {}).get("tables") or []):
        if not isinstance(item, dict) or not item.get("name"):
            continue
        parent = item.get("schema")
        name = f"{parent}.{item['name']}" if parent and parent not in ("public", "main") else str(item["name"])
        out.append({"name": name, "rows": item.get("row_count"), "columns": len(item.get("columns") or [])})
    if not out and (source.get("type") or "").lower() == "file":
        out.append({"name": FILE_TABLE, "rows": source.get("row_count"), "columns": None})
    return out


def _recipe_table(source: Dict[str, Any], recipe) -> str:
    """The source table a recipe reads; a file recipe saved as ``data`` reads the first table."""
    table = recipe.source_table or FILE_TABLE
    if table == FILE_TABLE and (source.get("type") or "").lower() == "file":
        tables = source_tables(source)
        if tables:
            return tables[0]["name"]
    return table


async def published_steps(db, recipe) -> Optional[List[Dict[str, Any]]]:
    """The steps of the recipe's latest published version, or None when it was never published."""
    from sqlalchemy import select

    from src.modules.prep.models import PrepRecipeVersion

    if recipe.status == "published":
        return list(recipe.steps or [])
    if not recipe.version:
        return None
    latest = (await db.execute(
        select(PrepRecipeVersion).where(PrepRecipeVersion.recipe_id == recipe.id)
        .order_by(PrepRecipeVersion.version.desc()).limit(1)
    )).scalar_one_or_none()
    return list(latest.steps or []) if latest else None


async def _recipes_by_table(db, caller: Caller, source: Dict[str, Any]) -> Dict[str, List[Any]]:
    """The project's recipes on this source, newest first, grouped by the table they read."""
    from sqlalchemy import select

    from src.modules.prep.models import PrepRecipe

    query = select(PrepRecipe).where(PrepRecipe.data_source_id == str(source["id"]), PrepRecipe.is_deleted.is_not(True))
    import uuid

    if caller.project_id:
        query = query.where(PrepRecipe.project_id == uuid.UUID(str(caller.project_id)))
    else:
        query = query.where(PrepRecipe.user_id == uuid.UUID(str(caller.user_id)))
    grouped: Dict[str, List[Any]] = {}
    for recipe in (await db.execute(query.order_by(PrepRecipe.updated_at.desc()))).scalars().all():
        grouped.setdefault(_recipe_table(source, recipe).lower(), []).append(recipe)
    return grouped


def _pick(recipes: List[Any]) -> Optional[Any]:
    """The recipe that speaks for a table: the newest published one, else the newest."""
    for recipe in recipes:
        if recipe.version:
            return recipe
    return recipes[0] if recipes else None


async def source_overview(caller: Caller, db, data_source_id: str) -> Dict[str, Any]:
    """Every table of a source with its recipe and what its clean copy holds, so a source with
    many tables is cleaned from one list."""
    from src.modules.prep import clean_copy

    source = await load_source_for(caller, data_source_id)
    grouped = await _recipes_by_table(db, caller, source)
    copy = await clean_copy.find(db, data_source_id, caller.project_id)
    linked = (copy or {}).get("tables") or {}
    tables = []
    for item in source_tables(source):
        recipes = grouped.get(item["name"].lower(), [])
        recipe = _pick(recipes)
        saved = linked.get(clean_copy.table_name_for(source, item["name"]))
        tables.append({
            **item,
            "clean_name": clean_copy.table_name_for(source, item["name"]),
            "recipe": None if recipe is None else {
                "id": str(recipe.id), "name": recipe.name, "status": recipe.status, "version": recipe.version,
                "steps": len(recipe.steps or []),
                "updated_at": recipe.updated_at.isoformat() if recipe.updated_at else None,
            },
            "other_recipes": max(0, len(recipes) - 1),
            "saved": saved,
            # The copy holds an older version than the one now published
            "outdated": bool(saved and recipe and saved.get("recipe_id") == str(recipe.id)
                             and (saved.get("recipe_version") or 0) < (recipe.version or 0)),
        })
    return {
        "source": {"id": str(source["id"]), "name": source.get("name"), "type": source.get("type"),
                   "db_type": source.get("db_type"),
                   "prepared_from": ((source.get("schema") or {}).get("prepared_from") or {}).get("data_source_id")},
        "tables": tables,
        "clean_copy": None if not copy else {"id": copy["id"], "name": copy["name"], "updated_at": copy["updated_at"]},
    }


# A save-all holds at most this many rows in memory before writing them to the clean copy.
SAVE_ALL_BATCH_ROWS = 2_000_000


async def save_all(caller: Caller, db, data_source_id: str, *, include_unprepared: bool,
                   only: Optional[List[str]] = None, name: Optional[str] = None) -> Dict[str, Any]:
    """Fill the source's clean copy: each table through its published recipe, and (when asked)
    the tables without one as they are. A table that fails is reported and the rest carry on."""
    from src.modules.prep import clean_copy

    source = await load_source_for(caller, data_source_id)
    grouped = await _recipes_by_table(db, caller, source)
    wanted = {t.lower() for t in only} if only else None
    results: List[Dict[str, Any]] = []
    batch: Dict[str, pa.Table] = {}
    details: Dict[str, Dict[str, Any]] = {}
    held = 0
    copy: Optional[Dict[str, Any]] = None

    async def flush() -> None:
        nonlocal batch, details, held, copy
        if batch:
            copy = await clean_copy.save(caller, db, source, batch, details, name=name)
        batch, details, held = {}, {}, 0

    for item in source_tables(source):
        table = item["name"]
        if wanted is not None and table.lower() not in wanted:
            continue
        recipe = _pick(grouped.get(table.lower(), []))
        steps = await published_steps(db, recipe) if recipe else None
        if steps is None and not include_unprepared:
            results.append({"table": table, "status": "skipped",
                            "reason": "draft" if recipe else "no_recipe"})
            continue
        try:
            _src, read_as, rows, truncated = await run_full(
                caller, data_source_id, recipe.source_table if (recipe and steps is not None) else table, steps or [])
        except HTTPException as exc:
            results.append({"table": table, "status": "error", "message": str(exc.detail)})
            continue
        target = clean_copy.table_name_for(source, table)
        batch[target] = rows
        details[target] = {"recipe_id": str(recipe.id) if (recipe and steps is not None) else None,
                           "recipe_version": recipe.version if (recipe and steps is not None) else None,
                           "rows": rows.num_rows, "source_table": table, "truncated": truncated,
                           "as_is": steps is None}
        results.append({"table": table, "status": "cleaned" if steps is not None else "copied",
                        "rows": rows.num_rows, "truncated": truncated})
        held += rows.num_rows
        if held >= SAVE_ALL_BATCH_ROWS:
            await flush()
    await flush()
    return {"clean_copy": None if not copy else {"id": copy["id"], "name": copy["name"]}, "tables": results}


async def organization_of(db, project_id: Optional[str], source: Optional[Dict[str, Any]] = None) -> Optional[str]:
    """The organization a recipe belongs to: its project's, else its connection's."""
    from sqlalchemy import text as sa_text

    if project_id:
        try:
            row = (await db.execute(sa_text("SELECT organization_id FROM projects WHERE id = CAST(:p AS uuid)"), {"p": str(project_id)})).first()
            if row and row[0]:
                return str(row[0])
        except Exception:  # noqa: BLE001 - not a UUID, or no projects table
            await db.rollback()
    org = (source or {}).get("organization_id")
    return str(org) if org else None


async def impact(caller: Caller, recipe, published_steps: Optional[List[Dict[str, Any]]], db) -> Dict[str, Any]:
    """What publishing the draft would break: output columns that disappear or change type,
    and the pipelines, saved table and metrics that rely on this recipe."""
    from sqlalchemy import text as sa_text

    if published_steps is None:
        return {"removed": [], "retyped": [], "pipelines": [], "saved_table": None, "metrics": [], "contracts": []}
    _source, _table, sample = await load_sample(caller, recipe.data_source_id, recipe.source_table, 200)

    async def columns(steps: List[Dict[str, Any]]) -> Dict[str, str]:
        # The shape only: model and AI steps add their columns empty instead of running.
        extra = await _with_runtime(caller, steps, sample, {}, source=_source, dry=True)

        def describe() -> Dict[str, str]:
            conn = _connection_over(sample, extra)
            compiled = compile_steps(steps, source_sql="SELECT * FROM src", limit=0)
            return {r[0]: str(r[1]) for r in conn.execute(f"DESCRIBE ({compiled.sql})").fetchall()}

        return await asyncio.to_thread(describe)

    try:
        before = await columns(published_steps)
        after = await columns(list(recipe.steps or []))
    except Exception:  # noqa: BLE001 - a draft that can't run is reported by the preview
        return {"removed": [], "retyped": [], "pipelines": [], "saved_table": None, "metrics": [], "contracts": [], "error": True}
    removed = [c for c in before if c not in after]
    retyped = [{"column": c, "from": t, "to": after[c]} for c, t in before.items() if c in after and after[c] != t]

    from src.modules.impact.service import dependents

    import dataclasses

    org = getattr(recipe, "organization_id", None) or caller.organization_id or await organization_of(db, getattr(recipe, "project_id", None))
    in_org = dataclasses.replace(caller, organization_id=str(org) if org else None)
    pipelines = [d.name for d in (await dependents(db, in_org, "recipe", str(recipe.id))).items][:20]

    saved = (recipe.output or {}).get("data_source_id")
    metrics: List[str] = []
    if saved and removed:
        try:
            clauses = " OR ".join(f"expression ILIKE :c{i}" for i in range(len(removed)))
            params = {f"c{i}": f"%{c}%" for i, c in enumerate(removed)}
            rows = (await db.execute(sa_text(
                f"SELECT name FROM semantic_metrics WHERE data_source_id = :ds AND ({clauses}) LIMIT 20"
            ), {"ds": saved, **params})).all()
            metrics = [r[0] for r in rows]
        except Exception:  # noqa: BLE001
            await db.rollback()
    contracts = await _contracts_broken(db, caller, recipe, removed, retyped)
    return {
        "removed": removed,
        "retyped": retyped,
        "pipelines": pipelines,
        "saved_table": (recipe.output or {}).get("name") if saved else None,
        "metrics": metrics,
        "contracts": contracts,
    }


async def _contracts_broken(db, caller: Caller, recipe, removed, retyped) -> List[Dict[str, Any]]:
    """Contracts on this recipe's table that the draft would break (Enterprise certifies tables)."""
    from sqlalchemy import text as sa_text
    from sqlalchemy.exc import ProgrammingError

    from src.shared.contract_rules import breaking_changes

    if not (removed or retyped):
        return []
    org = str(getattr(recipe, "organization_id", None) or caller.organization_id
              or await organization_of(db, getattr(recipe, "project_id", None)) or "")
    if not org:
        return []
    try:
        rows = (await db.execute(sa_text(
            "SELECT id, source_table, layer, columns, on_breach FROM data_contracts "
            "WHERE data_source_id = :ds AND organization_id = CAST(:org AS uuid) AND is_active IS TRUE "
            "AND (source_table = :t OR (:t IS NULL AND source_table IS NULL))"
        ), {"ds": recipe.data_source_id, "org": org, "t": recipe.source_table})).all()
    except ProgrammingError:
        await db.rollback()
        return []
    out = []
    for cid, table, layer, columns, on_breach in rows:
        broken = breaking_changes(columns or [], removed, retyped)
        if broken:
            out.append({"id": str(cid), "table": table, "layer": layer, "on_breach": on_breach, "breaches": broken})
    return out
