"""Tests for Workbook to DataSource synchronization and idempotency."""

import uuid
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch

import pytest
from src.modules.workbooks import router as WB

ME, ORG, PROJ = str(uuid.uuid4()), str(uuid.uuid4()), str(uuid.uuid4())


@pytest.fixture
def caller(monkeypatch):
    who = SimpleNamespace(user_id=ME, organization_id=ORG, project_id=PROJ)

    async def allow(*a, **k):
        return None

    monkeypatch.setattr(WB, "caller_from_token", lambda token, project_id=None: who)
    monkeypatch.setattr(WB, "require_permission", allow)
    return who


@pytest.mark.asyncio
async def test_sync_workbook_datasource_idempotent_reuses_existing_id(caller):
    wb_id = uuid.uuid4()
    mock_wb = SimpleNamespace(
        id=wb_id,
        user_id=uuid.UUID(ME),
        project_id=uuid.UUID(PROJ),
        title="Revenue Model",
        doc=b"test-doc",
    )

    from datetime import datetime, timezone

    existing_ds_id = str(uuid.uuid4())
    now = datetime.now(timezone.utc)
    mock_existing_ds = SimpleNamespace(
        id=existing_ds_id,
        is_active=True,
        updated_at=now,
        created_at=now,
        connection_config={"workbook_id": str(wb_id), "source_type": "workbook"},
    )

    class MockAsyncSession:
        def __init__(self):
            self.committed = False

        async def execute(self, stmt):
            return SimpleNamespace(
                scalars=lambda: SimpleNamespace(
                    first=lambda: mock_existing_ds,
                    all=lambda: [mock_existing_ds],
                ),
            )

        async def get(self, model, pk):
            if str(pk) == existing_ds_id:
                return mock_existing_ds
            return None

        async def commit(self):
            self.committed = True

    mock_db = MockAsyncSession()

    with patch.object(WB, "_load", AsyncMock(return_value=mock_wb)):
        with patch("asyncio.to_thread", AsyncMock(return_value=b"fake-xlsx-bytes")):
            with patch("src.modules.data.services.data_connectivity_service.DataConnectivityService") as MockConnService:
                mock_service_instance = MockConnService.return_value
                mock_service_instance.upload_file = AsyncMock(return_value={
                    "success": True,
                    "data_source_id": existing_ds_id,
                })

                res = await WB.sync_workbook_datasource(
                    workbook_id=str(wb_id),
                    current_token={"id": ME},
                    db=mock_db,
                )

                assert res["success"] is True
                assert res["data_source_id"] == existing_ds_id

                # Verify upload_file was called with the existing source_id
                mock_service_instance.upload_file.assert_awaited_once()
                call_args, call_kwargs = mock_service_instance.upload_file.call_args
                options = call_kwargs.get("options") or call_args[2]
                assert options.get("source_id") == existing_ds_id
                assert options.get("name") == "Revenue Model (Sheet)"
                assert options.get("connection_config", {}).get("workbook_id") == str(wb_id)
