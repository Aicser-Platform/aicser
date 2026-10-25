"""What each step did, what the data looks like, and what to fix next.

Everything runs over the preview sample with the compiled step CTEs, so the numbers people
see ("14 dates couldn't be read") are about exactly the rows they are looking at.
"""

from __future__ import annotations

import json
import re
from typing import Any, Dict, List, Optional

from src.modules.prep.detect import detect_types, failing_examples
from src.modules.prep.engine.compiler import compile_steps
from src.modules.prep.engine.steps import quote_ident

HIST_BINS = 12
TOP_VALUES = 6
DIFF_ROWS = 200


def _with(compiled, name: str) -> str:
    """The compiled CTE chain ending at one step."""
    head = compiled.sql.rsplit(" SELECT * FROM ", 1)[0]
    return f"{head} SELECT * FROM {name}"


def _schema(conn, sql: str) -> List[tuple[str, str]]:
    return [(r[0], str(r[1])) for r in conn.execute(f"DESCRIBE ({sql})").fetchall()]


def step_stats(conn, steps: List[Dict[str, Any]], source_sql: str) -> List[Dict[str, Any]]:
    """Per step: rows in/out, columns added/removed, values emptied."""
    try:
        compiled = compile_steps(steps, source_sql=source_sql)
    except ValueError:
        return []
    out: List[Dict[str, Any]] = []
    prev_cols: List[tuple[str, str]] = []
    prev_rows = 0
    prev_nulls: Dict[str, int] = {}
    for i, name in enumerate(compiled.cte_names):
        sql = _with(compiled, name)
        try:
            cols = _schema(conn, sql)
            counts = ", ".join(f"count({quote_ident(c)})" for c, _ in cols) or "0"
            row = conn.execute(f"SELECT count(*), {counts} FROM ({sql})").fetchone()
        except Exception as exc:  # noqa: BLE001 - this step and the ones after can't run
            if i > 0:
                out.append({"step": i - 1, "error": str(exc)})
            break
        rows = int(row[0])
        nulls = {c: rows - int(row[j + 1]) for j, (c, _) in enumerate(cols)}
        if i > 0:
            names = [c for c, _ in cols]
            prev_names = [c for c, _ in prev_cols]
            prev_types = dict(prev_cols)
            emptied = {
                c: nulls[c] - prev_nulls[c]
                for c in names
                if c in prev_nulls and nulls[c] > prev_nulls[c] and rows == prev_rows
            }
            out.append({
                "step": i - 1,
                "rows": rows,
                "rows_delta": rows - prev_rows,
                "added": [c for c in names if c not in prev_names],
                "removed": [c for c in prev_names if c not in names],
                "retyped": [c for c, t in cols if c in prev_types and prev_types[c] != t],
                "emptied": emptied,
            })
        prev_cols, prev_rows, prev_nulls = cols, rows, nulls
    return out


def step_changes(conn, steps: List[Dict[str, Any]], source_sql: str, step: int, limit: int) -> Dict[str, Any]:
    """Which displayed cells the selected step changed (same row positions before and after)."""
    try:
        compiled = compile_steps(steps[: step + 1], source_sql=source_sql)
    except ValueError:
        return {}
    before_name, after_name = compiled.cte_names[-2], compiled.cte_names[-1]
    before_sql, after_sql = _with(compiled, before_name), _with(compiled, after_name)
    try:
        before_cols = [c for c, _ in _schema(conn, before_sql)]
        after_cols = [c for c, _ in _schema(conn, after_sql)]
        n_before = conn.execute(f"SELECT count(*) FROM ({before_sql})").fetchone()[0]
        n_after = conn.execute(f"SELECT count(*) FROM ({after_sql})").fetchone()[0]
    except Exception:  # noqa: BLE001
        return {}
    result: Dict[str, Any] = {
        "added": [c for c in after_cols if c not in before_cols],
        "removed": [c for c in before_cols if c not in after_cols],
        "changed": {},
    }
    shared = [c for c in after_cols if c in before_cols]
    if n_before != n_after or not shared:
        return result
    pairs = ", ".join(
        f"(CAST(b.{quote_ident(c)} AS VARCHAR) IS DISTINCT FROM CAST(a.{quote_ident(c)} AS VARCHAR))" for c in shared
    )
    rows = conn.execute(
        f"SELECT {pairs} FROM (SELECT * FROM ({before_sql}) LIMIT {int(limit)}) b "
        f"POSITIONAL JOIN (SELECT * FROM ({after_sql}) LIMIT {int(limit)}) a"
    ).fetchall()
    changed: Dict[str, List[int]] = {}
    for idx, flags in enumerate(rows):
        for c, flag in zip(shared, flags):
            if flag:
                changed.setdefault(c, []).append(idx)
    result["changed"] = changed
    return result


