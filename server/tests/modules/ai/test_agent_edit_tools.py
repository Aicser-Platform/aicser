"""Changing existing work: precise edits, before → after for approval, and an Undo for each change."""

import pytest

from ee.modules.ai import agent_edit_tools as E
from src.core.tool_registry import ToolCaller, ToolError, get_tool_registry, get_undo


def test_cell_references_and_column_names():
    assert E._cell_ref("B2") == (2, 2)
    assert E._cell_ref("$AA$10") == (10, 27)
    assert E._col_name(1) == "A" and E._col_name(28) == "AB"
    with pytest.raises(ToolError, match="isn't a cell reference"):
        E._cell_ref("2B")


def test_sheet_edits_keep_formulas_and_write_tables_with_headers():
    edits = E._edits({"cells": [{"cell": "B9", "value": "=SUM(B2:B8)"}, {"cell": "A1", "value": "Region"},
                                {"cell": "C1", "value": 120}]})
    assert (9, 2, "=SUM(B2:B8)") in edits  # a formula stays a formula
    assert (1, 1, "'Region") in edits and (1, 3, "120") in edits
    table = E._edits({"data": {"rows": [{"branch": 2, "npl": 1}, {"branch": 5, "npl": 9}]}, "at": "D4"})
    assert table[:2] == [(4, 4, "'branch"), (4, 5, "'npl")]
    assert (6, 5, "9") in table
    with pytest.raises(ToolError):
        E._edits({})


def test_notebook_changes_update_add_and_delete_cells():
    cells = [{"id": "a", "type": "sql", "source": "SELECT 1"}, {"id": "b", "type": "markdown", "source": "# Notes"}]
    out = E._apply_cell_ops(cells, [
        {"op": "update", "cell_id": "a", "source": "SELECT 2"},
        {"op": "add", "cell_id": "c", "type": "python", "source": "df.head()", "after_cell_id": "a"},
        {"op": "delete", "cell_id": "b"},
    ])
    assert [(c["id"], c["source"]) for c in out] == [("a", "SELECT 2"), ("c", "df.head()")]
    assert cells[0]["source"] == "SELECT 1"  # the original is untouched until saved
    with pytest.raises(ToolError, match="No cell"):
        E._apply_cell_ops(cells, [{"op": "update", "cell_id": "zz", "source": "x"}])
    with pytest.raises(ToolError):
        E._apply_cell_ops(cells, [{"op": "add", "type": "excel", "source": "x"}])


def test_changes_list_only_what_differs():
    assert E._changes({"title": "Old", "severity": "high"}, {"title": "New", "severity": "high"}) == [
        {"field": "title", "before": "Old", "after": "New"}]


def test_every_change_tool_shows_a_preview_and_has_an_undo():
    specs = {s.name: s for s in get_tool_registry().list(surface="agent") if s.source == "ai.agent_edit_tools"}
    for name in ("update_chart", "update_dashboard", "update_alert", "update_recipe", "write_sheet", "edit_notebook"):
        assert specs[name].preview is not None, name
        assert "mcp" not in specs[name].surfaces
    for handler in ("restore_chart", "restore_dashboard", "restore_alert", "restore_recipe", "restore_sheet",
                    "restore_notebook"):
        assert get_undo(handler) is not None, handler


@pytest.mark.asyncio
async def test_objects_outside_the_persons_scope_are_not_found(monkeypatch):
    other = ToolCaller(user_id="00000000-0000-0000-0000-000000000001", organization_id=None, project_id=None)
    assert not E._mine_or_project(other, "someone-else", "project-x")
    mine = ToolCaller(user_id="u1", organization_id=None, project_id="p1")
    assert E._mine_or_project(mine, "u1", None) and E._mine_or_project(mine, "u2", "p1")
