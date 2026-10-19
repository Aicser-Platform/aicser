"""What a text column really holds: dates (in any mix of formats), numbers, true/false.

Runs over the preview sample in DuckDB with the same parsing the steps use, so what detection
promises is exactly what the step will produce.
"""

from __future__ import annotations

import re
from datetime import datetime
from typing import Any, Dict, List, Optional, Sequence

from src.modules.prep.engine.steps import FALSE_WORDS, TRUE_WORDS, date_expr, number_expr, quote_ident

# Common written date formats, most specific first. Day-first comes before month-first;
# when both fit equally the column is flagged as ambiguous for the person to confirm.
DATE_FORMATS: List[str] = [
    "%Y-%m-%d %H:%M:%S", "%Y-%m-%dT%H:%M:%S", "%Y-%m-%d %H:%M", "%Y-%m-%d", "%Y/%m/%d", "%Y.%m.%d", "%Y%m%d",
    "%d/%m/%Y %H:%M:%S", "%d/%m/%Y %H:%M", "%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%d-%m-%y",
    "%m/%d/%Y %H:%M:%S", "%m/%d/%Y %H:%M", "%m/%d/%Y", "%m-%d-%Y", "%m/%d/%y",
    "%d %b %Y", "%d-%b-%Y", "%d %B %Y", "%d-%B-%Y", "%d-%b-%y", "%d %b %y", "%b %d, %Y", "%B %d, %Y", "%b %d %Y",
    "%a, %d %b %Y", "%A, %d %B %Y", "%b-%Y", "%B %Y",
]
DAY_FIRST = {"%d/%m/%Y", "%d-%m-%Y", "%d.%m.%Y", "%d/%m/%y", "%d-%m-%y", "%d/%m/%Y %H:%M", "%d/%m/%Y %H:%M:%S"}
MONTH_FIRST = {"%m/%d/%Y", "%m-%d-%Y", "%m/%d/%y", "%m/%d/%Y %H:%M", "%m/%d/%Y %H:%M:%S"}

ENOUGH = 0.95
# Optional sign/bracket, currency symbol or 3-letter code, digits with separators, optional %.
NUMBER_LOOK = r"\(?[-+]?\s*(?:[$€£¥₹៛]|[A-Z]{3}\s)?\s*\d[\d.,\s]*%?\)?(?:\s*[A-Z]{3})?"
SAMPLE_VALUES = 2000
DATE_NAME = re.compile(r"(date|time|day|dob|birth|registered|created|updated|_at$|_on$|month|year)", re.IGNORECASE)


def _values(conn, view: str, column: str) -> List[str]:
    col = quote_ident(column)
    rows = conn.execute(
        f"SELECT CAST({col} AS VARCHAR) FROM {view} WHERE {col} IS NOT NULL AND trim(CAST({col} AS VARCHAR)) <> '' LIMIT {SAMPLE_VALUES}"
    ).fetchall()
    return [r[0] for r in rows]


def _coverage(conn, values: Sequence[str], expr_for: str) -> float:
    """Share of values the expression reads (expr_for uses v as the column)."""
    if not values:
        return 0.0
    conn.execute("CREATE OR REPLACE TEMP TABLE _detect_v AS SELECT unnest(?::VARCHAR[]) AS v", [list(values)])
    hit = conn.execute(f"SELECT count(*) FILTER (WHERE {expr_for} IS NOT NULL), count(*) FROM _detect_v").fetchone()
    return (hit[0] / hit[1]) if hit and hit[1] else 0.0


def _date_formats(conn, values: Sequence[str]) -> tuple[List[str], float, bool]:
    """Greedy: add formats until the column is covered (mixed formats in one column are common)."""
    conn.execute("CREATE OR REPLACE TEMP TABLE _detect_v AS SELECT unnest(?::VARCHAR[]) AS v", [list(values)])
    total = len(values)
    matched: Dict[str, int] = {}
    for fmt in DATE_FORMATS:
        n = conn.execute(f"SELECT count(*) FROM _detect_v WHERE TRY_STRPTIME(trim(v), '{fmt}') IS NOT NULL").fetchone()[0]
        if n:
            matched[fmt] = n
    if not matched:
        return [], 0.0, False
    chosen: List[str] = []
    covered = 0.0
    for _ in range(4):
        best, best_cov = None, covered
        for fmt in matched:
            if fmt in chosen:
                continue
            cov = _coverage(conn, values, date_expr("v", chosen + [fmt]))
            if cov > best_cov + 0.001:
                best, best_cov = fmt, cov
        if best is None:
            break
        chosen.append(best)
        covered = best_cov
        if covered >= ENOUGH:
            break
    ambiguous = False
    for fmt in chosen:
        twin = None
        if fmt in DAY_FIRST:
            twin = fmt.replace("%d", "%_").replace("%m", "%d").replace("%_", "%m")
        if twin and matched.get(twin) == matched.get(fmt):
            ambiguous = True
    return chosen, covered, ambiguous


