"""Save rows as a new dataset (a file data source), for results people want to keep: location
analysis, notebook cells, model scores.

It goes through the upload endpoint itself, so a saved result gets exactly what an uploaded
file gets: the plan's data-source limit, the upload permission check, compressed Parquet
storage, the owner's access grant and a schema for the AI and chart builders.
"""

from __future__ import annotations

import os
import re
import tempfile
from typing import Any, Dict, Optional

import pyarrow as pa
import pyarrow.parquet as pq
from fastapi import HTTPException, UploadFile

MAX_DATASET_ROWS = int(os.getenv("SAVED_DATASET_MAX_ROWS", "1000000"))


def _file_name(name: str) -> str:
    base = re.sub(r"[^\w\- ]+", "", name).strip().replace(" ", "_") or "dataset"
    return f"{base[:80]}.parquet"


async def save_table_as_dataset(
    current_token: Any, name: str, table: pa.Table, *, project_id: Optional[str] = None
) -> Dict[str, Any]:
    """Store ``table`` as a dataset named ``name``; returns the upload endpoint's response
    ({success, data_source: {id, name, …}})."""
    if table.num_rows == 0:
        raise HTTPException(status_code=400, detail="There are no rows to save.")
    if table.num_rows > MAX_DATASET_ROWS:
        raise HTTPException(status_code=400, detail=f"Datasets are limited to {MAX_DATASET_ROWS:,} rows.")
    from src.modules.data.router import upload_file

    fd, path = tempfile.mkstemp(suffix=".parquet")
    os.close(fd)
    try:
        pq.write_table(table, path, compression="zstd")
        with open(path, "rb") as handle:
            upload = UploadFile(file=handle, filename=_file_name(name), size=os.path.getsize(path))
            return await upload_file(
                file=upload,
                name=name.strip()[:120] or "Saved result",
                include_preview=False,
                sheet_name=None,
                delimiter=",",
                header_row=None,
                preview_only=False,
                upload_with_prompt=False,
                project_id=project_id,
                current_token=current_token,
            )
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass


def records_to_table(records: list, columns: Optional[list] = None) -> pa.Table:
    """Rows (list of dicts) as an Arrow table, keeping column order."""
    if not records:
        return pa.table({c: [] for c in (columns or [])})
    cols = columns or list(records[0].keys())
    return pa.table({c: [r.get(c) for r in records] for c in cols})


async def refresh_dataset(data_source_id: str, table: pa.Table, *, organization_id: Optional[str],
                          user_id: Optional[str]) -> Dict[str, Any]:
    """Replace the rows of a dataset saved earlier, keeping its id — so charts, dashboards,
    alerts and saved queries built on it show the new rows (scheduled model scores, for
    example). The new file gets a new storage key; the old file is removed afterwards."""
    from datetime import datetime, timezone

    from src.db.session import async_session
    from src.modules.data.models import DataSource
    from src.modules.data.services.data_connectivity_service import DataConnectivityService
    from src.modules.data.services.multi_engine_query_service import (
        invalidate_api_response_cache, invalidate_query_result_cache,
    )
    from src.modules.data.services.upload_datasource_storage_service import UploadDatasourceStorageService

    if table.num_rows == 0:
        raise HTTPException(status_code=400, detail="There are no rows to save.")
    if table.num_rows > MAX_DATASET_ROWS:
        raise HTTPException(status_code=400, detail=f"Datasets are limited to {MAX_DATASET_ROWS:,} rows.")
    async with async_session() as db:
        ds = await db.get(DataSource, str(data_source_id))
        if ds is None or ds.type != "file" or ds.is_active is False:
            raise HTTPException(status_code=404, detail="The dataset to refresh no longer exists.")
        if organization_id and str(ds.organization_id or "") != str(organization_id):
            raise HTTPException(status_code=404, detail="The dataset to refresh no longer exists.")
        project_id = str(ds.project_id) if ds.project_id else None
        old_key, filename = ds.file_path, ds.original_filename or _file_name(ds.name)

    fd, path = tempfile.mkstemp(suffix=".parquet")
    os.close(fd)
    try:
        pq.write_table(table, path, compression="zstd")
        with open(path, "rb") as handle:
            content = handle.read()
        storage = UploadDatasourceStorageService()
        new_key = await storage.store_file(
            file_content=content, project_id=project_id, original_filename=filename,
            content_type="application/x-parquet", source_id=str(data_source_id),
            organization_id=organization_id, user_id=user_id,
        )
        service = DataConnectivityService()
        _, schema = await service._process_parquet_file(path)
    finally:
        try:
            os.unlink(path)
        except OSError:
            pass

    async with async_session() as db:
        ds = await db.get(DataSource, str(data_source_id))
        old_schema = ds.schema if isinstance(ds.schema, dict) else {}
        if isinstance(schema, dict) and old_schema.get("storage"):
            schema["storage"] = {**old_schema["storage"], "stored_size_bytes": len(content)}
        ds.file_path = new_key
        ds.schema = schema
        ds.row_count = int(table.num_rows)
        ds.size = len(content)
        ds.updated_at = datetime.now(timezone.utc)
        await db.commit()
    service.invalidate_data_source_cache(str(data_source_id))
    invalidate_api_response_cache(str(data_source_id))
    invalidate_query_result_cache()
    if old_key and old_key != new_key:
        try:
            await storage.delete_file(old_key, project_id)
        except Exception:  # an orphaned old file is harmless; the dataset already points at the new one
            pass
    return {"success": True, "data_source": {"id": str(data_source_id), "name": ds.name}, "rows": int(table.num_rows)}
