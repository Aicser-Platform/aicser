"""Aicser Snowflake Connector Plug-in."""

# CRITICAL: Do NOT import snowflake.connector or connector.py here!
# Manifest must be imported instantly without importing driver dependencies.

manifest = {
    "id": "snowflake",
    "name": "Snowflake",
    "version": "1.0.0",
    "api_version": "1",
    "description": "Connect to Snowflake Data Cloud warehouses",
    "author": "Aicser Core Team",
    "homepage": "https://aicser.com",
    "requires_feature": None,
    "default_enabled": True,
    "contributions": [
        {
            "kind": "connector",
            "db_type": "snowflake",
            "label": "Snowflake",
            "target": "aicser_plugin_snowflake.connector:SnowflakeConnector",
            "default_port": 443,
        }
    ],
}

