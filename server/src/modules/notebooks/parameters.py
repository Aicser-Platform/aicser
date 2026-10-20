"""Substitute {{parameter}} placeholders in cell source (industry-standard notebook params)."""
from __future__ import annotations

import re
from typing import Any, Dict, List

from src.modules.notebooks.schemas import Cell
from src.modules.notebooks.settings_schema import NotebookParameterDef, NotebookSettings, parse_settings

_PLACEHOLDER = re.compile(r"\{\{\s*([A-Za-z_][A-Za-z0-9_]{0,39})\s*\}\}")


def _format_value(value: Any, param_type: str) -> str:
    if value is None:
        return ""
    if param_type == "boolean":
        return "true" if value in (True, "true", "1", 1) else "false"
    if param_type == "number":
        return str(value)
    if param_type == "date":
        return str(value)[:10]
    text = str(value)
    return text.replace("'", "''") if param_type == "string" else text


def resolve_parameters(
    settings: NotebookSettings,
    overrides: Dict[str, Any] | None = None,
) -> Dict[str, Any]:
    out: Dict[str, Any] = {}
    overrides = overrides or {}
    for p in settings.parameters:
        if p.name in overrides:
            out[p.name] = overrides[p.name]
        elif p.default is not None:
            out[p.name] = p.default
        elif p.required:
            raise ValueError(f"Missing required parameter: {p.name}")
    for key, val in overrides.items():
        if key not in out:
            out[key] = val
    return out


def apply_parameters_to_cells(cells: List[Cell], values: Dict[str, Any], defs: List[NotebookParameterDef]) -> List[Cell]:
    type_map = {d.name: d.type for d in defs}

    def sub(text: str) -> str:
        def repl(m: re.Match[str]) -> str:
            name = m.group(1)
            if name not in values:
                return m.group(0)
            return _format_value(values[name], type_map.get(name, "string"))

        return _PLACEHOLDER.sub(repl, text)

    out: List[Cell] = []
    for c in cells:
        if c.type in ("sql", "python", "markdown"):
            out.append(c.model_copy(update={"source": sub(c.source)}))
        else:
            out.append(c)
    return out


def apply_parameters_raw(cells: List[dict], settings_raw: dict | None, overrides: Dict[str, Any] | None) -> List[dict]:
    settings = parse_settings(settings_raw)
    values = resolve_parameters(settings, overrides)
    typed = [Cell(**{k: v for k, v in c.items() if k != "output"}) for c in cells]
    applied = apply_parameters_to_cells(typed, values, settings.parameters)
    return [c.model_dump(exclude_none=True) for c in applied]
