"""Clean copy: one connection per source that holds the prepared version of its tables.

Saving a recipe used to add a new connection per table, so a source with twenty tables became
twenty connections that Ask could not join. Now every table cleaned from a source lands in that
source's clean copy (one connection per source and project), stored as a single DuckDB file:
saving a table replaces just that table, and "save all" fills it from every published recipe,
copying the tables nobody prepared as they are. The connection keeps its id across saves, so
charts and dashboards built on it keep working.

The copy is linked to its source in ``schema.prepared_from`` ({data_source_id, tables: {...}}),
so no extra table is needed. Rows are read through ``governed_sql`` like every Prepare read: the
copy holds what the person saving it may see.
"""

from __future__ import annotations

import asyncio
import os
import re
import tempfile
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional

import pyarrow as pa
from fastapi import HTTPException

from src.modules.data.services.governed_sql import Caller

STORAGE_FORMAT = "duckdb"
SAMPLE_ROWS = 50
_LOCKS: Dict[str, asyncio.Lock] = {}
_UNSAFE = re.compile(r"[^A-Za-z0-9_]+")


def _quote(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def table_name_for(source: Dict[str, Any], table: str) -> str:
    """The name a source table gets in the clean copy: ``schema.table`` loses the schema (or
    keeps it, joined by _, when another table has the same name); a file's ``data`` is its
    first table's name."""
    tables = [t.get("name") for t in ((source.get("schema") or {}).get("tables") or []) if isinstance(t, dict)]
    if table == "data" and tables:
        table = str(tables[0])
    if "." in table:
        parent, _, name = table.rpartition(".")
        clashes = sum(1 for t in tables if str(t).rpartition(".")[2].lower() == name.lower())
        table = name if clashes <= 1 else f"{parent}_{name}"
    clean = _UNSAFE.sub("_", table).strip("_") or "data"
    return clean[:120]


async def find(db: Any, source_id: str, project_id: Optional[str]) -> Optional[Dict[str, Any]]:
    """The clean copy of ``source_id`` in ``project_id``, as {id, name, updated_at, tables}."""
    from sqlalchemy import text

    row = (await db.execute(text(
        "SELECT id, name, updated_at, schema FROM data_sources "
        "WHERE schema->'prepared_from'->>'data_source_id' = :sid "
        "AND COALESCE(is_active, true) "
        "AND (CAST(:pid AS text) IS NULL OR project_id::text = :pid) "
        "ORDER BY updated_at DESC NULLS LAST LIMIT 1"
    ), {"sid": str(source_id), "pid": str(project_id) if project_id else None})).first()
    if not row:
        return None
    schema = row[3] if isinstance(row[3], dict) else {}
    return {
        "id": str(row[0]),
        "name": row[1],
        "updated_at": row[2].isoformat() if row[2] else None,
        "tables": ((schema.get("prepared_from") or {}).get("tables") or {}),
    }


async def list_for_project(db: Any, project_id: Optional[str]) -> List[Dict[str, Any]]:
    """Every clean copy in the project: {id, name, source_id, updated_at, tables}."""
    from sqlalchemy import text

    if not project_id:
        return []
    rows = (await db.execute(text(
        "SELECT id, name, updated_at, schema->'prepared_from' FROM data_sources "
        "WHERE schema->'prepared_from' IS NOT NULL AND project_id::text = :pid "
        "AND COALESCE(is_active, true)"
    ), {"pid": str(project_id)})).all()
    out = []
    for row in rows:
        link = row[3] if isinstance(row[3], dict) else {}
        out.append({"id": str(row[0]), "name": row[1], "source_id": link.get("data_source_id"),
                    "updated_at": row[2].isoformat() if row[2] else None, "tables": link.get("tables") or {}})
    return out


def _write_tables(path: str, tables: Dict[str, pa.Table], drop: List[str]) -> Dict[str, Any]:
    """Replace ``tables`` in the DuckDB file at ``path`` (created when missing); returns its
    schema: every table with its columns and row count, and the first rows of the first one."""
    import duckdb

    conn = duckdb.connect(path)
    try:
        for name in drop:
            conn.execute(f"DROP TABLE IF EXISTS {_quote(name)}")
        for name, table in tables.items():
            conn.register("_incoming", table)
            conn.execute(f"CREATE OR REPLACE TABLE {_quote(name)} AS SELECT * FROM _incoming")
            conn.unregister("_incoming")
        names = [r[0] for r in conn.execute(
            "SELECT table_name FROM duckdb_tables() WHERE schema_name = 'main' ORDER BY table_name").fetchall()]
        described = []
        for name in names:
            columns = [{"name": c[0], "type": c[1]} for c in conn.execute(f"DESCRIBE {_quote(name)}").fetchall()]
            rows = conn.execute(f"SELECT COUNT(*) FROM {_quote(name)}").fetchone()[0]
            described.append({"name": name, "columns": columns, "row_count": int(rows)})
        sample: List[Dict[str, Any]] = []
        if names:
            result = conn.execute(f"SELECT * FROM {_quote(names[0])} LIMIT {SAMPLE_ROWS}")
            cols = [d[0] for d in result.description]
            sample = [dict(zip(cols, r)) for r in result.fetchall()]
        conn.execute("CHECKPOINT")
        return {"tables": described, "sample": sample}
    finally:
        conn.close()


async def save(caller: Caller, db: Any, source: Dict[str, Any], tables: Dict[str, pa.Table],
               details: Dict[str, Dict[str, Any]], *, name: Optional[str] = None,
               replace_all: bool = False) -> Dict[str, Any]:
    """Put ``tables`` (clean-copy name -> rows) into the source's clean copy, creating it on the
    first save. ``replace_all`` drops the tables not in ``tables``. Returns {id, name, tables}."""
    from src.modules.data.services.data_connectivity_service import DataConnectivityService
    from src.modules.data.services.upload_datasource_storage_service import UploadDatasourceStorageService

    source_id = str(source["id"])
    lock = _LOCKS.setdefault(f"{source_id}:{caller.project_id}", asyncio.Lock())
    async with lock:
        existing = await find(db, source_id, caller.project_id)
        service = DataConnectivityService()
        storage = UploadDatasourceStorageService()
        current = await service.get_data_source_by_id(existing["id"]) if existing else None

        fd, path = tempfile.mkstemp(suffix=".duckdb")
        os.close(fd)
        os.unlink(path)  # duckdb makes the file; an empty one is not a database
        try:
            if current and current.get("file_path"):
                try:
                    content = await storage.get_file(current["file_path"], current.get("project_id"))
                    with open(path, "wb") as f:
                        f.write(content)
                except Exception as exc:  # noqa: BLE001 - rebuilt from what is being saved
                    if not replace_all:
                        raise HTTPException(status_code=502, detail=f"The clean copy could not be read: {exc}") from exc
            kept = set((existing or {}).get("tables") or {})
            drop = [t for t in kept if t not in tables] if replace_all else []
            described = await asyncio.to_thread(_write_tables, path, tables, drop)
            with open(path, "rb") as f:
                content = f.read()
        finally:
            for leftover in (path, f"{path}.wal"):
                try:
                    os.unlink(leftover)
                except OSError:
                    pass

        copy_id = existing["id"] if existing else None
        if not copy_id:
            import uuid

            copy_id = str(uuid.uuid4())
        display = (current or {}).get("name") or name or f"{source.get('name') or 'Source'} (clean)"
        object_key = await storage.store_file(
            file_content=content, project_id=caller.project_id, original_filename=f"{_UNSAFE.sub('_', display)}.duckdb",
            content_type="application/vnd.duckdb", source_id=copy_id,
            organization_id=caller.organization_id, user_id=caller.user_id,
        )

        now = datetime.now(timezone.utc).isoformat()
        linked = {} if replace_all else dict((existing or {}).get("tables") or {})
        for table_name, info in details.items():
            linked[table_name] = {**info, "saved_at": now}
        present = {t["name"] for t in described["tables"]}
        linked = {k: v for k, v in linked.items() if k in present}
        first = described["tables"][0] if described["tables"] else {"name": "data", "columns": [], "row_count": 0}
        total = sum(t["row_count"] for t in described["tables"])
        schema = {
            "tables": described["tables"],
            "columns": first["columns"],
            "table_name": first["name"],
            "primary_table": first["name"],
            "row_count": total,
            "total_rows": total,
            "storage": {"backend": storage.storage_type, "format": STORAGE_FORMAT, "stored_size_bytes": len(content)},
            "prepared_from": {"data_source_id": source_id, "source_name": source.get("name"), "tables": linked},
        }
        record = {
            "id": copy_id,
            "name": display,
            "type": "file",
            "format": STORAGE_FORMAT,
            "size": len(content),
            "row_count": total,
            "schema": schema,
            "file_path": object_key,
            "original_filename": f"{display}.duckdb",
            "sample_data": described["sample"],
            "project_id": caller.project_id,
            "organization_id": caller.organization_id or (str(source.get("organization_id")) if source.get("organization_id") else None),
            "user_id": caller.user_id,
        }
        if not await service._save_data_source_to_db(record):
            raise HTTPException(status_code=500, detail="The clean copy could not be saved.")

        old_key = (current or {}).get("file_path")
        if old_key and old_key != object_key:
            try:
                await storage.delete_file(old_key, (current or {}).get("project_id"))
            except Exception:  # noqa: BLE001 - an orphaned old file is harmless
                pass
        from src.modules.data.services import file_extracts

        file_extracts.drop_for_source(copy_id)
        _forget_cached(service, copy_id)
        return {"id": copy_id, "name": display, "tables": described["tables"], "linked": linked}


def _forget_cached(service: Any, source_id: str) -> None:
    """Drop any in-memory copy of the source so the next read sees the new file."""
    try:
        service.data_sources.pop(source_id, None)
    except Exception:  # noqa: BLE001
        pass


def load_into(conn: Any, path: str) -> List[str]:
    """Copy every table of a clean-copy file into ``conn`` (the query engine's DuckDB), plus a
    ``data`` view over the first one, which queries without a table name read."""
    safe = path.replace("'", "''")
    conn.execute(f"ATTACH '{safe}' AS aicser_clean_copy (READ_ONLY)")
    try:
        names = [r[0] for r in conn.execute(
            "SELECT table_name FROM duckdb_tables() WHERE database_name = 'aicser_clean_copy' "
            "AND schema_name = 'main' ORDER BY table_name").fetchall()]
        for name in names:
            conn.execute(f"CREATE TABLE main.{_quote(name)} AS SELECT * FROM aicser_clean_copy.main.{_quote(name)}")
    finally:
        conn.execute("DETACH aicser_clean_copy")
    if names and "data" not in names:
        conn.execute(f"CREATE VIEW data AS SELECT * FROM {_quote(names[0])}")
    return names