def failed_values(conn, steps: List[Dict[str, Any]], source_sql: str, step: int, column: str, limit: int = 50) -> List[Dict[str, Any]]:
    """Values a step turned empty, most frequent first."""
    compiled = compile_steps(steps[: step + 1], source_sql=source_sql)
    before_sql = _with(compiled, compiled.cte_names[-2])
    after_sql = _with(compiled, compiled.cte_names[-1])
    col = quote_ident(column)
    rows = conn.execute(
        f"SELECT CAST(b.v AS VARCHAR) AS value, count(*) AS n FROM (SELECT {col} AS v FROM ({before_sql})) b "
        f"POSITIONAL JOIN (SELECT {col} AS w FROM ({after_sql})) a "
        f"WHERE b.v IS NOT NULL AND a.w IS NULL GROUP BY 1 ORDER BY n DESC, value LIMIT {int(limit)}"
    ).fetchall()
    return [{"value": r[0], "count": int(r[1])} for r in rows]


def distributions(conn, view: str) -> Dict[str, Dict[str, Any]]:
    """Per column: quality (filled/empty) and a histogram or top values."""
    out: Dict[str, Dict[str, Any]] = {}
    total = conn.execute(f"SELECT count(*) FROM {view}").fetchone()[0] or 0
    for name, ctype in [(r[0], str(r[1]).upper()) for r in conn.execute(f"DESCRIBE {view}").fetchall()]:
        col = quote_ident(name)
        empty, distinct = conn.execute(
            f"SELECT count(*) FILTER (WHERE {col} IS NULL OR trim(CAST({col} AS VARCHAR)) = ''), count(DISTINCT {col}) FROM {view}"
        ).fetchone()
        info: Dict[str, Any] = {"rows": int(total), "empty": int(empty), "distinct": int(distinct)}
        numeric = any(t in ctype for t in ("INT", "DOUBLE", "FLOAT", "DECIMAL", "REAL", "HUGEINT"))
        temporal = any(t in ctype for t in ("DATE", "TIME"))
        if (numeric or temporal) and distinct > 1:
            value = f"epoch(CAST({col} AS TIMESTAMP))" if temporal else f"CAST({col} AS DOUBLE)"
            lo, hi = conn.execute(f"SELECT min({value}), max({value}) FROM {view}").fetchone()
            if lo is not None and hi is not None and hi > lo:
                width = (hi - lo) / HIST_BINS
                bins = conn.execute(
                    f"SELECT least(floor(({value} - {lo}) / {width}), {HIST_BINS - 1})::INT AS b, count(*) "
                    f"FROM {view} WHERE {col} IS NOT NULL GROUP BY 1 ORDER BY 1"
                ).fetchall()
                counts = {int(b): int(n) for b, n in bins}
                info["histogram"] = [
                    {"start": lo + i * width, "end": lo + (i + 1) * width, "count": counts.get(i, 0)} for i in range(HIST_BINS)
                ]
                info["kind"] = "date" if temporal else "number"
                info["min"], info["max"] = lo, hi
        if "histogram" not in info:
            top = conn.execute(
                f"SELECT CAST({col} AS VARCHAR) AS v, count(*) AS n FROM {view} WHERE {col} IS NOT NULL "
                f"GROUP BY 1 ORDER BY n DESC, v LIMIT {TOP_VALUES}"
            ).fetchall()
            info["top"] = [{"value": v, "count": int(n)} for v, n in top]
            info["kind"] = "text"
        out[name] = info
    return out


_EMAIL = r"^[^@\s]+@[^@\s]+\.[A-Za-z]{2,}$"
_PHONE = r"^\+?[\d\s\-().]{7,}$"


def _snake(name: str) -> str:
    s = re.sub(r"([a-z0-9])([A-Z])", r"\1_\2", name.strip())
    s = re.sub(r"[^0-9A-Za-z]+", "_", s).strip("_").lower()
    return s or name


