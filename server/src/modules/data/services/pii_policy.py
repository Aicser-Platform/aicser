"""
Once-per-dataset PII column policy.

Classify sensitive columns cheaply (name heuristics + optional sample regex),
persist under ``schema["pii_policy"]``, and reuse on every Analyze turn.

Controlled by ``AISER_PII_DETECTION`` (see ``pii_settings.is_pii_detection_enabled``).
Structured masking applies only to **LLM prompt copies** — never to frontend
query results. Free-text Presidio scrubbing is a separate opt-in
(``AISER_PII_GATE_ENABLED``).
"""

from __future__ import annotations

import hashlib
import logging
import re
from datetime import datetime, timezone
from typing import Any, Dict, List, Optional, Sequence, Tuple

from src.modules.data.services.pii_scrubber import _is_pii_column_name
from src.modules.data.services.pii_settings import is_pii_detection_enabled

logger = logging.getLogger(__name__)

PII_POLICY_VERSION = 1

# Light value probes — same spirit as catalog policy_engine, no Presidio.
_SAMPLE_VALUE_PROBES: Tuple[Tuple[str, re.Pattern[str]], ...] = (
    ("email", re.compile(r"^[^@\s]+@[^@\s]+\.[^@\s]+$")),
    ("phone", re.compile(r"^[\+\d\s\-\(\)\.]{7,20}$")),
    ("ssn", re.compile(r"^\d{3}-\d{2}-\d{4}$")),
    ("credit_card", re.compile(r"^\d{4}[\s\-]?\d{4}[\s\-]?\d{4}[\s\-]?\d{4}$")),
    ("ip_address", re.compile(r"^\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}$")),
)


def _col_name(col: Any) -> Optional[str]:
    if isinstance(col, str) and col.strip():
        return col.strip()
    if isinstance(col, dict):
        name = col.get("name") or col.get("column_name") or col.get("field")
        if isinstance(name, str) and name.strip():
            return name.strip()
    return None


def iter_schema_columns(schema: Optional[Dict[str, Any]]) -> List[Tuple[str, str]]:
    """Return ``(table_name, column_name)`` pairs from a stored schema dict."""
    if not isinstance(schema, dict):
        return []
    out: List[Tuple[str, str]] = []
    tables = schema.get("tables")
    if not isinstance(tables, list):
        return out
    for table in tables:
        if not isinstance(table, dict):
            continue
        tname = str(table.get("name") or table.get("table") or "").strip() or "data"
        for col in table.get("columns") or []:
            cname = _col_name(col)
            if cname:
                out.append((tname, cname))
    return out


def schema_column_fingerprint(schema: Optional[Dict[str, Any]]) -> str:
    """Stable hash of table.column inventory — invalidates policy when schema changes."""
    pairs = iter_schema_columns(schema)
    blob = "\n".join(f"{t}.{c}".lower() for t, c in sorted(pairs))
    return hashlib.sha256(blob.encode("utf-8")).hexdigest()[:32]


def columns_from_pii_policy(schema: Optional[Dict[str, Any]]) -> List[str]:
    """Bare column names from a valid embedded ``pii_policy``, else []."""
    if not isinstance(schema, dict):
        return []
    policy = schema.get("pii_policy")
    if not isinstance(policy, dict):
        return []
    cols = policy.get("columns")
    if not isinstance(cols, list):
        return []
    return [str(c).strip() for c in cols if str(c).strip()]


def pii_policy_is_fresh(schema: Optional[Dict[str, Any]]) -> bool:
    if not isinstance(schema, dict):
        return False
    policy = schema.get("pii_policy")
    if not isinstance(policy, dict):
        return False
    if int(policy.get("version") or 0) != PII_POLICY_VERSION:
        return False
    fp = str(policy.get("fingerprint") or "")
    if not fp:
        return False
    return fp == schema_column_fingerprint(schema)


