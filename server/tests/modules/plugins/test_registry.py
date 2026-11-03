"""Unit tests for Plug-in manifest validation and PluginRegistry (Issue 02)."""

from __future__ import annotations

import sys
from pathlib import Path
from unittest.mock import MagicMock, patch

import pytest
from pydantic import ValidationError

from src.modules.plugins.manifest import PluginManifest
from src.modules.plugins.registry import PluginRegistry


@pytest.fixture
def clean_registry() -> PluginRegistry:
    reg = PluginRegistry()
    reg.reset()
    return reg


def test_valid_manifest_parsing():
    raw = {
        "id": "custom_plugin",
        "name": "Custom Plugin",
        "version": "1.2.3",
        "api_version": "1",
        "description": "Test plugin",
        "default_enabled": True,
        "contributions": [
            {
                "kind": "visual",
                "chart_type": "chord_diagram",
                "label": "Chord Diagram",
                "bundle": "static/index.js",
            },
            {
                "kind": "connector",
                "db_type": "teradata",
                "label": "Teradata",
                "target": "my_pkg.connector:TeradataConnector",
                "default_port": 1025,
            },
        ],
    }
    manifest = PluginManifest.model_validate(raw)
    assert manifest.id == "custom_plugin"
    assert len(manifest.contributions) == 2
    assert manifest.contributions[0].kind == "visual"
    assert manifest.contributions[1].kind == "connector"


def test_invalid_slug_and_traversal_rejected():
    with pytest.raises(ValidationError):
        PluginManifest.model_validate(
            {
                "id": "Invalid Uppercase!",
                "name": "Bad",
                "version": "1.0.0",
                "api_version": "1",
            }
        )

    with pytest.raises(ValidationError):
        PluginManifest.model_validate(
            {
                "id": "bad_bundle",
                "name": "Bad Bundle",
                "version": "1.0.0",
                "api_version": "1",
                "contributions": [
                    {
                        "kind": "visual",
                        "chart_type": "sankey",
                        "label": "Sankey",
                        "bundle": "../secret.js",
                    }
                ],
            }
        )

    with pytest.raises(ValidationError):
        PluginManifest.model_validate(
            {
                "id": "bad_api_ver",
                "name": "Bad API Version",
                "version": "1.0.0",
                "api_version": "99",
            }
        )


def test_duplicate_plugin_id_skipped(clean_registry: PluginRegistry):
    m1 = clean_registry.register_manifest_dict(
        {
            "id": "dup_test",
            "name": "First",
            "version": "1.0.0",
            "api_version": "1",
        }
    )
    m2 = clean_registry.register_manifest_dict(
        {
            "id": "dup_test",
            "name": "Second",
            "version": "2.0.0",
            "api_version": "1",
        }
    )
    assert m1 is not None
    assert m2 is None
    clean_registry._discovered = True
    assert clean_registry.get_manifest("dup_test").name == "First"


def test_core_collisions_rejected(clean_registry: PluginRegistry):
    clean_registry._discovered = True
    manifest = clean_registry.register_manifest_dict(
        {
            "id": "rogue_plugin",
            "name": "Rogue",
            "version": "1.0.0",
            "api_version": "1",
            "contributions": [
                {
                    "kind": "connector",
                    "db_type": "postgres",
                    "label": "Fake Postgres",
                    "target": "rogue:FakePg",
                },
                {
                    "kind": "visual",
                    "chart_type": "bar",
                    "label": "Fake Bar",
                    "bundle": "bar.js",
                },
                {
                    "kind": "visual",
                    "chart_type": "marimekko",
                    "label": "Marimekko",
                    "bundle": "marimekko.js",
                },
            ],
        }
    )
    assert manifest is not None
    # Core 'postgres' and 'bar' must be stripped; 'marimekko' stays
    assert len(manifest.contributions) == 1
    assert clean_registry.get_connector_contribution("postgres") is None
    assert clean_registry.get_visual("bar") is None
    assert clean_registry.get_visual("marimekko") is not None


def test_lazy_connector_resolution_and_entry_points(clean_registry: PluginRegistry, tmp_path: Path):
    ep = MagicMock()
    ep.name = "mock_warehouse"
    ep.value = "mock_pkg:manifest"
    ep.load.return_value = {
        "id": "mock_warehouse",
        "name": "Mock Warehouse",
        "version": "1.0.0",
        "api_version": "1",
        "assets_dir": "static",
        "contributions": [
            {
                "kind": "connector",
                "db_type": "mockdb",
                "label": "MockDB",
                "target": "fake_lazy_driver_mod:FakeConnector",
            }
        ],
    }

    with patch("importlib.metadata.entry_points", return_value=[ep]):
        clean_registry.discover(force=True)

    # Driver module must NOT be imported during discovery
    assert "fake_lazy_driver_mod" not in sys.modules
    assert clean_registry.get_manifest("mock_warehouse") is not None
    assert "mockdb" in clean_registry.get_connector_db_types()

    # Now register a fake module and verify lazy resolution on get_connector()
    fake_mod = MagicMock()

    class FakeConnector:
        def build_url(self, cfg):
            return "mockdb://localhost/test"

    fake_mod.FakeConnector = FakeConnector
    with patch.dict(sys.modules, {"fake_lazy_driver_mod": fake_mod}):
        conn = clean_registry.get_connector("mockdb")
        assert conn is not None
        assert conn.build_url({}) == "mockdb://localhost/test"

