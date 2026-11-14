"""Does a newly connected file or sheet need tidying before it is used?

Checked once, right after an upload or a new sheet connection, on a sample. Fine data gets an
empty answer and nobody is interrupted. Data that needs work gets the problems and the Prepare
steps that fix them, so one click opens a recipe already started.

What is checked is the table's shape, never its words: header names a reader made up (because the
real headers sit lower, under a title), rows above the headers, near-empty rows under the data
(notes, sign-offs), empty columns — then Prepare's own findings (numbers or dates stored as text,
placeholder values for missing, repeated rows). A header that spans two rows is joined.
"""

from __future__ import annotations

import asyncio
import re
from statistics import median
from typing import Any, Dict, List, Optional, Sequence

READINESS_ROWS = 500
HEADER_SEARCH_ROWS = 10
FOOTER_SEARCH_ROWS = 5
# Names readers give columns that had no header: column0, Unnamed: 3, _c1, field_2, A, AB, or blank.
_GENERATED = re.compile(r"^\s*$|^(column|col|field|unnamed:?|_c|c)[\s_]*\d+$|^[A-Z]{1,2}$", re.I)


def _empty(value: Any) -> bool:
    return value is None or (isinstance(value, str) and not value.strip())


def _number(value: Any) -> bool:
    if isinstance(value, (int, float)) and not isinstance(value, bool):
        return True
    if isinstance(value, str):
        try:
            float(value.replace(",", "").replace("%", "").strip())
            return True
        except ValueError:
            return False
    return False


def _header_like(row: Sequence[Any], min_fill: float = 0.6) -> bool:
    """Mostly filled with text, no numbers: how a header row looks (merged cells may repeat)."""
    filled = [v for v in row if not _empty(v)]
    return len(filled) >= max(2, min_fill * len(row)) and not any(_number(v) for v in filled)


def _spans(row: Sequence[Any]) -> bool:
    """A header that groups the columns under it: repeated or blank cells (merged in the sheet)."""
    texts = [str(v).strip().lower() for v in row if not _empty(v)]
    return len(set(texts)) < len(row)


def _distinct(row: Sequence[Any]) -> bool:
    texts = [str(v).strip().lower() for v in row if not _empty(v)]
    return len(set(texts)) == len(texts)


def _names(rows: List[Sequence[Any]], columns: List[str]) -> Dict[str, str]:
    """Column → name from one or more header rows (joined with a space), unique, never empty."""
    used: set = set()
    out: Dict[str, str] = {}
    for i, col in enumerate(columns):
        parts = [str(r[i]).strip() for r in rows if i < len(r) and not _empty(r[i])]
        base = " ".join(dict.fromkeys(parts)) or col
        name, n = base, 2
        while name.lower() in used:
            name, n = f"{base} {n}", n + 1
        used.add(name.lower())
        out[col] = name
    return out


def shape_findings(columns: List[str], rows: List[Sequence[Any]]) -> List[Dict[str, Any]]:
    """Problems with the table's shape, each with the Prepare step that fixes it."""
    found: List[Dict[str, Any]] = []
    if len(columns) < 2 or not rows:
        return found

    generated = sum(1 for c in columns if _GENERATED.match(str(c)))
    if generated >= len(columns) / 2:
        start = next((k for k in range(min(HEADER_SEARCH_ROWS, len(rows))) if _header_like(rows[k])), None)
        if start is not None:
            below = rows[start + 1] if start + 1 < len(rows) else None
            depth = 2 if below is not None and _spans(rows[start]) and _header_like(below, 0.8) and _distinct(below) else 1
            names = _names(rows[start:start + depth], columns)
            found.append({"code": "headers_below_title", "params": {"skip": start, "rows": depth},
                          "suggested_step": {"header_rows": {"skip": start, "rows": depth, "names": names}}})
            rows = rows[start + depth:]
        else:
            found.append({"code": "no_headers", "params": {"columns": generated}, "suggested_step": None})

    fills = [sum(0 if _empty(v) else 1 for v in r) / len(columns) for r in rows]
    if len(fills) > FOOTER_SEARCH_ROWS * 2:
        typical = median(fills)
        bottom = 0
        for f in reversed(fills[-FOOTER_SEARCH_ROWS:]):
            if f <= min(0.34, typical / 3):
                bottom += 1
            else:
                break
        if bottom:
            found.append({"code": "notes_below_data", "params": {"rows": bottom},
                          "suggested_step": {"remove_rows": {"bottom": bottom}}})

    if len(rows) >= 20 and not any(f["code"] == "headers_below_title" for f in found):
        empty = [c for i, c in enumerate(columns) if all(_empty(r[i]) for r in rows if i < len(r))]
        if empty and len(empty) < len(columns):
            found.append({"code": "empty_columns", "params": {"columns": empty[:20], "count": len(empty)},
                          "suggested_step": {"drop": {"columns": empty}}})
    return found


async def readiness(caller, data_source_id: str, table: Optional[str] = None) -> Dict[str, Any]:
    """{needs_prep, table, issues: [{code, params, column?}], steps: [...]} for a new source."""
    from src.modules.prep import insights
    from src.modules.prep.service import _connection_over, load_sample

    _source, name, sample = await load_sample(caller, data_source_id, table, READINESS_ROWS)

    def run() -> Dict[str, Any]:
        columns = list(sample.column_names)
        rows = [list(r.values()) for r in sample.to_pylist()]
        issues = shape_findings(columns, rows)
        if not any(i["code"] in ("headers_below_title", "no_headers") for i in issues):
            # Content findings only make sense once the headers are right; warnings only.
            conn = _connection_over(sample)
            for f in insights.suggestions(conn, "src"):
                if f.get("severity") == "warning" and f.get("suggested_step"):
                    issues.append({"code": f["code"], "column": f.get("column"), "params": {
                        k: v for k, v in (f.get("params") or {}).items() if k in ("column", "type", "count", "coverage")},
                        "suggested_step": f["suggested_step"]})
        steps = [i["suggested_step"] for i in issues if i.get("suggested_step")]
        return {"needs_prep": bool(issues), "table": name, "rows_checked": len(rows),
                "issues": [{k: v for k, v in i.items() if k != "suggested_step"} for i in issues], "steps": steps}

    return await asyncio.to_thread(run)
