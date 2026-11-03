"""Unit tests for Plug-in Enabled gate and service layer (Issue 03)."""

from __future__ import annotations

from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from cryptography.fernet import Fernet

from src.modules.plugins import service
from src.modules.plugins.models import PluginEnablement
from src.modules.plugins.registry import registry


@pytest.fixture(autouse=True)
def reset_plugin_registry(monkeypatch):
    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())
    registry.reset()
    registry._discovered = True
    registry.register_manifest_dict(
        {
            "id": "sankey",
            "name": "Sankey Diagram",
            "version": "1.0.0",
            "api_version": "1",
            "default_enabled": True,
            "requires_feature": None,
            "contributions": [
                {
                    "kind": "visual",
                    "chart_type": "sankey",
                    "label": "Sankey Diagram",
                    "bundle": "index.js",
                }
            ],
        }
    )
    registry.register_manifest_dict(
        {
            "id": "enterprise_conn",
            "name": "Enterprise Warehouse",
            "version": "1.0.0",
            "api_version": "1",
            "default_enabled": True,
            "requires_feature": "enterprise_connectors",
            "contributions": [
                {
                    "kind": "connector",
                    "db_type": "ent_wh",
                    "label": "Enterprise Warehouse",
                    "target": "ent_pkg:Conn",
                }
            ],
        }
    )
    yield
    registry.reset()


def _mock_db_with_rows(rows):
    db = AsyncMock()
    res = MagicMock()
    res.scalars.return_value.all.return_value = rows
    res.scalar_one_or_none.return_value = rows[0] if rows else None
    db.execute.return_value = res
    return db


@pytest.mark.asyncio
async def test_gate_matrix_installed_entitled_default_enabled():
    db = _mock_db_with_rows([])
    with patch("src.modules.plugins.service.org_has_plan_feature", new=AsyncMock(return_value=True)):
        active = await service.is_plugin_active(db, scope_key="instance", plugin_id="sankey")
        assert active is True


@pytest.mark.asyncio
async def test_gate_matrix_disabled_by_admin_row():
    row = PluginEnablement(scope_key="org-1", plugin_id="sankey", enabled=False)
    db = _mock_db_with_rows([row])
    active = await service.is_plugin_active(db, scope_key="org-1", plugin_id="sankey")
    assert active is False

    contribs = await service.get_active_contributions(db, scope_key="org-1")
    assert "sankey" not in contribs.active_plugins
    assert contribs.disabled_chart_types.get("sankey") == "Sankey Diagram"


@pytest.mark.asyncio
async def test_gate_matrix_not_entitled_even_when_enabled():
    row = PluginEnablement(scope_key="org-free", plugin_id="enterprise_conn", enabled=True)
    db = _mock_db_with_rows([row])
    with patch("src.modules.plugins.service.org_has_plan_feature", new=AsyncMock(return_value=False)):
        active = await service.is_plugin_active(
            db, scope_key="org-free", plugin_id="enterprise_conn", organization_id="org-free"
        )
        assert active is False


@pytest.mark.asyncio
async def test_gate_matrix_not_installed():
    db = _mock_db_with_rows([])
    active = await service.is_plugin_active(db, scope_key="instance", plugin_id="non_existent")
    assert active is False


@pytest.mark.asyncio
async def test_config_is_fernet_encrypted_and_never_exposed_in_state():
    db = _mock_db_with_rows([])
    row = await service.set_plugin_enablement(
        db,
        scope_key="org-1",
        plugin_id="sankey",
        enabled=True,
        config={"auth_token": "super-secret-token"},
        user_id="user-1",
    )
    assert row.config_encrypted is not None
    assert "super-secret-token" not in row.config_encrypted

    db_with_row = _mock_db_with_rows([row])
    with patch("src.modules.plugins.service.org_has_plan_feature", new=AsyncMock(return_value=True)):
        states = await service.get_plugin_states(db_with_row, scope_key="org-1")
        sankey_state = next(s for s in states if s.id == "sankey")
        assert sankey_state.has_config is True
        dumped = sankey_state.model_dump()
        assert "super-secret-token" not in str(dumped)

