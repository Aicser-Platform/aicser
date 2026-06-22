"""Resolve a usable schema for CE NL2SQL across file, DB, warehouse, and API sources."""

from __future__ import annotations

import json
import logging
from datetime import date, datetime
from typing import Any, Dict, Optional, Tuple

from src.modules.data.capabilities import supports_live_schema_fetch
from src.modules.data.services.data_connectivity_service import DataConnectivityService
from src.modules.nl2sql.schema_context import has_usable_schema, normalize_schema

logger = logging.getLogger(__name__)


def parse_schema_field(value: Any) -> Dict[str, Any]:
    if isinstance(value, dict):
        return dict(value)
    if isinstance(value, str) and value.strip():
        try:
            parsed = json.loads(value)
            return parsed if isinstance(parsed, dict) else {}
        except (json.JSONDecodeError, TypeError):
            return {}
    return {}


def _serialize_dates(obj: Any) -> Any:
    if isinstance(obj, (datetime, date)):
        return obj.isoformat()
    if isinstance(obj, dict):
        return {k: _serialize_dates(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [_serialize_dates(item) for item in obj]
    return obj


def infer_file_schema_from_source(source: Dict[str, Any]) -> Dict[str, Any]:
    """Build normalized {tables: [...]} schema for file uploads."""
    stored = normalize_schema(parse_schema_field(source.get("schema")))
    if has_usable_schema(stored):
        return stored

    sample_data = source.get("sample_data")
    if isinstance(sample_data, str):
        try:
            sample_data = json.loads(sample_data)
        except (json.JSONDecodeError, TypeError):
            sample_data = None
    if sample_data:
        sample_data = _serialize_dates(sample_data)

    if isinstance(sample_data, list) and sample_data:
        first_row = sample_data[0]
        if isinstance(first_row, dict):
            columns = []
            for col_name, col_value in first_row.items():
                col_type = "string"
                if isinstance(col_value, (int, float)) and not isinstance(col_value, bool):
                    col_type = "number"
                elif isinstance(col_value, bool):
                    col_type = "boolean"
                elif isinstance(col_value, str):
                    try:
                        datetime.fromisoformat(col_value.replace("Z", "+00:00"))
                        col_type = "date"
                    except ValueError:
                        col_type = "string"
                columns.append({"name": col_name, "type": col_type, "nullable": True})
            if columns:
                return {
                    "tables": [{
                        "name": "data",
                        "columns": columns,
                        "row_count": len(sample_data),
                    }],
                    "connection_database": "default",
                }

    return stored


async def resolve_usable_schema(
    data_service: DataConnectivityService,
    data_source_id: str,
    *,
    force_refresh: bool = False,
) -> Tuple[Optional[Dict[str, Any]], Optional[Dict[str, Any]]]:
    """
    Return (data_source_dict, normalized_schema) with at least one table that has columns.
    """
    ds = await data_service.get_data_source_by_id(data_source_id)
    if not ds:
        return None, None

    ds_type = (ds.get("type") or "").strip().lower()
    schema = normalize_schema(parse_schema_field(ds.get("schema")))

    if has_usable_schema(schema) and not force_refresh:
        return ds, schema

    refreshed: Optional[Dict[str, Any]] = None
    try:
        if ds_type in ("database", "warehouse"):
            result = await data_service.get_database_schema(data_source_id, force_refresh=force_refresh)
            if result.get("success") and isinstance(result.get("schema"), dict):
                refreshed = normalize_schema(result["schema"])
            elif isinstance(result.get("schema"), dict):
                refreshed = normalize_schema(result["schema"])
        elif ds_type == "api":
            result = await data_service.get_database_schema(data_source_id, force_refresh=force_refresh)
            if result.get("success") and isinstance(result.get("schema"), dict):
                refreshed = normalize_schema(result["schema"])
        elif ds_type == "sample_duckdb":
            result = await data_service.get_sample_duckdb_schema(ds)
            if result.get("success") and isinstance(result.get("schema"), dict):
                refreshed = normalize_schema(result["schema"])
        elif ds_type == "google_sheets":
            result = await data_service.get_google_sheets_schema(ds)
            if result.get("success") and isinstance(result.get("schema"), dict):
                refreshed = normalize_schema(result["schema"])
        elif ds_type == "file":
            refreshed = infer_file_schema_from_source(ds)
        elif supports_live_schema_fetch(ds_type):
            result = await data_service.get_database_schema(data_source_id, force_refresh=force_refresh)
            if result.get("success") and isinstance(result.get("schema"), dict):
                refreshed = normalize_schema(result["schema"])
    except Exception as exc:
        logger.warning("Schema refresh failed for %s (%s): %s", data_source_id, ds_type, exc)

    if refreshed and has_usable_schema(refreshed):
        return ds, refreshed

    if has_usable_schema(schema):
        return ds, schema

    return ds, schema if schema else None
