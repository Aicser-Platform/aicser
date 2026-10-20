"""Run compiled recipes in DuckDB. Enterprise adds object-store access on top."""

from __future__ import annotations

import re
from typing import Any, Dict, List, Optional

import pyarrow as pa

from src.modules.prep.engine.compiler import compile_steps

_STEP_ERROR_RE = re.compile(r"^step (\d+): (.*)$", re.DOTALL)
_MISSING_COLUMN_RE = re.compile(r'(?:Referenced column|Column) "([^"]+)"[^\n]*not found', re.IGNORECASE)


def friendly_error(message: str) -> str:
    """Engine errors in words people can act on; the original stays for anything else."""
    missing = _MISSING_COLUMN_RE.search(message or "")
    if missing:
        return f'There is no column "{missing.group(1)}" at this point. Edit or remove this step.'
    return message


def _first_failing_step(steps, source_sql: str, conn, count: int, fallback: str) -> tuple[int, str]:
    """The earliest step whose output can't be planned, so the error sits on the step to fix."""
    for i in range(1, count + 1):
        try:
            conn.execute(f"DESCRIBE ({compile_steps(steps, source_sql=source_sql, up_to_step=i, limit=0).sql})")
        except Exception as exc:  # noqa: BLE001
            return i - 1, str(exc)
    return count - 1, fallback


def connect():
    import duckdb

    return duckdb.connect()


def as_table(result) -> pa.Table:
    table = result.arrow()
    if hasattr(table, "read_all"):
        return table.read_all()
    return table


def preview_steps(
    steps: List[Dict[str, Any]],
    *,
    source_sql: str,
    up_to_step: Optional[int] = None,
    limit: int = 200,
    connection: Optional[Any] = None,
) -> Dict[str, Any]:
    """Compile and run steps with a row cap. Problems come back as step errors, not exceptions."""
    try:
        compiled = compile_steps(
            steps,
            source_sql=source_sql,
            up_to_step=None if up_to_step is None else up_to_step + 1,
            limit=limit,
        )
    except Exception as exc:  # noqa: BLE001 - shown next to the step that failed
        match = _STEP_ERROR_RE.match(str(exc))
        return {
            "columns": [],
            "rows": [],
            "sql": None,
            "step_errors": [
                {
                    "step": int(match.group(1)) if match else 0,
                    "message": match.group(2) if match else str(exc),
                }
            ],
            "quarantined_count": 0,
        }

    conn = connection or connect()
    try:
        table = as_table(conn.execute(compiled.sql))
    except Exception as exc:  # noqa: BLE001
        failing, message = _first_failing_step(steps, source_sql, conn, len(compiled.cte_names) - 1, str(exc))
        return {
            "columns": [],
            "rows": [],
            "sql": compiled.sql,
            "step_errors": [{"step": failing, "message": friendly_error(message)}],
            "quarantined_count": 0,
        }

    quarantined = 0
    if compiled.quarantine_sql:
        try:
            quarantined = as_table(conn.execute(compiled.quarantine_sql)).num_rows
        except Exception:  # noqa: BLE001 - the count is informational
            quarantined = 0

    return {
        "columns": [{"name": f.name, "type": str(f.type)} for f in table.schema],
        "rows": table.to_pylist(),
        "sql": compiled.sql,
        "step_errors": [],
        "quarantined_count": quarantined,
    }
