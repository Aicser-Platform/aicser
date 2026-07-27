"""
Shared time-intelligence helpers for KPI period-over-period and date windows.
Mirrors client dashboards/utils/timeIntelligence.ts (Gregorian calendar).
"""

from __future__ import annotations

from datetime import date, datetime, timedelta
from typing import Any, Dict, List, Optional, Tuple

COMPARISON_PERIOD_LABELS = {
    "wow": "vs last week",
    "mom": "vs last month",
    "qoq": "vs last quarter",
    "yoy": "vs last year",
}

VALID_COMPARISON_PERIODS = frozenset(COMPARISON_PERIOD_LABELS.keys())


def _parse_date(value: Any) -> Optional[date]:
    if value is None:
        return None
    if isinstance(value, datetime):
        return value.date()
    if isinstance(value, date):
        return value
    s = str(value).strip()
    if len(s) >= 10 and s[4] == "-" and s[7] == "-":
        try:
            return date.fromisoformat(s[:10])
        except ValueError:
            return None
    return None


def _add_months(d: date, months: int) -> date:
    """Shift calendar month; clamp day to last valid day of target month."""
    year = d.year + (d.month - 1 + months) // 12
    month = (d.month - 1 + months) % 12 + 1
    # last day of target month
    if month == 12:
        last = date(year + 1, 1, 1) - timedelta(days=1)
    else:
        last = date(year, month + 1, 1) - timedelta(days=1)
    day = min(d.day, last.day)
    return date(year, month, day)


def shift_date_range_for_comparison(
    from_s: str, to_s: str, period: str
) -> Tuple[str, str]:
    start = _parse_date(from_s)
    end = _parse_date(to_s)
    if not start or not end:
        return from_s, to_s

    if period == "wow":
        return (start - timedelta(days=7)).isoformat(), (end - timedelta(days=7)).isoformat()
    if period == "mom":
        return _add_months(start, -1).isoformat(), _add_months(end, -1).isoformat()
    if period == "qoq":
        return _add_months(start, -3).isoformat(), _add_months(end, -3).isoformat()
    if period == "yoy":
        return _add_months(start, -12).isoformat(), _add_months(end, -12).isoformat()
    return from_s, to_s


def _is_date_like(value: Any) -> bool:
    return _parse_date(value) is not None


def shift_filters_for_comparison(
    filters: Optional[List[Dict[str, Any]]], period: str
) -> Optional[List[Dict[str, Any]]]:
    """
    Shift >= / <= / between date filters for PoP.
    Returns None when no date bounds are present or period is invalid.
    """
    if period not in VALID_COMPARISON_PERIODS:
        return None
    if not isinstance(filters, list) or not filters:
        return None

    from_d: Optional[str] = None
    to_d: Optional[str] = None
    from_field: Optional[str] = None
    to_field: Optional[str] = None

    for f in filters:
        if not isinstance(f, dict):
            continue
        op = str(f.get("operator") or "").strip()
        val = f.get("value")
        field = str(f.get("field") or "")
        if op in (">=", ">") and _is_date_like(val):
            from_d = str(val)[:10]
            from_field = field
        if op in ("<=", "<") and _is_date_like(val):
            to_d = str(val)[:10]
            to_field = field
        if op == "between" and isinstance(val, (list, tuple)) and len(val) >= 2:
            if _is_date_like(val[0]) and _is_date_like(val[1]):
                from_d = str(val[0])[:10]
                to_d = str(val[1])[:10]
                from_field = to_field = field

    if not from_d or not to_d:
        return None
    if from_field and to_field and from_field != to_field:
        return None

    shifted_from, shifted_to = shift_date_range_for_comparison(from_d, to_d, period)

    out: List[Dict[str, Any]] = []
    for f in filters:
        if not isinstance(f, dict):
            out.append(f)
            continue
        nf = dict(f)
        op = str(nf.get("operator") or "").strip()
        val = nf.get("value")
        if op in (">=", ">") and _is_date_like(val):
            nf["value"] = shifted_from
        elif op in ("<=", "<") and _is_date_like(val):
            nf["value"] = shifted_to
        elif op == "between" and isinstance(val, (list, tuple)) and len(val) >= 2:
            if _is_date_like(val[0]) and _is_date_like(val[1]):
                nf["value"] = [shifted_from, shifted_to]
        out.append(nf)
    return out
