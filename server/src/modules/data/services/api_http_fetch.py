"""HTTP fetch helpers for universal API data sources and pipeline ingest."""

from __future__ import annotations

import json
from typing import Any, Dict, List, Optional, Tuple

import aiohttp


def parse_connection_config(raw: Any) -> Dict[str, Any]:
    if isinstance(raw, str):
        try:
            raw = json.loads(raw)
        except json.JSONDecodeError:
            return {}
    return dict(raw) if isinstance(raw, dict) else {}


def build_request(
    config: Dict[str, Any],
    *,
    stream_name: Optional[str] = None,
) -> Tuple[str, str, Dict[str, str], Optional[aiohttp.BasicAuth], Dict[str, Any]]:
    from src.modules.data.services.api_stream_catalog import resolve_stream_config

    merged = resolve_stream_config(config, stream_name) if stream_name else config
    if merged.get("url") and str(merged["url"]).startswith("http"):
        api_url = str(merged["url"]).strip()
    else:
        base = (merged.get("url") or merged.get("base_url") or "").strip().rstrip("/")
        path = (merged.get("path") or "").strip().lstrip("/")
        if path.startswith("http://") or path.startswith("https://"):
            api_url = path
        elif base and path:
            api_url = f"{base}/{path}"
        else:
            api_url = base or path
    if not api_url:
        raise ValueError("API URL is required (url or base_url in connection config)")

    method = (merged.get("method") or "GET").upper()
    headers = merged.get("headers") or {}
    if isinstance(headers, str):
        try:
            headers = json.loads(headers)
        except json.JSONDecodeError:
            headers = {}
    params = dict(merged.get("params") or {})

    auth = None
    auth_type = (merged.get("auth_type") or "").strip().lower() or "api_key"
    if auth_type == "basic" and merged.get("username") is not None:
        auth = aiohttp.BasicAuth(str(merged["username"]), str(merged.get("password") or ""))
    elif auth_type == "bearer" and merged.get("bearer_token"):
        headers["Authorization"] = f"Bearer {merged['bearer_token']}"
    elif merged.get("api_key"):
        headers[merged.get("api_key_header", "X-API-Key")] = merged["api_key"]
    elif merged.get("password") and merged.get("url"):
        headers["Authorization"] = f"Bearer {merged['password']}"

    since_param = merged.get("since_param") or merged.get("watermark_param")
    watermark = merged.get("_watermark_value")
    if since_param and watermark is not None:
        params[str(since_param)] = watermark

    return method, api_url, headers, auth, params


def rows_from_payload(data: Any, json_path: Optional[str] = None) -> List[Dict[str, Any]]:
    if json_path and isinstance(data, dict):
        parts = json_path.split(".")
        cur: Any = data
        for p in parts:
            if isinstance(cur, dict):
                cur = cur.get(p)
            else:
                cur = None
                break
        if isinstance(cur, list):
            return [r for r in cur if isinstance(r, dict)]
    if isinstance(data, list):
        return [r for r in data if isinstance(r, dict)]
    if isinstance(data, dict):
        for key in ("data", "results", "items", "records", "rows"):
            inner = data.get(key)
            if isinstance(inner, list):
                return [r for r in inner if isinstance(r, dict)]
        return [data]
    return []


async def fetch_api_rows(
    config: Dict[str, Any],
    *,
    stream_name: Optional[str] = None,
    max_rows: int = 100_000,
    watermark_value: Optional[str] = None,
) -> List[Dict[str, Any]]:
    from src.modules.data.services.api_stream_catalog import resolve_stream_config

    merged = resolve_stream_config(config, stream_name)
    if watermark_value is not None:
        merged = {**merged, "_watermark_value": watermark_value}
    json_path = merged.get("json_path")
    method, url, headers, auth, params = build_request(merged, stream_name=None)
    pagination = (merged.get("pagination_type") or "none").lower()
    page_size = int(merged.get("page_size") or merged.get("limit") or 500)
    timeout = max(5, min(120, int(merged.get("timeout", 30))))
    rows: List[Dict[str, Any]] = []

    async with aiohttp.ClientSession() as session:
        if pagination == "none":
            async with session.request(
                method,
                url,
                headers=headers,
                params=params,
                auth=auth,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                if resp.status >= 400:
                    text = await resp.text()
                    raise ValueError(f"API HTTP {resp.status}: {text[:500]}")
                data = await resp.json(content_type=None)
            rows = rows_from_payload(data, json_path)
            return rows[:max_rows]

        page = int(merged.get("page_start", 1))
        offset = 0
        cursor = merged.get("cursor_start")
        page_param = merged.get("page_param") or "page"
        offset_param = merged.get("offset_param") or "offset"
        limit_param = merged.get("limit_param") or "limit"
        cursor_param = merged.get("cursor_param") or "cursor"

        while len(rows) < max_rows:
            q = dict(params)
            if pagination == "page_number":
                q[page_param] = page
                q[limit_param] = page_size
            elif pagination == "offset_limit":
                q[offset_param] = offset
                q[limit_param] = page_size
            elif pagination == "cursor":
                if cursor is not None:
                    q[cursor_param] = cursor

            async with session.request(
                method,
                url,
                headers=headers,
                params=q,
                auth=auth,
                timeout=aiohttp.ClientTimeout(total=timeout),
            ) as resp:
                if resp.status >= 400:
                    break
                data = await resp.json(content_type=None)

            batch = rows_from_payload(data, json_path)
            if not batch:
                break
            rows.extend(batch)
            if len(batch) < page_size:
                break
            if pagination == "page_number":
                page += 1
            elif pagination == "offset_limit":
                offset += page_size
            elif pagination == "cursor":
                cursor_field = merged.get("cursor_field") or "next_cursor"
                if isinstance(data, dict):
                    cursor = data.get(cursor_field)
                else:
                    cursor = None
                if not cursor:
                    break
            else:
                break

    return rows[:max_rows]