def suggestions(conn, view: str) -> List[Dict[str, Any]]:
    """Findings with a ready step each. message_key is an i18n key; params fill it in."""
    found: List[Dict[str, Any]] = []
    total = conn.execute(f"SELECT count(*) FROM {view}").fetchone()[0] or 0
    described = [(r[0], str(r[1]).upper()) for r in conn.execute(f"DESCRIBE {view}").fetchall()]

    types = detect_types(conn, view)
    for column, spec in types.items():
        kind = spec["type"]
        failing = failing_examples(conn, view, column, {k: v for k, v in spec.items() if k not in ("coverage", "ambiguous")})
        found.append({
            "code": f"{'date' if kind in ('date', 'datetime') else kind}_as_text",
            "severity": "warning",
            "column": column,
            "message_key": "prepare.finding.type_as_text",
            "params": {"column": column, "type": kind, "coverage": round(spec.get("coverage", 1) * 100),
                       "formats": ", ".join(spec.get("formats", [])), "ambiguous": bool(spec.get("ambiguous")),
                       "failing": failing},
            "suggested_step": {"set_types": {"columns": {column: {k: v for k, v in spec.items() if k not in ("coverage", "ambiguous")}}}},
        })

    for column, ctype in described:
        if "VARCHAR" not in ctype or column in types:
            continue
        col = quote_ident(column)
        stats = conn.execute(
            f"SELECT count(*) FILTER (WHERE {col} <> trim({col}) OR {col} LIKE '%  %'), "
            f"count(*) FILTER (WHERE upper(trim({col})) IN ('NA','N/A','NULL','NONE','-','NAN','#N/A')), "
            f"count(DISTINCT {col}), count(DISTINCT lower(trim({col}))), "
            f"count(*) FILTER (WHERE regexp_matches({col}, '{_EMAIL}')), "
            f"count(*) FILTER (WHERE regexp_matches({col}, '{_PHONE}') AND length(regexp_replace({col}, '[^0-9]', '', 'g')) >= 8), "
            f"count(*) FILTER (WHERE {col} LIKE '{{%}}' OR {col} LIKE '[%]'), count({col}) FROM {view}"
        ).fetchone()
        spaces, markers, distinct, distinct_folded, emails, phones, jsons, filled = [int(x or 0) for x in stats]
        if markers:
            found.append({"code": "null_tokens", "severity": "warning", "column": column,
                          "message_key": "prepare.finding.null_tokens", "params": {"column": column, "count": markers},
                          "suggested_step": {"clean": {"columns": [column], "nulls": ["NA", "N/A", "n/a", "NULL", "null", "None", "-", "NaN", "#N/A"], "trim": True}}})
        elif spaces:
            found.append({"code": "whitespace", "severity": "info", "column": column,
                          "message_key": "prepare.finding.whitespace", "params": {"column": column, "count": spaces},
                          "suggested_step": {"replace": {"columns": [column], "find": "\\s+", "replace_with": " ", "match": "regex"}}})
        if distinct_folded < distinct and distinct <= 200:
            variants = conn.execute(
                f"SELECT lower(trim({col})) AS k, list(DISTINCT {col}), arg_max({col}, n) FROM ("
                f"SELECT {col}, count(*) OVER (PARTITION BY {col}) AS n FROM {view} WHERE {col} IS NOT NULL) "
                f"GROUP BY 1 HAVING count(DISTINCT {col}) > 1 LIMIT 50"
            ).fetchall()
            mapping = {raw: canon for _, raws, canon in variants for raw in raws if raw != canon}
            if mapping:
                found.append({"code": "inconsistent_values", "severity": "warning", "column": column,
                              "message_key": "prepare.finding.inconsistent_values",
                              "params": {"column": column, "count": len(mapping), "example": next(iter(mapping.items()))},
                              "suggested_step": {"cluster": {"column": column, "mapping": mapping}}})
        if filled and emails / filled >= 0.8:
            found.append({"code": "personal_email", "severity": "info", "column": column,
                          "message_key": "prepare.finding.personal_data", "params": {"column": column, "kind": "email"},
                          "suggested_step": {"mask": {"columns": [column], "method": "hash"}}})
        elif filled and phones / filled >= 0.8:
            found.append({"code": "personal_phone", "severity": "info", "column": column,
                          "message_key": "prepare.finding.personal_data", "params": {"column": column, "kind": "phone"},
                          "suggested_step": {"mask": {"columns": [column], "method": "last4"}}})
        if filled and jsons / filled >= 0.8:
            sample = conn.execute(f"SELECT {col} FROM {view} WHERE {col} LIKE '{{%}}' LIMIT 20").fetchall()
            keys: List[str] = []
            for (raw,) in sample:
                try:
                    obj = json.loads(raw)
                except (TypeError, ValueError):
                    continue
                if isinstance(obj, dict):
                    keys.extend(k for k in obj if re.fullmatch(r"[A-Za-z_][A-Za-z0-9_]*", k) and k not in keys)
            if keys:
                found.append({"code": "json_text", "severity": "info", "column": column,
                              "message_key": "prepare.finding.json_text", "params": {"column": column, "fields": ", ".join(keys[:6])},
                              "suggested_step": {"flatten_json": {"column": column, "fields": {k: f"$.{k}" for k in keys[:20]}}}})

    dupes = conn.execute(f"SELECT count(*) - (SELECT count(*) FROM (SELECT DISTINCT * FROM {view})) FROM {view}").fetchone()[0]
    if dupes:
        found.append({"code": "duplicate_rows", "severity": "warning", "column": None,
                      "message_key": "prepare.finding.duplicate_rows", "params": {"count": int(dupes)},
                      "suggested_step": {"dedupe": {}}})

    renames = {c: _snake(c) for c, _ in described if _snake(c) != c}
    targets = [_snake(c) for c, _ in described]
    if renames and len(set(targets)) == len(targets):
        found.append({"code": "column_names", "severity": "info", "column": None,
                      "message_key": "prepare.finding.column_names", "params": {"count": len(renames)},
                      "suggested_step": {"rename": {"columns": renames, "note": "Column names in snake_case"}}})

    order = {"error": 0, "warning": 1, "info": 2}
    found.sort(key=lambda f: (order.get(f["severity"], 3), f.get("column") or ""))
    return found


