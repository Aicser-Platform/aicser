"""Notebooks round-trip through Jupyter's format, keeping which data each query reads."""

import pytest

from src.modules.notebooks import ipynb
from src.modules.notebooks.schemas import Cell, CellOutput


def test_round_trip_keeps_sql_names_and_sources():
    cells = [
        {"id": "a", "type": "markdown", "source": "# Sales"},
        {"id": "b", "type": "sql", "source": "select * from data", "name": "sales", "data_source_id": "ds1"},
        {"id": "c", "type": "python", "source": "sales.describe()"},
        {"id": "d", "type": "chart", "source": "", "chart": {"from": "sales", "type": "bar", "x": "month", "y": ["total"]}},
    ]
    doc = ipynb.to_ipynb("My notebook", cells)
    assert doc["nbformat"] == 4 and doc["cells"][1]["source"].startswith("%%sql sales <<\n")
    back = ipynb.from_ipynb(doc)
    assert [c["type"] for c in back] == ["markdown", "sql", "python", "chart"]
    assert back[1]["name"] == "sales" and back[1]["data_source_id"] == "ds1" and back[1]["source"] == "select * from data"
    assert back[3]["chart"]["y"] == ["total"]


def test_plain_jupyter_notebooks_import_as_python_and_text():
    doc = {"cells": [
        {"cell_type": "markdown", "source": ["# Title\n", "text"]},
        {"cell_type": "code", "source": "import pandas as pd\npd.DataFrame()", "outputs": [{"x": 1}]},
        {"cell_type": "raw", "source": "ignored"},
    ]}
    cells = ipynb.from_ipynb(doc)
    assert [c["type"] for c in cells] == ["markdown", "python"]
    assert cells[0]["source"] == "# Title\ntext" and "output" not in cells[1]


def test_not_a_notebook_is_refused():
    with pytest.raises(ValueError):
        ipynb.from_ipynb({"hello": 1})


def test_outputs_are_kept_small_and_safe():
    out = CellOutput(kind="table", rows=[[i] for i in range(1000)], text="x" * 50_000, image="data:image/svg+xml;base64,AAA")
    assert len(out.rows) == 200 and len(out.text) == 20_000 and out.image is None
    with pytest.raises(ValueError):
        Cell(id="a", type="sql", name="1bad")


def test_pivot_and_chart_cells_round_trip_their_settings():
    pivot = {"from": "q1", "rows": ["region"], "columns": ["year"], "values": [{"field": "sales", "agg": "sum"}]}
    cells = [
        {"id": "p", "type": "pivot", "source": "", "chart": pivot},
        {"id": "c", "type": "chart", "source": "", "chart": {"from": "q1", "type": "bar", "agg": "sum"}},
    ]
    back = ipynb.from_ipynb(ipynb.to_ipynb("T", cells))
    assert [c["type"] for c in back] == ["pivot", "chart"]
    assert back[0]["chart"] == pivot
    assert Cell(**back[0]).type == "pivot"
