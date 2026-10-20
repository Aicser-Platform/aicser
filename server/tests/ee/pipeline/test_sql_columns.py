from src.modules.pipeline.ingest.sql_columns import build_select_columns, quote_table


def test_build_select_columns_star_when_empty():
    assert build_select_columns(None) == "*"
    assert build_select_columns([]) == "*"


def test_build_select_with_alias():
    sql = build_select_columns(["id", "email"], {"email": "email_hash"})
    assert "email" in sql and "email_hash" in sql


def test_quote_table_schema():
    assert quote_table("public.orders") == '"public"."orders"'
