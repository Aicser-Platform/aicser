"""
Multi-stream REST/API catalog: configured streams[], OpenAPI discovery, and sampling.

Used by universal `api` data sources, pipeline discover/preview/ingest, and Ask schema fetch.
"""

from __future__ import annotations

import json
import logging
import re
from typing import Any, Dict, List, Optional, Tuple

import aiohttp

logger = logging.getLogger(__name__)

_STREAM_DEFAULTS = {
    "method": "GET",
    "pagination_type": "none",
}


def _as_dict(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return {}
    return dict(raw) if isinstance(raw, dict) else {}


def normalize_stream_entry(entry: Any, index: int = 0) -> Optional[Dict[str, Any]]:
    if not isinstance(entry, dict):
        return None
    name = (entry.get("name") or entry.get("stream_name") or "").strip()
    if not name:
        name = f"stream_{index}"
    out = {**_STREAM_DEFAULTS, **entry}
    out["name"] = name
    if entry.get("path") and not out.get("path"):
        out["path"] = entry["path"]
    return out


def configured_streams(config: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Explicit streams from connection_config.streams (Airbyte-style)."""
    cfg = _as_dict(config)
    raw = cfg.get("streams")
    if not isinstance(raw, list):
        return []
    streams: List[Dict[str, Any]] = []
    for i, item in enumerate(raw):
        norm = normalize_stream_entry(item, i)
        if norm:
            streams.append(norm)
    return streams


def resolve_stream_config(
    config: Dict[str, Any],
    stream_name: Optional[str] = None,
) -> Dict[str, Any]:
    """Merge base API config with a named stream overlay (path, pagination, keys)."""
    cfg = _as_dict(config)
    base = {k: v for k, v in cfg.items() if k != "streams"}
    if not stream_name or stream_name in ("__default__", "api_data", "data"):
        streams = configured_streams(cfg)
        if len(streams) == 1:
            return {**base, **streams[0]}
        return base
    for s in configured_streams(cfg):
        if s["name"] == stream_name:
            return {**base, **s}
    # Legacy: stream_name as relative path
    merged = dict(base)
    merged["path"] = stream_name.lstrip("/") if not stream_name.startswith("http") else ""
    if stream_name.startswith("http"):
        merged["url"] = stream_name
    elif stream_name.startswith("/"):
        merged["path"] = stream_name.lstrip("/")
    else:
        merged["path"] = stream_name
    merged["name"] = stream_name
    return merged


async def fetch_openapi_spec(url: str, config: Dict[str, Any]) -> Optional[Dict[str, Any]]:
    from src.modules.data.services.api_http_fetch import fetch_api_rows

    try:
        # OpenAPI spec URL returns JSON document (not tabular rows)
        import aiohttp

        cfg = _as_dict(config)
        headers = cfg.get("headers") or {}
        timeout = max(5, min(60, int(cfg.get("timeout", 30))))
        async with aiohttp.ClientSession() as session:
            async with session.get(url, headers=headers, timeout=aiohttp.ClientTimeout(total=timeout)) as resp:
                if resp.status >= 400:
                    return None
                return await resp.json(content_type=None)
    except Exception as exc:
        logger.info("OpenAPI fetch failed for %s: %s", url, exc)
        return None


def streams_from_openapi(spec: Dict[str, Any], *, max_paths: int = 40) -> List[Dict[str, Any]]:
    """Map OpenAPI 3 paths to stream entries (GET list endpoints preferred)."""
    paths = spec.get("paths") if isinstance(spec, dict) else None
    if not isinstance(paths, dict):
        return []
    streams: List[Dict[str, Any]] = []
    for path, methods in paths.items():
        if not isinstance(methods, dict):
            continue
        for method, detail in methods.items():
            if method.lower() != "get":
                continue
            if not isinstance(detail, dict):
                continue
            op_id = detail.get("operationId") or path.strip("/").replace("/", "_") or "resource"
            name = re.sub(r"[^a-zA-Z0-9_]+", "_", op_id).strip("_")[:120] or "stream"
            streams.append(
                {
                    "name": name,
                    "path": path.lstrip("/"),
                    "method": "GET",
                    "openapi": True,
                    "summary": detail.get("summary") or detail.get("description"),
                }
            )
            if len(streams) >= max_paths:
                break
        if len(streams) >= max_paths:
            break
    return streams


async def discover_api_streams(
    config: Dict[str, Any],
    *,
    sample_rows: int = 25,
) -> List[Dict[str, Any]]:
    """
    Build catalog tables[] for each stream: configured streams, then OpenAPI, then default single endpoint.
    """
    cfg = _as_dict(config)
    streams = configured_streams(cfg)
    if not streams:
        openapi_url = (cfg.get("openapi_url") or cfg.get("openapi_spec_url") or "").strip()
        if openapi_url:
            spec = await fetch_openapi_spec(openapi_url, cfg)
            if spec:
                streams = streams_from_openapi(spec)
    if not streams:
        default_name = cfg.get("default_stream") or "api_data"
        streams = [{"name": default_name, "path": cfg.get("path") or "", "method": cfg.get("method") or "GET"}]

    from src.modules.data.services.api_http_fetch import fetch_api_rows

    tables: List[Dict[str, Any]] = []
    for stream in streams:
        name = stream["name"]
        merged = resolve_stream_config(cfg, name)
        columns: List[Dict[str, Any]] = []
        row_count: Optional[int] = None
        note: Optional[str] = None
        try:
            rows = await fetch_api_rows(merged, stream_name=name, max_rows=sample_rows)
            if rows:
                row_count = len(rows)
                for col_name in rows[0].keys():
                    columns.append({"name": str(col_name), "type": "string", "nullable": True})
        except Exception as exc:
            note = str(exc)
        pk = stream.get("primary_key") or stream.get("primary_key_fields")
        if isinstance(pk, str):
            pk = [pk]
        cursor = stream.get("cursor_field") or stream.get("cursor_column") or stream.get("watermark_column")
        tbl: Dict[str, Any] = {
            "name": name,
            "columns": columns,
            "row_count": row_count,
            "primary_key": pk if isinstance(pk, list) else None,
            "default_cursor_field": cursor,
            "stream_config": {k: stream.get(k) for k in ("path", "method", "pagination_type", "since_param")},
        }
        if note:
            tbl["note"] = note
        tables.append(tbl)
    return tables


def infer_schema_tables_from_streams(tables: List[Dict[str, Any]]) -> Dict[str, Any]:
    return {
        "tables": tables,
        "streams": [t["name"] for t in tables],
        "multi_stream": len(tables) > 1,
    }
