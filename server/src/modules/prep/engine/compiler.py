"""Recipe steps (or a pipeline transform YAML) to one CTE-chained SQL statement."""

from __future__ import annotations

from typing import Any, Dict, List, Literal, Optional

import yaml
from pydantic import BaseModel, model_validator

from src.modules.prep.engine.steps import (CompileContext, Step,
                                           ValidateStep, parse_step)


class OutputSpec(BaseModel):
    layer: Literal["silver", "gold"]
    table: str
    write_mode: Literal["append", "merge", "overwrite"] = "append"
    primary_key: List[str] = []

    @model_validator(mode="after")
    def _merge_needs_a_key(self):
        if self.write_mode == "merge" and not self.primary_key:
            raise ValueError("output.write_mode 'merge' requires output.primary_key")
        return self


class TransformDoc(BaseModel):
    version: int = 1
    source: Dict[str, Any] = {}
    transform: List[Dict[str, Any]] = []
    output: OutputSpec
    semantic: Dict[str, Any] = {}


class CompiledSteps(BaseModel):
    sql: str
    cte_names: List[str]
    quarantine_sql: Optional[str] = None


class CompiledTransform(CompiledSteps):
    output: OutputSpec


def parse_yaml(text: str) -> TransformDoc:
    raw = yaml.safe_load(text) or {}
    if not isinstance(raw, dict):
        raise ValueError("transform YAML must be a mapping at the top level")
    return TransformDoc(**raw)


def _disabled(raw: Dict[str, Any]) -> bool:
    if not isinstance(raw, dict) or len(raw) != 1:
        return False
    payload = next(iter(raw.values()))
    return isinstance(payload, dict) and bool(payload.get("disabled"))


def compile_steps(
    steps: List[Dict[str, Any]],
    *,
    source_sql: str,
    up_to_step: Optional[int] = None,
    limit: Optional[int] = None,
) -> CompiledSteps:
    """Compile a step list over ``source_sql``. Errors name the failing step."""
    steps_raw = steps if up_to_step is None else steps[:up_to_step]
    # A switched-off step stays in the list (and keeps its number) but does nothing.
    steps_raw = [{"sql": {"query": "SELECT * FROM {input}"}} if _disabled(raw) else raw for raw in steps_raw]

    ctes: List[str] = [f"s0 AS ({source_sql})"]
    cte_names: List[str] = ["s0"]
    quarantine_sql: Optional[str] = None

    for i, raw in enumerate(steps_raw):
        try:
            step: Step = parse_step(raw)
        except ValueError as exc:
            raise ValueError(f"step {i}: {exc}") from exc

        source = cte_names[-1]
        ctx = CompileContext(index=i + 1)

        if isinstance(step, ValidateStep) and step.on_fail == "quarantine":
            quarantine_sql = (
                f"WITH {', '.join(ctes)} "
                f"SELECT * FROM ({step.quarantine_cte(source, ctx)})"
            )

        try:
            body = step.to_cte(source, ctx)
        except ValueError as exc:
            raise ValueError(f"step {i}: {exc}") from exc

        name = f"s{i + 1}"
        ctes.append(f"{name} AS ({body})")
        cte_names.append(name)

    tail = f"SELECT * FROM {cte_names[-1]}"
    if limit is not None:
        tail += f" LIMIT {int(limit)}"

    return CompiledSteps(
        sql=f"WITH {', '.join(ctes)} {tail}",
        cte_names=cte_names,
        quarantine_sql=quarantine_sql,
    )


def compile_transform(
    doc: TransformDoc,
    *,
    source_sql: str,
    up_to_step: Optional[int] = None,
    limit: Optional[int] = None,
) -> CompiledTransform:
    """Compile a pipeline transform document into one statement."""
    compiled = compile_steps(
        doc.transform, source_sql=source_sql, up_to_step=up_to_step, limit=limit
    )
    return CompiledTransform(**compiled.model_dump(), output=doc.output)
