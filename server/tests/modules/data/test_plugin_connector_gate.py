"""Unit and integration tests for URL Connector Contract and Query Gate (Issue 05)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock

import pytest

from src.modules.data.services import warehouse_urls
from src.modules.data.services.multi_engine_query_service import MultiEngineQueryService
from src.modules.plugins.models import PluginEnablement
from src.modules.plugins.registry import registry


@pytest.fixture(autouse=True)
def reset_and_discover():
    registry.reset()
    registry.discover(force=True)
    yield
    registry.reset()


def test_snowflake_plugin_is_registered_in_url_types():
    assert "snowflake" in warehouse_urls.get_url_types()
    url = warehouse_urls.build_url(
        "snowflake",
        {
            "account": "xy12345.us-east-1",
            "username": "analyst",
            "password": "s3cret",
            "database": "ANALYTICS",
            "schema": "PUBLIC",
            "warehouse": "COMPUTE_WH",
            "role": "SYSADMIN",
        },
    )
    assert url == (
        "snowflake://analyst:s3cret@xy12345.us-east-1/ANALYTICS/PUBLIC"
        "?warehouse=COMPUTE_WH&role=SYSADMIN"
    )
    assert warehouse_urls.ping_sql("snowflake") == "SELECT CURRENT_VERSION()"


@pytest.mark.asyncio
async def test_query_gate_blocks_disabled_plugin_without_deleting_source():
    svc = MultiEngineQueryService()

    # Mock DB session returning enabled=False for snowflake in org-a
    disabled_row = PluginEnablement(scope_key="org-a", plugin_id="snowflake", enabled=False)
    mock_db = AsyncMock()
    res = MagicMock()
    res.scalar_one_or_none.return_value = disabled_row
    mock_db.execute.return_value = res

    identity = MagicMock()
    identity.organization_id = "org-a"

    source_dict = {
        "id": "src-sf-1",
        "type": "snowflake",
        "db_type": "snowflake",
        "connection_info": {"account": "acct", "username": "u", "password": "p", "database": "DB"},
        "__db_session": mock_db,
    }

    out = await svc.execute_query("SELECT 1", source_dict, identity=identity)
    assert out["success"] is False
    assert out.get("plugin_disabled") is True
    assert "Snowflake" in out["error"]
    # Source dict remains intact
    assert source_dict["connection_info"]["account"] == "acct"


@pytest.mark.asyncio
async def test_query_gate_tenant_isolation_org_b_stays_active():
    svc = MultiEngineQueryService()

    # Org B has no disable row -> falls back to default_enabled=True
    mock_db_b = AsyncMock()
    res_b = MagicMock()
    res_b.scalar_one_or_none.return_value = None
    mock_db_b.execute.return_value = res_b

    identity_b = MagicMock()
    identity_b.organization_id = "org-b"

    source_dict = {
        "id": "src-sf-2",
        "type": "snowflake",
        "db_type": "snowflake",
        "__db_session": mock_db_b,
    }

    gate_err = await svc._check_plugin_connector_gate(source_dict, identity_b)
    assert gate_err is None


@pytest.mark.asyncio
async def test_test_connection_blocks_disabled_plugin():
    from src.modules.data.services.database_connector_service import DatabaseConnectorService

    connector_svc = DatabaseConnectorService()

    disabled_row = PluginEnablement(scope_key="instance", plugin_id="snowflake", enabled=False)
    mock_db = AsyncMock()
    res = MagicMock()
    res.scalar_one_or_none.return_value = disabled_row
    mock_db.execute.return_value = res

    config = {
        "type": "snowflake",
        "account": "xy12345.us-east-1",
        "username": "user",
        "password": "pwd",
        "database": "DB",
        "__db_session": mock_db,
    }

    out = await connector_svc.test_connection(config)
    assert out["success"] is False
    assert out.get("plugin_disabled") is True
    assert "Snowflake" in out["error"]


@pytest.mark.asyncio
async def test_get_schema_blocks_disabled_plugin():
    from src.modules.data.services.database_connector_service import DatabaseConnectorService

    connector_svc = DatabaseConnectorService()

    disabled_row = PluginEnablement(scope_key="instance", plugin_id="snowflake", enabled=False)
    mock_db = AsyncMock()
    res = MagicMock()
    res.scalar_one_or_none.return_value = disabled_row
    mock_db.execute.return_value = res

    config = {
        "type": "snowflake",
        "account": "xy12345.us-east-1",
        "username": "user",
        "password": "pwd",
        "database": "DB",
        "__db_session": mock_db,
    }

    out = await connector_svc.get_schema(config)
    assert out["success"] is False
    assert out.get("plugin_disabled") is True
    assert "Snowflake" in out["error"]


@pytest.mark.asyncio
async def test_assert_connector_active_raises_when_disabled():
    from src.modules.plugins.service import (
        PluginConnectorDisabledError,
        assert_connector_active,
    )

    disabled_row = PluginEnablement(scope_key="instance", plugin_id="snowflake", enabled=False)
    mock_db = AsyncMock()
    res = MagicMock()
    res.scalar_one_or_none.return_value = disabled_row
    mock_db.execute.return_value = res

    with pytest.raises(PluginConnectorDisabledError) as exc_info:
        await assert_connector_active("snowflake", db=mock_db)

    assert "Snowflake" in str(exc_info.value)
    assert exc_info.value.plugin_id == "snowflake"
    err_dict = exc_info.value.to_dict()
    assert err_dict["success"] is False
    assert err_dict["plugin_disabled"] is True


