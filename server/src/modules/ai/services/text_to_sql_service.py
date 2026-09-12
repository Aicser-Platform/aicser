"""Community Edition natural-language → SQL generation (BYOK).

CE ships no managed AI. This service uses the user's own provider key
(configured in Settings → API Keys) via litellm to turn a question plus the
target data source schema into a read-only SQL statement. It never executes
the SQL — the caller inserts it into the editor for the user to run.
"""

from __future__ import annotations

import os
import re
from typing import Any, Optional

import sqlparse

from src.modules.ai.providers import (
    ENV_KEYS,
    PROVIDER_MODELS,
    litellm_model_string,
    provider_for_model,
    saved_provider_keys,
)

_DIALECTS = {
    "file": "duckdb",
    "postgresql": "postgres",
    "postgres": "postgres",
    "pg": "postgres",
    "mysql": "mysql",
    "mariadb": "mysql",
    "snowflake": "snowflake",
    "duckdb": "duckdb",
    "sample_duckdb": "duckdb",
    "bigquery": "bigquery",
    "clickhouse": "clickhouse",
    "redshift": "redshift",
    "mssql": "tsql",
    "sqlserver": "tsql",
    "tsql": "tsql",
    "sqlite": "sqlite",
}

_READ_ONLY_STARTS = ("select", "with")


class NoProviderKeyError(Exception):
    def __init__(self, provider: str):
        super().__init__(f"No AI provider key configured for '{provider}'.")
        self.provider = provider


class DataSourceAccessDeniedError(Exception):
    pass


class DataSourceNotFoundError(Exception):
    pass


class UnsafeSqlError(Exception):
    def __init__(self, sql: str):
        self.sql = sql
        super().__init__("Generated SQL is not a read-only SELECT")


def dialect_for_type(ds_type: str | None) -> str:
    if not ds_type:
        return "ansi"
    return _DIALECTS.get(str(ds_type).strip().lower(), "ansi")


def extract_sql(text: str) -> str:
    """Pull SQL out of an LLM reply that may be fenced or prefixed with prose."""
    if not text:
        return ""
    fence = re.search(r"```(?:sql)?\s*(.+?)```", text, re.DOTALL | re.IGNORECASE)
    candidate = fence.group(1) if fence else text
    return candidate.strip()


def is_read_only_sql(sql: str) -> bool:
    if not sql or not sql.strip():
        return False
    statements = [s for s in sqlparse.parse(sql) if str(s).strip()]
    if len(statements) != 1:
        return False
    first_token = statements[0].token_first(skip_cm=True)
    if first_token is None:
        return False
    return first_token.value.lower() in _READ_ONLY_STARTS


def render_schema(schema: dict[str, Any], max_tables: int = 40, max_cols: int = 60) -> str:
    schema = schema or {}
    tables = schema.get("tables") or []
    # Multi-sheet file sources load into DuckDB under prefixed physical names
    # (e.g. "sheet_6_fact_marketing_campaign"). The stored schema lists friendly
    # names but execution needs the physical ones, so present those to the LLM.
    duckdb_tables = schema.get("duckdb_tables") or {}
    lines: list[str] = []
    prompt_tables: list[dict[str, Any]] = []
    for table in tables[:max_tables]:
        name = table.get("name") or table.get("table") or "table"
        physical = duckdb_tables.get(name) or name
        cols = table.get("columns") or []
        rendered_cols = ", ".join(
            f"{c.get('name')}:{c.get('type', 'unknown')}" for c in cols[:max_cols] if c.get("name")
        )
        lines.append(f"- {physical}({rendered_cols})")
        prompt_tables.append({**table, "name": physical})
    body = "\n".join(lines) if lines else "(no schema available)"
    try:
        from src.shared.sql_schema_bind import format_join_paths_for_llm

        join_block = format_join_paths_for_llm({"tables": prompt_tables}, compact=True, max_tables=max_tables)
        if join_block:
            body = body + "\n" + join_block
    except Exception:
        pass
    return body


def build_messages(question: str, schema: dict[str, Any], dialect: str) -> list[dict[str, str]]:
    system = (
        f"You are a SQL expert. Generate a single valid {dialect} SQL query that answers the "
        "user's question using ONLY the tables and columns below.\n\n"
        "Rules:\n"
        "- Return ONLY the SQL, no explanation and no markdown fences.\n"
        "- The statement MUST be read-only: a single SELECT (or WITH ... SELECT). "
        "Never write INSERT/UPDATE/DELETE/DROP/ALTER/CREATE.\n"
        "- Use only the given tables and columns; do not invent names.\n"
        "- JOIN only when both tables list the same key column. Never invent a column to force a JOIN.\n"
        "- Add a reasonable LIMIT when the question implies a preview.\n\n"
        f"Schema:\n{render_schema(schema)}"
    )
    return [
        {"role": "system", "content": system},
        {"role": "user", "content": question},
    ]


_default_data_service = None


def _get_default_data_service():
    global _default_data_service
    if _default_data_service is None:
        from src.modules.data.services.data_connectivity_service import DataConnectivityService
        _default_data_service = DataConnectivityService()
    return _default_data_service


def _env_api_key(provider: str) -> str | None:
    if provider == "ollama":
        return None
    for env_name in ENV_KEYS.get(provider, ()):
        val = os.getenv(env_name)
        if val:
            return val
    return None


