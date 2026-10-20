"""Model and AI steps in a recipe (predict, ai_answer).

SQL can't call a model or the AI, so the runner stops at each such step: it runs the steps
before it, adds the new columns in Python, and registers the result as the table the step
reads (``_rt{n}``). Steps after it carry on in SQL. The work itself is Enterprise
(Models, AI Decisions); Community recipes simply don't offer these steps.
"""

from __future__ import annotations

import asyncio
from typing import Any, Dict, List, Optional

import pyarrow as pa

from src.core.edition import is_ee_enabled
from src.modules.prep.engine.steps import RUNTIME_KINDS, runtime_table


class RuntimeStepError(ValueError):
    def __init__(self, step: int, message: str):
        super().__init__(f"step {step}: {message}")
        self.step = step
        self.message = message


def _kind(raw: Any) -> tuple[Optional[str], Dict[str, Any]]:
    if isinstance(raw, dict) and len(raw) == 1:
        kind, payload = next(iter(raw.items()))
        return kind, payload if isinstance(payload, dict) else {}
    return None, {}


def has_runtime_steps(steps: List[Dict[str, Any]]) -> bool:
    return any(_kind(raw)[0] in RUNTIME_KINDS and not _kind(raw)[1].get("disabled") for raw in steps)


def _enricher(kind: str):
    if not is_ee_enabled():
        raise ValueError("Prediction and AI answer steps are part of the Enterprise edition.")
    if kind == "predict":
        from src.modules.mlops.prep_step import add_prediction

        return add_prediction
    from src.modules.ai.decisions.prep_step import add_ai_answer

    return add_ai_answer


async def materialize(caller, steps: List[Dict[str, Any]], *, source_sql: str, conn,
                      dry: bool = False, upto: Optional[int] = None) -> Dict[str, pa.Table]:
    """Fill the table each model/AI step reads, in order, on ``conn``. ``dry`` adds the new
    columns empty (to check a draft's shape without calling a model or the AI). ``upto`` stops
    after that many steps, for previews of an earlier step."""
    from src.modules.prep.engine.compiler import compile_steps
    from src.modules.prep.engine.executor import as_table

    filled: Dict[str, pa.Table] = {}
    last = len(steps) if upto is None else min(len(steps), upto)
    for i in range(last):
        kind, payload = _kind(steps[i])
        if kind not in RUNTIME_KINDS or payload.get("disabled"):
            continue
        try:
            sql = compile_steps(steps[:i], source_sql=source_sql).sql
            rows: pa.Table = await asyncio.to_thread(lambda: as_table(conn.execute(sql)))
            out = await _enricher(kind)(caller, payload, rows, dry=dry)
        except RuntimeStepError:
            raise
        except Exception as exc:  # noqa: BLE001 - shown on the step
            raise RuntimeStepError(i, getattr(exc, "detail", None) or str(exc)) from exc
        name = runtime_table(i + 1)
        conn.register(name, out)
        filled[name] = out
    return filled


def unique_column(existing: List[str], wanted: str) -> str:
    """``wanted``, or ``wanted_2``… when the rows already have that column."""
    taken = {c.lower() for c in existing}
    if wanted.lower() not in taken:
        return wanted
    n = 2
    while f"{wanted}_{n}".lower() in taken:
        n += 1
    return f"{wanted}_{n}"


def append_columns(table: pa.Table, columns: Dict[str, List[Any]]) -> pa.Table:
    """``table`` plus new columns (names made unique against the existing ones)."""
    for name, values in columns.items():
        col = unique_column(table.column_names, name)
        try:
            arr = pa.array(values)
        except (pa.ArrowInvalid, pa.ArrowTypeError):
            arr = pa.array([None if v is None else str(v) for v in values], type=pa.string())
        if pa.types.is_null(arr.type):
            arr = arr.cast(pa.string())
        table = table.append_column(col, arr)
    return table

