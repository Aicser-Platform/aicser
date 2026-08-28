"""CE / no-S3 uploads must behave exactly as before the pipeline landed."""


async def test_ce_upload_never_calls_the_bronze_bridge(tmp_path, monkeypatch):
    from unittest.mock import AsyncMock, MagicMock, patch

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

    with patch.object(module, "_try_write_bronze", new=AsyncMock(return_value=None)) as bridge:
        service = DataConnectivityService()
        result = await service.process_uploaded_file(str(path), "orders.csv", options={})

    assert result.get("success") is not False
    bridge.assert_not_awaited(), "CE uploads must not reach the Bronze bridge"
