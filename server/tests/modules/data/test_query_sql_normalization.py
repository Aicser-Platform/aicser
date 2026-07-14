from src.modules.data.services.multi_engine_query_service import quote_known_table_refs_for_sql


def test_quote_known_table_refs_for_postgres_mixed_case_schema_table():
    schema = {
        "tables": [
            {"schema": "public", "name": "Account"},
            {"schema": "public", "name": "QuizAttempt"},
        ]
    }

    sql = "SELECT * from public.Account\nLIMIT 1000;"

    normalized = quote_known_table_refs_for_sql(sql, schema)

    assert 'from "public"."Account"' in normalized
    assert "public.Account" not in normalized


def test_quote_known_table_refs_handles_json_string_schema_and_joins():
    schema = '{"tables":[{"schema":"public","name":"QuizAttempt"},{"schema":"public","name":"User"}]}'

    sql = 'SELECT * FROM public.QuizAttempt qa JOIN public.User u ON qa."userId" = u.id'

    normalized = quote_known_table_refs_for_sql(sql, schema)

    assert 'FROM "public"."QuizAttempt" qa' in normalized
    assert 'JOIN "public"."User" u' in normalized


def test_quote_known_table_refs_does_not_touch_unknown_tables_or_literals():
    schema = {"tables": [{"schema": "public", "name": "Account"}]}

    sql = "SELECT 'public.Account' AS label FROM public.lowercase_table"

    normalized = quote_known_table_refs_for_sql(sql, schema)

    assert normalized == sql


def test_quote_known_table_refs_rewrites_postgres_database_alias_to_real_schema():
    schema = {"tables": [{"schema": "public", "name": "User"}]}

    sql = 'SELECT streak, AVG("avgScore") FROM railway.User WHERE streak IS NOT NULL GROUP BY 1'

    normalized = quote_known_table_refs_for_sql(sql, schema, schema_aliases=["railway"])

    assert 'FROM "public"."User"' in normalized
    assert "railway.User" not in normalized


def test_quote_known_table_refs_rewrites_partially_quoted_postgres_alias():
    schema = {"tables": [{"schema": "public", "name": "User"}]}

    sql = 'SELECT streak FROM railway."User" WHERE streak IS NOT NULL'

    normalized = quote_known_table_refs_for_sql(sql, schema, schema_aliases=["railway"])

    assert 'FROM "public"."User"' in normalized
    assert 'railway."User"' not in normalized