def detect_column(conn, view: str, column: str, storage_type: str) -> Optional[Dict[str, Any]]:
    """A set_types spec for one column, or None when it's fine as it is."""
    st = (storage_type or "").lower()
    if any(t in st for t in ("int", "double", "float", "decimal", "date", "time", "bool")):
        # Excel dates often arrive as plain numbers (45569 = 2024-10-03).
        if any(t in st for t in ("int", "double", "float")) and DATE_NAME.search(column):
            values = _values(conn, view, column)
            nums = [float(v) for v in values if re.fullmatch(r"\d+(\.\d+)?", v)]
            if values and len(nums) == len(values) and all(20000 <= n <= 80000 for n in nums):
                return {"type": "date", "excel_serial": True, "coverage": 1.0}
        return None
    values = _values(conn, view, column)
    if len(values) < 3:
        return None
    lowered = {v.strip().lower() for v in values}
    if lowered and lowered <= set(TRUE_WORDS + FALSE_WORDS) and len(lowered) >= 2:
        return {"type": "boolean", "coverage": 1.0}
    formats, date_cov, ambiguous = _date_formats(conn, values)
    if formats and date_cov >= 0.8:
        timed = any("%H" in f for f in formats)
        spec: Dict[str, Any] = {"type": "datetime" if timed else "date", "formats": formats, "coverage": round(date_cov, 4)}
        if ambiguous:
            spec["ambiguous"] = True
        return spec
    best: Optional[Dict[str, Any]] = None
    # Only text that looks like a number counts ("EN-Grade 1" is a label, not 1).
    def numeric_looking(expr: str) -> str:
        return "CASE WHEN regexp_full_match(trim(v), '" + NUMBER_LOOK + "') THEN " + expr + " END"

    for locale in ("us", "eu"):
        cov = _coverage(conn, values, numeric_looking(number_expr("v", locale=locale)))
        if cov >= ENOUGH and (best is None or cov > best["coverage"]):
            best = {"type": "number", "locale": locale, "coverage": round(cov, 4)}
    if best:
        integral = conn.execute(
            f"SELECT bool_and({number_expr('v', locale=best['locale'])} = round({number_expr('v', locale=best['locale'])})) "
            "FROM _detect_v WHERE " + number_expr("v", locale=best["locale"]) + " IS NOT NULL"
        ).fetchone()[0]
        if integral and not any("%" in v for v in values):
            best["type"] = "integer"
        return best
    return None


def detect_types(conn, view: str) -> Dict[str, Dict[str, Any]]:
    described = conn.execute(f"DESCRIBE {view}").fetchall()
    out: Dict[str, Dict[str, Any]] = {}
    for row in described:
        spec = detect_column(conn, view, row[0], str(row[1]))
        if spec:
            out[row[0]] = spec
    return out


def formats_for_example(example: str) -> List[str]:
    """Date formats that read an example such as '03-Oct-2026' (most specific first)."""
    text = (example or "").strip()
    if not text:
        return []
    out = []
    for fmt in DATE_FORMATS:
        try:
            datetime.strptime(text, fmt)
            out.append(fmt)
        except ValueError:
            continue
    return out


def failing_examples(conn, view: str, column: str, spec: Dict[str, Any], limit: int = 5) -> List[str]:
    from src.modules.prep.engine.steps import typed_expr

    col = quote_ident(column)
    expr = typed_expr(col, spec)
    rows = conn.execute(
        f"SELECT DISTINCT CAST({col} AS VARCHAR) FROM {view} WHERE {col} IS NOT NULL "
        f"AND trim(CAST({col} AS VARCHAR)) <> '' AND {expr} IS NULL LIMIT {int(limit)}"
    ).fetchall()
    return [r[0] for r in rows]