def _env_api_base(provider: str) -> str | None:
    if provider != "ollama":
        return None
    return os.getenv("OLLAMA_BASE_URL") or os.getenv("OLLAMA_HOST") or None


def _response_content(resp: Any) -> str:
    try:
        return resp.choices[0].message.content or ""
    except Exception:
        try:
            return resp["choices"][0]["message"]["content"] or ""
        except Exception:
            return ""


class TextToSqlService:
    def __init__(self, data_service=None, completion=None, provider_keys_fn=None, access_check_fn=None):
        self._data_service = data_service or _get_default_data_service()
        self._provider_keys_fn = provider_keys_fn or saved_provider_keys
        self._access_check_fn = access_check_fn
        self._completion = completion
        if self._completion is None:
            import litellm
            self._completion = litellm.acompletion

    def _pick_model(self, model: str | None, keys: dict) -> str | None:
        # CE has no managed "auto" tier (that's an EE/litellm_service concept) — treat
        # it the same as unset so the frontend's shared ModelSelector (which defaults
        # to 'auto') can be reused here without sending an id this picker can't resolve.
        if model and model != "auto":
            return model
        # Prefer a provider that has a key AND a saved default model.
        for provider, cfg in keys.items():
            if cfg.get("model"):
                return cfg["model"]
        # Else first catalog model of any provider that has a key.
        for provider in keys:
            catalog = PROVIDER_MODELS.get(provider) or []
            if catalog:
                return catalog[0]["id"]
        return None

    async def _load_schema(self, data_source_id: str):
        source = await self._data_service.get_data_source_by_id(data_source_id)
        if not source:
            raise DataSourceNotFoundError(data_source_id)
        ds_type = source.get("type")
        res = await self._data_service.get_source_schema(data_source_id)
        schema = res.get("schema") if res.get("success") else {}
        if not (schema and schema.get("tables")) and ds_type in ("database", "warehouse", "postgresql", "mysql"):
            db_res = await self._data_service.get_database_schema(data_source_id)
            if db_res.get("success"):
                schema = db_res.get("schema") or schema
        return schema or {"tables": []}, ds_type

    async def generate(self, user_id: str, question: str, data_source_id: str, model: str | None = None) -> dict:
        if not question or not data_source_id:
            raise ValueError("question and data_source_id are required")

        if self._access_check_fn is not None:
            allowed = await self._access_check_fn(user_id, data_source_id)
        else:
            from src.modules.data.services.data_source_access_service import DataSourceAccessService
            allowed = await DataSourceAccessService.can_query(user_id, data_source_id)
        if not allowed:
            raise DataSourceAccessDeniedError(data_source_id)

        keys = await self._provider_keys_fn(user_id)
        chosen_model = self._pick_model(model, keys)
        if not chosen_model:
            raise NoProviderKeyError("any")

        provider = provider_for_model(chosen_model, keys)
        cfg = keys.get(provider) or {}
        api_key = cfg.get("api_key") or _env_api_key(provider)
        api_base = cfg.get("endpoint") or _env_api_base(provider)
        if provider == "ollama":
            if not api_base:
                raise NoProviderKeyError(provider)
        elif not api_key:
            raise NoProviderKeyError(provider)

        schema, ds_type = await self._load_schema(data_source_id)
        dialect = dialect_for_type(ds_type)
        messages = build_messages(question, schema, dialect)

        completion_kwargs = {
            "model": litellm_model_string(provider, chosen_model),
            "messages": messages,
            "temperature": 0,
        }
        if api_key:
            completion_kwargs["api_key"] = api_key
        if api_base:
            completion_kwargs["api_base"] = api_base
        resp = await self._completion(**completion_kwargs)
        sql = extract_sql(_response_content(resp))
        if not is_read_only_sql(sql):
            raise UnsafeSqlError(sql)
        warning = None
        try:
            from src.shared.sql_schema_bind import bind_sql_to_schema, bind_fix_instruction, format_bind_error

            bound = bind_sql_to_schema(sql, schema, rewrite=True)
            sql = bound.sql
            if bound.issues:
                instruction = bind_fix_instruction(bound, schema)
                repair_messages = list(messages) + [
                    {"role": "assistant", "content": sql},
                    {
                        "role": "user",
                        "content": (
                            "That SQL is invalid against the schema:\n"
                            f"{instruction}\n"
                            "Rewrite ONE valid SELECT using only listed tables/columns and JOIN PATHS."
                        ),
                    },
                ]
                repair_kwargs = dict(completion_kwargs)
                repair_kwargs["messages"] = repair_messages
                resp2 = await self._completion(**repair_kwargs)
                repaired = extract_sql(_response_content(resp2))
                if is_read_only_sql(repaired):
                    bound2 = bind_sql_to_schema(repaired, schema, rewrite=True)
                    sql = bound2.sql
                    if bound2.issues:
                        warning = format_bind_error(bound2, schema)
                    else:
                        warning = None
                else:
                    warning = format_bind_error(bound, schema)
        except Exception:
            pass
        return {
            "success": True,
            "sql": sql,
            "model": chosen_model,
            "provider": provider,
            "dialect": dialect,
            "warning": warning,
        }
