"""Snowflake URLConnector implementation for Aicser."""

from __future__ import annotations

from typing import Any, Dict, Mapping, Optional
from urllib.parse import quote, quote_plus, urlencode


def _get(cfg: Mapping[str, Any], *keys: str) -> Optional[str]:
    custom = cfg.get("custom_fields") if isinstance(cfg.get("custom_fields"), dict) else {}
    for key in keys:
        for source in (cfg, custom):
            value = source.get(key)
            if value not in (None, ""):
                return str(value).strip()
    return None


class SnowflakeConnector:
    """Implements URLConnector protocol for Snowflake."""

    def build_url(self, config: Mapping[str, Any]) -> str:
        raw_account = _get(config, "account", "host", "hostname", "server_hostname")
        user = _get(config, "username", "user")
        password = _get(config, "password")
        database = _get(config, "database", "db")
        schema = _get(config, "schema", "default_schema")
        warehouse = _get(config, "warehouse")
        role = _get(config, "role")

        if not raw_account or not user:
            raise ValueError("Snowflake needs an account identifier and a user.")

        account = (
            raw_account.replace("https://", "")
            .replace(".snowflakecomputing.com", "")
            .rstrip("/")
        )
        auth = (
            f"{quote_plus(user)}:{quote_plus(password)}@"
            if password is not None and password != ""
            else f"{quote_plus(user)}@"
        )
        path = (
            f"/{quote(database)}" + (f"/{quote(schema)}" if schema else "")
            if database
            else ""
        )

        params = {k: v for k, v in (("warehouse", warehouse), ("role", role)) if v}
        query_str = f"?{urlencode(params)}" if params else ""
        return f"snowflake://{auth}{account}{path}{query_str}"

    def engine_kwargs(self, config: Mapping[str, Any]) -> Dict[str, Any]:
        del config
        return {}

    def ping_sql(self) -> str:
        return "SELECT CURRENT_VERSION()"

