"""Data contract rules shared by Prepare (Community) and the Catalog (Enterprise).

Types are compared by family, so DuckDB and Arrow spellings of the same type agree.
"""

from __future__ import annotations

import re
from typing import Any, Dict, Iterable, List, Optional

_FAMILIES = (
    ("boolean", re.compile(r"^bool")),
    ("timestamp", re.compile(r"timestamp|datetime")),
    ("date", re.compile(r"^date")),
    ("number", re.compile(r"int|double|float|decimal|numeric|real|number")),
    ("text", re.compile(r"char|text|string|utf8|uuid|enum")),
)


def type_family(raw: Optional[str]) -> str:
    value = (raw or "").strip().lower()
    for family, pattern in _FAMILIES:
        if pattern.search(value):
            return family
    return value or "unknown"


def breaking_changes(promised: Iterable[Dict[str, Any]], removed: Iterable[str], retyped: Iterable[Dict[str, Any]]) -> List[Dict[str, Any]]:
    """Which promises a change to the table's columns (e.g. a Prepare draft) would break."""
    required = {c["name"]: c for c in promised if c.get("required", True)}
    out = [{"code": "missing_column", "column": name} for name in removed if name in required]
    for change in retyped:
        col = required.get(change["column"])
        if col and col.get("type") and type_family(change.get("to")) != col["type"]:
            out.append({"code": "type_changed", "column": change["column"], "expected": col["type"], "actual": type_family(change.get("to"))})
    return out
