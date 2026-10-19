"""Refresh live data ranges into an IronCalc document (server-side, for scheduled runs)."""
from __future__ import annotations

import re
from datetime import datetime, timezone
from typing import Any, Callable, Dict, List, Tuple

from src.modules.workbooks.engine import WorkbookError

_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,39})\s*\}\}")
_LANGUAGE = "en"


def substitute_sql_parameters(sql: str, values: Dict[str, Any]) -> str:
    def repl(m: re.Match[str]) -> str:
        name = m.group(1)
        if name not in values:
            return m.group(0)
        v = values[name]
        return "" if v is None else str(v)

    return _PLACEHOLDER.sub(repl, sql)


def _cell_input(value: Any) -> str | None:
    if value is None:
        return None
    if isinstance(value, bool):
        return "TRUE" if value else "FALSE"
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return str(value)
    text = str(value)
    if text.startswith(("=", "+", "-", "@")):
        return f"'{text}"
    return f"'{text}"


def _write_table(model: Any, sheet: int, row: int, column: int, columns: List[str], rows: List[List[Any]]) -> Tuple[int, int]:
    for c, name in enumerate(columns):
        model.set_user_input(sheet, row, column + c, f"'{name}")
    for ri, values in enumerate(rows):
        for c in range(len(columns)):
            inp = _cell_input(values[c] if c < len(values) else None)
            if inp is not None:
                model.set_user_input(sheet, row + 1 + ri, column + c, inp)
    return len(columns), len(rows) + 1


def _clear_area(model: Any, sheet: int, row: int, column: int, width: int, height: int) -> None:
    if width <= 0 or height <= 0:
        return
    if hasattr(model, "range_clear_all"):
        model.range_clear_all(sheet, row, column, row + height - 1, column + width - 1)
        return
    for r in range(row, row + height):
        for c in range(column, column + width):
            model.set_user_input(sheet, r, c, "")


async def refresh_workbook_ranges(
    doc: bytes,
    ranges: List[Dict[str, Any]],
    settings_raw: dict | None,
    run_parameters: Dict[str, Any],
    *,
    query_fn: Callable[[str, str], Any],
) -> Tuple[bytes, List[Dict[str, Any]], Dict[str, Any]]:
    """
    Re-run live ranges and patch the workbook document.

    ``query_fn(sql, data_source_id)`` must return dict with ``columns`` and ``rows``.
    """
    import ironcalc  # optional runtime dep (same as workbooks.engine)

    if not doc:
        raise WorkbookError("The workbook is empty.")
    model = ironcalc.load_from_bytes(bytes(doc), _LANGUAGE)
    from src.modules.notebooks.parameters import resolve_parameters

    settings = settings_raw or {}
    from src.modules.notebooks.settings_schema import parse_settings

    values = resolve_parameters(parse_settings(settings), run_parameters)
    out_ranges: List[Dict[str, Any]] = []
    errors: List[Dict[str, str]] = []
    ok = 0
    now = datetime.now(timezone.utc).isoformat()

    for raw in ranges:
        r = dict(raw)
        if r.get("mode") != "live" or not r.get("data_source_id") or not r.get("sql"):
            out_ranges.append(r)
            continue
        rid = str(r.get("id") or "")
        try:
            sql = substitute_sql_parameters(str(r["sql"]), values)
            data = await query_fn(sql, str(r["data_source_id"]))
            columns = list(data.get("columns") or [])
            rows = list(data.get("rows") or [])
            sheet = int(r.get("sheet") or 0)
            row = int(r.get("row") or 1)
            col = int(r.get("column") or 1)
            w = int(r.get("width") or 0)
            h = int(r.get("height") or 0)
            if w and h:
                _clear_area(model, sheet, row, col, w, h)
            width, height = _write_table(model, sheet, row, col, columns, rows)
            r["width"] = width
            r["height"] = height
            r["refreshed_at"] = now
            r["row_count"] = len(rows)
            r["truncated"] = bool(data.get("truncated"))
            r["pending"] = False
            ok += 1
        except Exception as exc:
            errors.append({"range_id": rid, "error": str(exc)})
        out_ranges.append(r)

    model.evaluate()
    new_doc = bytes(model.to_bytes())
    summary = {"ranges_refreshed": ok, "errors": errors}
    return new_doc, out_ranges, summary
