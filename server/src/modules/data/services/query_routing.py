"""Routes a data source to its lakehouse (Silver/Gold) data instead of the
original system, once an enabled pipeline manages it.

This is the single choke point for the "the AI agent must never touch a client's
production database" guarantee: every caller of MultiEngineQueryService reaches
DirectSQLEngine through the same code path (src/modules/data/services/
multi_engine_query_service.py), so gating there (see Task 7) covers chat, the
standalone chart builder, and dashboards without separate wiring in each.

It is also what makes pipeline output the data people analyse: a managed source
exposes every table the pipeline materialized -- under its real table name --
so charts, the SQL editor and AI read cleansed, governed data, not the raw source.
File sources are routed too: once a pipeline models an upload, the modeled
tables are the ones to query.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, Iterable, List, Optional

# Source types whose queries move to the lakehouse once a pipeline manages them
ROUTABLE_TYPES = ("database", "enterprise_connector", "file")
# A table's most refined layer wins
LAYER_RANK = {"gold": 2, "silver": 1}
# Pipeline bookkeeping carried into every Silver/Gold table: the Bronze audit
# columns (AUDIT_COLUMNS in the EE ingest contract) plus the load_id hive
# partition key. Kept out of the schema the AI plans against -- `_ingested_at`
# is the only real TIMESTAMP in many tables, so it would be picked as the time
# axis over the business date -- but still queryable when asked for by name.
PIPELINE_AUDIT_COLUMNS = frozenset(
    {"_op", "_ingested_at", "_source_offset", "_source_event_at", "_source_table", "_load_id", "load_id"}
)


class LakehouseNotReady(Exception):
    """A pipeline manages this source, but it has no Silver/Gold data yet."""

    def __init__(self, pipeline_id: uuid.UUID, last_run_status: Optional[str]):
        self.pipeline_id = pipeline_id
        self.last_run_status = last_run_status
        super().__init__(
            f"pipeline {pipeline_id} has not produced Silver or Gold data yet "
            f"(last run status: {last_run_status or 'never run'})"
        )


def select_serving_tables(lake_objects: Iterable[Any]) -> List[Dict[str, Any]]:
    """One entry per table: the newest active object in its most refined layer.

    Objects without a storage location can't be scanned and are skipped.
    Sorted by table name so the result (and the SQL built from it) is stable.
    """
    def rank(obj: Any) -> tuple:
        created = getattr(obj, "created_at", None)
        return (LAYER_RANK[obj.layer], created.timestamp() if created else 0.0)

    best: Dict[str, Any] = {}
    for obj in lake_objects:
        if getattr(obj, "status", "active") != "active" or not getattr(obj, "storage_uri", None):
            continue
        if obj.layer not in LAYER_RANK:
            continue
        name = getattr(obj, "source_table", None) or "data"
        if name not in best or rank(obj) > rank(best[name]):
            best[name] = obj
    return [
        {
            "name": name,
            "storage_uri": obj.storage_uri,
            "layer": obj.layer,
            "row_count": getattr(obj, "row_count", None),
            "schema": getattr(obj, "schema_snapshot", None) or {},
            "lake_object_id": str(obj.id) if getattr(obj, "id", None) else None,
            "created_at": obj.created_at.isoformat() if getattr(obj, "created_at", None) else None,
        }
        for name, obj in sorted(best.items())
    ]


async def load_managed_lakehouse(ds_id: str) -> Optional[Dict[str, Any]]:
    """None when no enabled pipeline manages the source; otherwise the pipeline
    and the tables it serves (possibly empty, i.e. not ready yet)."""
    from sqlalchemy import select

    from src.db.session import async_session
    from src.modules.data.models import DataLakeObject, DataPipeline

    async with async_session() as db:
        pipeline = (
            await db.execute(
                select(DataPipeline).where(
                    DataPipeline.source_asset_type == "data_source",
                    DataPipeline.source_asset_id == str(ds_id),
                    DataPipeline.enabled.is_(True),
                )
            )
        ).scalars().first()
        if pipeline is None:
            return None
        objects = (
            await db.execute(
                select(DataLakeObject).where(
                    DataLakeObject.data_source_id == str(ds_id),
                    DataLakeObject.layer.in_(["silver", "gold"]),
                    DataLakeObject.status == "active",
                )
            )
        ).scalars().all()
        return {"pipeline": pipeline, "tables": select_serving_tables(objects)}


async def _last_run_status(pipeline_id: uuid.UUID) -> Optional[str]:
    from sqlalchemy import desc, select

    from src.db.session import async_session
    from src.modules.data.models import DataIngestionJob

    async with async_session() as db:
        last_run = (
            await db.execute(
                select(DataIngestionJob)
                .where(DataIngestionJob.pipeline_id == pipeline_id)
                .order_by(desc(DataIngestionJob.created_at))
                .limit(1)
            )
        ).scalars().first()
    return last_run.status if last_run else None


async def resolve_query_source(data_source: Dict[str, Any]) -> Dict[str, Any]:
    """`data_source` unchanged, unless an enabled pipeline manages it.

    - Not a routable type, or no id -> unchanged.
    - No enabled DataPipeline for it -> unchanged (not opted in / a draft).
    - Enabled pipeline, no active Silver/Gold table yet -> LakehouseNotReady.
    - Otherwise a synthetic `lakehouse_iceberg` source listing every served
      table; the DuckDB loader exposes each under its real name, and the
      pipeline's primary table also as "data".
    """
    ds_type = (data_source.get("type") or "").lower()
    if ds_type == "lakehouse_iceberg":
        return await resolve_gold_source(data_source)
    if ds_type not in ROUTABLE_TYPES:
        return data_source
    ds_id = data_source.get("id") or data_source.get("data_source_id")
    if not ds_id:
        return data_source

    managed = await load_managed_lakehouse(str(ds_id))
    if managed is None:
        return data_source
    pipeline, tables = managed["pipeline"], managed["tables"]
    if not tables:
        raise LakehouseNotReady(pipeline_id=pipeline.id, last_run_status=await _last_run_status(pipeline.id))

    preferred = (getattr(pipeline, "options", None) or {}).get("source_table")
    primary = next((t for t in tables if t["name"] == preferred), tables[0])
    return {
        **data_source,
        "type": "lakehouse_iceberg",
        "original_type": ds_type,
        "storage_uri": primary["storage_uri"],
        "format": "iceberg",
        "schema": primary["schema"],
        "source_table": primary["name"],
        "lakehouse_tables": tables,
        "pipeline_id": str(pipeline.id),
        "pipeline_name": getattr(pipeline, "name", None),
    }


def lakehouse_schema_info(resolved: Dict[str, Any]) -> Dict[str, Any]:
    """Schema of a resolved lakehouse source for SQL generation: every served
    table under its real name (so multi-table joins are possible), falling back
    to the single "data" table for a dict without `lakehouse_tables`."""
    def business_columns(schema: Optional[Dict[str, Any]]) -> List[Any]:
        return [
            c for c in (schema or {}).get("columns", [])
            if not (isinstance(c, dict) and c.get("name") in PIPELINE_AUDIT_COLUMNS)
        ]

    tables = resolved.get("lakehouse_tables") or []
    if tables:
        return {
            "tables": [
                {
                    "name": t["name"],
                    "columns": business_columns(t.get("schema")),
                    "row_count": t.get("row_count"),
                    "layer": t.get("layer"),
                }
                for t in tables
            ]
        }
    return {"tables": [{"name": "data", "columns": business_columns(resolved.get("schema"))}]}


def _connection_config(data_source: Dict[str, Any]) -> Dict[str, Any]:
    cc = data_source.get("connection_config") or {}
    if isinstance(cc, str):
        import json

        try:
            cc = json.loads(cc)
        except (TypeError, ValueError):
            cc = {}
    return cc if isinstance(cc, dict) else {}


async def _stored_connection_config(ds_id: str) -> Dict[str, Any]:
    from sqlalchemy import select

    from src.db.session import async_session
    from src.modules.data.models import DataSource

    async with async_session() as db:
        raw = (
            await db.execute(select(DataSource.connection_config).where(DataSource.id == ds_id))
        ).scalars().first()
    return _connection_config({"connection_config": raw})


async def resolve_gold_source(data_source: Dict[str, Any]) -> Dict[str, Any]:
    """A pipeline-generated "(Gold Lakehouse)" DataSource, resolved live.

    Its stored connection_config is a snapshot from when the pipeline last
    wrote it; instead of trusting that, serve the newest Silver/Gold table for
    every table of the source it derives from (found via the lake objects it
    references). Falls back to the stored config when nothing better exists.
    """
    if data_source.get("lakehouse_tables"):
        return data_source  # already resolved
    cc = _connection_config(data_source)
    if not cc and (data_source.get("id") or data_source.get("data_source_id")):
        # Callers such as the AI orchestrator pass only {id, type}
        cc = await _stored_connection_config(str(data_source.get("id") or data_source.get("data_source_id")))
    stored_tables = cc.get("lakehouse_tables") or []
    lake_ids = [t.get("lake_object_id") for t in stored_tables if t.get("lake_object_id")]
    if cc.get("lake_object_id"):
        lake_ids.append(cc["lake_object_id"])

    tables: List[Dict[str, Any]] = []
    origin_id = cc.get("origin_data_source_id")
    if lake_ids or origin_id:
        from sqlalchemy import select

        from src.db.session import async_session
        from src.modules.data.models import DataLakeObject

        async with async_session() as db:
            if not origin_id:
                ids = []
                for raw in lake_ids:
                    try:
                        ids.append(uuid.UUID(str(raw)))
                    except ValueError:
                        continue
                if ids:
                    origin_id = (
                        await db.execute(
                            select(DataLakeObject.data_source_id).where(DataLakeObject.id.in_(ids)).limit(1)
                        )
                    ).scalars().first()
            if origin_id:
                objects = (
                    await db.execute(
                        select(DataLakeObject).where(
                            DataLakeObject.data_source_id == str(origin_id),
                            DataLakeObject.layer.in_(["silver", "gold"]),
                            DataLakeObject.status == "active",
                        )
                    )
                ).scalars().all()
                tables = select_serving_tables(objects)

    if not tables:
        if not cc.get("storage_uri"):
            return data_source
        tables = stored_tables or [
            {"name": cc.get("source_table") or "data", "storage_uri": cc["storage_uri"], "schema": {}}
        ]

    preferred = cc.get("source_table")
    primary = next((t for t in tables if t["name"] == preferred), tables[0])
    return {
        **data_source,
        "type": "lakehouse_iceberg",
        "storage_uri": primary["storage_uri"],
        "format": "iceberg",
        "schema": primary.get("schema") or {},
        "source_table": primary["name"],
        "lakehouse_tables": tables,
        "origin_data_source_id": str(origin_id) if origin_id else None,
    }
