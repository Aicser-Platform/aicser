"""Unit tests for the Snowflake connector plug-in package (Issue 06)."""

from __future__ import annotations

import sys
from pathlib import Path

import pytest

SNOWFLAKE_PLUGIN_ROOT = Path(__file__).resolve().parents[1]
if str(SNOWFLAKE_PLUGIN_ROOT) not in sys.path:
    sys.path.insert(0, str(SNOWFLAKE_PLUGIN_ROOT))


def test_manifest_loads_without_importing_snowflake_driver():
    sys.modules.pop("aicser_plugin_snowflake.connector", None)
    sys.modules.pop("aicser_plugin_snowflake", None)
    import aicser_plugin_snowflake

    assert aicser_plugin_snowflake.manifest["id"] == "snowflake"
    assert aicser_plugin_snowflake.manifest["default_enabled"] is True
    assert "aicser_plugin_snowflake.connector" not in sys.modules


def test_snowflake_connector_build_url_and_ping():
    from aicser_plugin_snowflake.connector import SnowflakeConnector

    conn = SnowflakeConnector()
    url = conn.build_url(
        {
            "account": "org-acct.us-east-1",
            "username": "svc_user",
            "password": "p@ssword!",
            "database": "PROD",
            "schema": "FINANCE",
            "warehouse": "WH_LARGE",
            "role": "ANALYST",
        }
    )
    assert url == (
        "snowflake://svc_user:p%40ssword%21@org-acct.us-east-1/PROD/FINANCE"
        "?warehouse=WH_LARGE&role=ANALYST"
    )
    assert conn.ping_sql() == "SELECT CURRENT_VERSION()"

    with pytest.raises(ValueError, match="account identifier"):
        conn.build_url({"username": "u"})
