"""Workbook ↔ data source linking helpers."""

import uuid
from datetime import datetime, timezone
from types import SimpleNamespace

import pytest

from src.modules.workbooks.datasource_link import (
    _normalize_file_source_name,
    resolve_workbook_data_source_id,
    workbook_upload_options,
)


def test_normalize_file_source_name():
    assert _normalize_file_source_name("Untitled (Sheet)") == "untitled"
    assert _normalize_file_source_name("  Sales (Sheet)  ") == "sales"


def test_workbook_upload_options_sets_name_and_config():
    wb_id = str(uuid.uuid4())
    opts = workbook_upload_options(
        wb_id,
        "Untitled sheet",
        project_id="p1",
        organization_id="o1",
        user_id="u1",
        existing_source_id="ds-old",
    )
    assert opts["name"] == "Untitled sheet (Sheet)"
    assert opts["source_id"] == "ds-old"
    assert opts["connection_config"]["workbook_id"] == wb_id


@pytest.mark.asyncio
async def test_resolve_workbook_data_source_id_dedupes():
    wb_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    newer = SimpleNamespace(
        id=uuid.uuid4(),
        is_active=True,
        updated_at=now,
        created_at=now,
    )
    older = SimpleNamespace(
        id=uuid.uuid4(),
        is_active=True,
        updated_at=now.replace(year=2020),
        created_at=now.replace(year=2020),
    )

    class MockSession:
        committed = False

        async def execute(self, _stmt):
            return SimpleNamespace(scalars=lambda: SimpleNamespace(all=lambda: [newer, older]))

        async def commit(self):
            self.committed = True

    db = MockSession()
    ds_id, n = await resolve_workbook_data_source_id(db, wb_id)
    assert ds_id == str(newer.id)
    assert n == 1
    assert older.is_active is False
    assert db.committed
