import os
import types
import pytest
from unittest.mock import AsyncMock

if os.getenv("AISER_EDITION", "community").lower() in ("enterprise", "ee") or os.getenv("AISER_EDITION_LICENSE_KEY"):
    pytest.skip("CE-only text-to-sql", allow_module_level=True)

from src.modules.ai.services.text_to_sql_service import (
    dialect_for_type,
    extract_sql,
    is_read_only_sql,
    render_schema,
    build_messages,
    TextToSqlService,
    NoProviderKeyError,
)


# ── Pure helpers (Task 2) ─────────────────────────────────────────────────────

def test_dialect_for_type():
    assert dialect_for_type("file") == "duckdb"
    assert dialect_for_type("postgresql") == "postgres"
    assert dialect_for_type("postgres") == "postgres"
    assert dialect_for_type("mysql") == "mysql"
    assert dialect_for_type("snowflake") == "snowflake"
    assert dialect_for_type(None) == "ansi"
    assert dialect_for_type("weirddb") == "ansi"


def test_extract_sql_strips_fences_and_prose():
    raw = "Here you go:\n```sql\nSELECT 1;\n```\nHope that helps"
    assert extract_sql(raw) == "SELECT 1;"
    assert extract_sql("SELECT * FROM t") == "SELECT * FROM t"
    assert extract_sql("```\nWITH x AS (SELECT 1) SELECT * FROM x\n```").startswith("WITH x")


def test_is_read_only_sql():
    assert is_read_only_sql("SELECT * FROM t")
    assert is_read_only_sql("  with cte as (select 1) select * from cte")
    assert not is_read_only_sql("DELETE FROM t")
    assert not is_read_only_sql("update t set a=1")
    assert not is_read_only_sql("DROP TABLE t")


def test_render_schema_lists_tables_and_columns():
    schema = {"tables": [{"name": "orders", "columns": [{"name": "id", "type": "int"}, {"name": "amount", "type": "float"}]}]}
    out = render_schema(schema)
    assert "orders" in out and "id" in out and "amount" in out


def test_render_schema_uses_duckdb_physical_names():
    # Multi-sheet file sources load into DuckDB under prefixed physical names;
    # the LLM must see those so generated SQL actually executes.
    schema = {
        "tables": [
            {"name": "fact_marketing_campaign", "columns": [{"name": "impressions", "type": "BIGINT"}]},
            {"name": "dim_channel", "columns": [{"name": "channel", "type": "VARCHAR"}]},
        ],
        "duckdb_tables": {
            "fact_marketing_campaign": "sheet_6_fact_marketing_campaign",
            "dim_channel": "sheet_1_dim_channel",
        },
    }
    out = render_schema(schema)
    assert "- sheet_6_fact_marketing_campaign(" in out
    assert "- sheet_1_dim_channel(" in out
    # the bare friendly name must not be presented as a queryable table
    assert "- fact_marketing_campaign(" not in out
    assert "- dim_channel(" not in out


def test_build_messages_includes_schema_and_selectonly():
    schema = {"tables": [{"name": "orders", "columns": [{"name": "id", "type": "int"}]}]}
    msgs = build_messages("top orders", schema, "postgres")
    assert msgs[0]["role"] == "system"
    assert "orders" in msgs[0]["content"]
    assert "SELECT" in msgs[0]["content"].upper()
    assert msgs[-1]["role"] == "user" and "top orders" in msgs[-1]["content"]


# ── Orchestration (Task 3) ────────────────────────────────────────────────────

def _fake_completion_returning(sql_text):
    async def _completion(**kwargs):
        msg = types.SimpleNamespace(content=sql_text)
        choice = types.SimpleNamespace(message=msg)
        return types.SimpleNamespace(choices=[choice])
    return _completion


def _fake_data_service(ds_type="postgresql"):
    ds = AsyncMock()
    ds.get_data_source_by_id.return_value = {"id": "d1", "type": ds_type, "name": "db"}
    ds.get_source_schema.return_value = {
        "success": True,
        "schema": {"tables": [{"name": "orders", "columns": [{"name": "id", "type": "int"}]}]},
    }
    ds.get_database_schema.return_value = {"success": False}
    return ds


async def test_generate_returns_sql_and_metadata():
    svc = TextToSqlService(
        data_service=_fake_data_service(),
        completion=_fake_completion_returning("```sql\nSELECT * FROM orders LIMIT 10\n```"),
        provider_keys_fn=AsyncMock(return_value={"openai": {"api_key": "sk-x"}}),
    )
    out = await svc.generate(user_id="u1", question="show orders", data_source_id="d1", model="gpt-4o")
    assert out["success"] is True
    assert out["sql"] == "SELECT * FROM orders LIMIT 10"
    assert out["provider"] == "openai"
    assert out["dialect"] == "postgres"
    assert out["warning"] is None


async def test_generate_warns_on_non_select():
    svc = TextToSqlService(
        data_service=_fake_data_service(),
        completion=_fake_completion_returning("DELETE FROM orders"),
        provider_keys_fn=AsyncMock(return_value={"openai": {"api_key": "sk-x"}}),
    )
    out = await svc.generate(user_id="u1", question="wipe", data_source_id="d1", model="gpt-4o")
    assert out["sql"] == "DELETE FROM orders"
    assert out["warning"] and "read-only" in out["warning"].lower()


async def test_generate_no_key_raises(monkeypatch):
    # Clear any provider env keys so the "no key" path is deterministic
    # (a loaded .env may set OPENAI_API_KEY / AZURE_OPENAI_API_KEY at import).
    for var in ("OPENAI_API_KEY", "ANTHROPIC_API_KEY", "GOOGLE_API_KEY",
                "GEMINI_API_KEY", "AZURE_OPENAI_API_KEY"):
        monkeypatch.delenv(var, raising=False)
    svc = TextToSqlService(
        data_service=_fake_data_service(),
        completion=_fake_completion_returning("SELECT 1"),
        provider_keys_fn=AsyncMock(return_value={}),  # no saved keys
    )
    with pytest.raises(NoProviderKeyError) as exc:
        await svc.generate(user_id="u1", question="x", data_source_id="d1", model="gpt-4o")
    assert exc.value.provider == "openai"
