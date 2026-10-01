"""Convert between Aicser notebooks and Jupyter's .ipynb format (nbformat 4).

SQL cells become code cells starting with the ``%%sql`` magic (the convention of JupySQL and
ipython-sql), with the data source kept in the cell's metadata, so a notebook round-trips
through Jupyter without losing which data each query reads. Outputs are not exported: they
are snapshots of data the reader may not be allowed to see.
"""

from __future__ import annotations

import uuid
from typing import Any, Dict, List

from src.modules.notebooks.schemas import MAX_CELLS, MAX_SOURCE


def _text(source: Any) -> str:
    if isinstance(source, list):
        return "".join(str(s) for s in source)
    return str(source or "")


def to_ipynb(title: str, cells: List[Dict[str, Any]]) -> Dict[str, Any]:
    out = []
    for c in cells:
        kind = c.get("type")
        src = c.get("source") or ""
        meta: Dict[str, Any] = {"aicser": {"id": c.get("id"), "type": kind}}
        if c.get("name"):
            meta["aicser"]["name"] = c["name"]
        if kind == "markdown":
            out.append({"cell_type": "markdown", "metadata": meta, "source": src})
            continue
        if kind == "sql":
            meta["aicser"]["data_source_id"] = c.get("data_source_id")
            head = f"%%sql {c['name']} <<\n" if c.get("name") else "%%sql\n"
            src = head + src
        elif kind in ("chart", "pivot"):
            meta["aicser"]["chart"] = c.get("chart") or {}
            what = "Pivot table" if kind == "pivot" else "Chart"
            src = f"# {what} of {(c.get('chart') or {}).get('from') or 'a result'} (made in Aicser)"
        out.append({"cell_type": "code", "metadata": meta, "source": src, "outputs": [], "execution_count": None})
    return {
        "nbformat": 4,
        "nbformat_minor": 5,
        "metadata": {
            "title": title,
            "kernelspec": {"name": "python3", "display_name": "Python 3", "language": "python"},
            "language_info": {"name": "python"},
        },
        "cells": out,
    }


def from_ipynb(nb: Dict[str, Any]) -> List[Dict[str, Any]]:
    """Cells of an .ipynb document, as Aicser cells (outputs dropped)."""
    if not isinstance(nb, dict) or not isinstance(nb.get("cells"), list):
        raise ValueError("This isn't a Jupyter notebook (.ipynb) file.")
    cells: List[Dict[str, Any]] = []
    for raw in nb["cells"][:MAX_CELLS]:
        if not isinstance(raw, dict):
            continue
        src = _text(raw.get("source"))[:MAX_SOURCE]
        meta = (raw.get("metadata") or {}).get("aicser") or {}
        cell: Dict[str, Any] = {"id": uuid.uuid4().hex[:12]}
        if raw.get("cell_type") == "markdown":
            cell.update(type="markdown", source=src)
        elif raw.get("cell_type") == "code":
            first, _, rest = src.partition("\n")
            if first.strip().startswith("%%sql"):
                parts = first.split()
                name = parts[1] if len(parts) >= 3 and parts[2] == "<<" else meta.get("name")
                cell.update(type="sql", source=rest, name=name, data_source_id=meta.get("data_source_id"))
            elif meta.get("type") in ("chart", "pivot"):
                cell.update(type=meta["type"], source="", chart=meta.get("chart") or {})
            else:
                cell.update(type="python", source=src, name=meta.get("name"))
        else:
            continue  # raw cells carry nothing we can run or show
        cells.append(cell)
    return cells
