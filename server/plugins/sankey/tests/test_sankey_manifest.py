"""Unit tests for the Sankey visual plug-in package (Issue 10)."""

from __future__ import annotations

import sys
from pathlib import Path

from src.modules.plugins.manifest import PluginManifest

SANKEY_PLUGIN_ROOT = Path(__file__).resolve().parents[1]
if str(SANKEY_PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(SANKEY_PLUGIN_ROOT))


def test_sankey_manifest_and_bundle_exist():
    import aicser_plugin_sankey

    manifest = PluginManifest.model_validate(aicser_plugin_sankey.manifest)
    assert manifest.id == "sankey"
    assert manifest.default_enabled is True
    assert manifest.assets_dir == "static"
    assert len(manifest.contributions) == 1
    assert manifest.contributions[0].kind == "visual"
    assert manifest.contributions[0].chart_type == "sankey"

    bundle_path = (
        SANKEY_PLUGIN_ROOT
        / "aicser_plugin_sankey"
        / manifest.assets_dir
        / manifest.contributions[0].bundle
    )
    assert bundle_path.is_file()
    content = bundle_path.read_text(encoding="utf-8")
    assert "mount(" in content
    assert "export default" in content