_NUMERIC_TYPES = ("TINYINT", "SMALLINT", "INTEGER", "BIGINT", "HUGEINT", "FLOAT", "REAL", "DOUBLE", "DECIMAL")
# Values beyond this many interquartile ranges from the middle half are extreme enough to question
OUTLIER_IQR = 3
OUTLIER_MIN_VALUES = 8
MOSTLY_EMPTY = 0.5


def _round(value: Any) -> Any:
    return round(value, 2) if isinstance(value, float) else value


def review_items(conn, view: str) -> List[Dict[str, Any]]:
    """Findings no step can fix on its own: someone who knows the data decides what they mean
    (keep, exclude, or note). Same shape as suggestions, without a suggested_step."""
    found: List[Dict[str, Any]] = []
    total = conn.execute(f"SELECT count(*) FROM {view}").fetchone()[0] or 0
    if not total:
        return found
    for column, ctype in [(r[0], str(r[1]).upper()) for r in conn.execute(f"DESCRIBE {view}").fetchall()]:
        col = quote_ident(column)
        filled, distinct = conn.execute(f"SELECT count({col}), count(DISTINCT {col}) FROM {view}").fetchone()
        empty_ratio = 1 - filled / total
        if empty_ratio >= MOSTLY_EMPTY:
            found.append({"code": "mostly_empty", "severity": "warning", "column": column,
                          "message_key": "prepare.finding.mostly_empty",
                          "params": {"column": column, "percent": round(empty_ratio * 100)}})
            continue
        if total > 1 and distinct == 1 and filled == total:
            value = conn.execute(f"SELECT CAST(any_value({col}) AS VARCHAR) FROM {view}").fetchone()[0]
            found.append({"code": "constant_column", "severity": "info", "column": column,
                          "message_key": "prepare.finding.constant_column", "params": {"column": column, "value": value}})
            continue
        if ctype.startswith(_NUMERIC_TYPES) and filled >= OUTLIER_MIN_VALUES:
            q1, q3 = conn.execute(
                f"SELECT quantile_cont({col}, 0.25), quantile_cont({col}, 0.75) FROM {view}"
            ).fetchone()
            q1, q3 = float(q1 or 0), float(q3 or 0)  # DECIMAL columns give Decimal, not SQL-safe
            spread = q3 - q1
            if spread > 0:
                low, high = q1 - OUTLIER_IQR * spread, q3 + OUTLIER_IQR * spread
                count = conn.execute(
                    f"SELECT count(*) FROM {view} WHERE {col} < {low!r} OR {col} > {high!r}"
                ).fetchone()[0]
                if count:
                    examples = [str(_round(v)) for (v,) in conn.execute(
                        f"SELECT {col} FROM {view} WHERE {col} < {low!r} OR {col} > {high!r} "
                        f"ORDER BY abs({col} - {(q1 + q3) / 2!r}) DESC LIMIT 3"
                    ).fetchall()]
                    found.append({"code": "outliers", "severity": "warning", "column": column,
                                  "message_key": "prepare.finding.outliers",
                                  "params": {"column": column, "count": int(count), "low": _round(low),
                                             "high": _round(high), "examples": examples}})
        elif ctype.startswith(("DATE", "TIMESTAMP")):
            future = conn.execute(f"SELECT count(*) FROM {view} WHERE {col} > current_date + 1").fetchone()[0]
            if future:
                found.append({"code": "future_dates", "severity": "warning", "column": column,
                              "message_key": "prepare.finding.future_dates",
                              "params": {"column": column, "count": int(future)}})
    return found
