"""CE / no-S3 uploads must behave exactly as before the pipeline landed."""


async def test_ce_upload_never_stages_the_file_in_the_lakehouse(tmp_path, monkeypatch):
    from unittest.mock import AsyncMock, MagicMock

    monkeypatch.setenv("AISER_EDITION", "community")

    path = tmp_path / "orders.csv"
    path.write_text("id,amount\n1,10\n2,20\n")

    from src.modules.data.services import data_connectivity_service as module
    from src.modules.data.services.data_connectivity_service import DataConnectivityService

    monkeypatch.setattr(module, "is_ee_enabled", lambda: False)

    session = AsyncMock()
    session.execute = AsyncMock(return_value=MagicMock(scalar_one_or_none=MagicMock(return_value=None)))
    session.add = MagicMock()

    class SessionCM:
        async def __aenter__(self):
            return session

        async def __aexit__(self, exc_type, exc, tb):
            return False

    monkeypatch.setattr("src.db.session.async_session", MagicMock(return_value=SessionCM()))

    service = DataConnectivityService()
    result = await service.process_uploaded_file(str(path), "orders.csv", options={})

    assert result.get("success") is not False
    added = [type(call.args[0]).__name__ for call in session.add.call_args_list if call.args]
    assert "DataLakeObject" not in added, "CE uploads must not copy the file into the lakehouse"