def _sample_rows_for_table(table: Dict[str, Any], limit: int = 5) -> List[Dict[str, Any]]:
    raw = table.get("sample_data") or table.get("sample_rows") or []
    if not isinstance(raw, list):
        return []
    return [r for r in raw[:limit] if isinstance(r, dict)]


def classify_pii_columns(
    schema: Optional[Dict[str, Any]],
    *,
    extra_columns: Optional[Sequence[str]] = None,
) -> Dict[str, Any]:
    """
    Build a fresh PII policy from schema column names (+ light sample regex).

    Never runs Presidio. Safe to call on every schema load; callers should
    short-circuit via ``pii_policy_is_fresh`` when already cached.
    """
    pairs = iter_schema_columns(schema)
    sensitive: List[str] = []
    seen: set[str] = set()
    reasons: Dict[str, str] = {}

    def _add(name: str, reason: str) -> None:
        key = name.strip()
        if not key or key.lower() in seen:
            return
        seen.add(key.lower())
        sensitive.append(key)
        reasons[key] = reason

    for _table, cname in pairs:
        if _is_pii_column_name(cname):
            _add(cname, "column_name")

    if isinstance(schema, dict):
        for table in schema.get("tables") or []:
            if not isinstance(table, dict):
                continue
            for row in _sample_rows_for_table(table):
                for col, val in row.items():
                    if not isinstance(col, str) or col.lower() in seen:
                        continue
                    if not isinstance(val, str) or len(val) < 5:
                        continue
                    for label, pat in _SAMPLE_VALUE_PROBES:
                        if pat.match(val.strip()):
                            _add(col, f"sample:{label}")
                            break

    for name in extra_columns or []:
        if isinstance(name, str) and name.strip():
            _add(name.strip(), "catalog_or_cls")

    return {
        "version": PII_POLICY_VERSION,
        "fingerprint": schema_column_fingerprint(schema),
        "columns": sensitive,
        "reasons": reasons,
        "detected_at": datetime.now(timezone.utc).isoformat(),
        "method": "column_name_heuristic+sample_regex",
    }


def ensure_schema_pii_policy(
    schema: Optional[Dict[str, Any]],
    *,
    extra_columns: Optional[Sequence[str]] = None,
    force: bool = False,
) -> Tuple[Optional[Dict[str, Any]], List[str], bool]:
    """
    Attach / refresh ``schema["pii_policy"]``.

    Returns ``(schema, columns, rebuilt)``. ``rebuilt`` is True when a new
    policy was computed (caller may persist to DataSource + Redis).

    When ``AISER_PII_DETECTION`` is off, returns existing columns (if any)
    without reclassifying — non-blocking no-op for Analyze.
    """
    if not isinstance(schema, dict):
        return schema, [], False

    if not is_pii_detection_enabled() and not force:
        return schema, columns_from_pii_policy(schema), False

    if not force and pii_policy_is_fresh(schema) and not extra_columns:
        cols = columns_from_pii_policy(schema)
        return schema, cols, False

    if not force and pii_policy_is_fresh(schema) and extra_columns:
        # Merge extras into existing policy without full reclassify when fingerprint matches.
        existing = columns_from_pii_policy(schema)
        merged = list(dict.fromkeys(existing + [str(c).strip() for c in extra_columns if str(c).strip()]))
        if merged == existing:
            return schema, existing, False
        policy = dict(schema.get("pii_policy") or {})
        policy["columns"] = merged
        policy["detected_at"] = datetime.now(timezone.utc).isoformat()
        schema = dict(schema)
        schema["pii_policy"] = policy
        return schema, merged, True

    policy = classify_pii_columns(schema, extra_columns=extra_columns)
    schema = dict(schema)
    schema["pii_policy"] = policy
    cols = list(policy.get("columns") or [])
    logger.info(
        "PII policy classified %d sensitive column(s) (fingerprint=%s)",
        len(cols),
        policy.get("fingerprint"),
    )
    return schema, cols, True
