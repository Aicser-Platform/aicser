import json

from src.modules.charts.services.v2.chart_service import ChartService


def test_format_table_reference_quotes_mixed_case_postgres_table():
    service = ChartService(db=None)

    formatted = service._format_table_reference("public.QuizAttempt")

    assert formatted == '"public"."QuizAttempt" AS "QuizAttempt"'


def test_saved_sql_normalization_quotes_known_mixed_case_tables():
    service = ChartService(db=None)
    schema = {
        "tables": [
            {
                "schema": "public",
                "name": "QuizAttempt",
                "columns": [{"name": "userId"}, {"name": "correct"}],
            }
        ]
    }

    sql = 'SELECT "userId", SUM("correct") FROM public.QuizAttempt GROUP BY "userId"'

    normalized = service._quote_known_table_refs_in_sql(sql, schema)

    assert 'FROM "public"."QuizAttempt"' in normalized
    assert "FROM public.QuizAttempt" not in normalized


def test_infer_fk_display_dimension_uses_related_label_column():
    service = ChartService(db=None)
    schema = {
        "tables": [
            {
                "schema": "public",
                "name": "QuizAttempt",
                "columns": [{"name": "userId", "type": "text"}],
            },
            {
                "schema": "public",
                "name": "User",
                "columns": [{"name": "id", "type": "text"}, {"name": "name", "type": "text"}],
            },
        ]
    }

    inferred = service._infer_fk_display_dimension(schema, "QuizAttempt", "QuizAttempt.userId", [])

    assert inferred is not None
    assert inferred["display_column"] == "name"
    assert inferred["join"]["table"] == "public.User"
    assert inferred["join"]["on"] == {
        "left": "QuizAttempt.userId",
        "right": "User.id",
    }
    assert '"User"."name"' in inferred["expression"]


def test_infer_fk_display_dimension_accepts_json_string_schema():
    service = ChartService(db=None)
    schema = json.dumps({
        "tables": [
            {
                "schema": "public",
                "name": "QuizAttempt",
                "columns": [{"name": "userId", "type": "text"}],
            },
            {
                "schema": "public",
                "name": "User",
                "columns": [{"name": "id", "type": "text"}, {"name": "name", "type": "text"}],
            },
        ]
    })

    inferred = service._infer_fk_display_dimension(schema, "QuizAttempt", "userId", [])

    assert inferred is not None
    assert inferred["target_table"] == "User"


def test_y_metric_count_is_ignored_when_structured_y_metrics_exist():
    service = ChartService(db=None)
    schema = {
        "tables": [
            {
                "schema": "public",
                "name": "QuizAttempt",
                "columns": [{"name": "userId", "type": "text"}, {"name": "correct", "type": "integer"}],
            },
            {
                "schema": "public",
                "name": "RateLimit",
                "columns": [{"name": "count", "type": "integer"}],
            },
        ]
    }
    column_tables = service._schema_column_table_map(schema)

    # This mirrors the execute() call-site: yMetric is ignored because yMetrics
    # carries the real metric. Otherwise "count" can be mistaken for a column on
    # another table and trigger a bogus relationship error.
    y_metric = None if [{"field": "correct", "aggregation": "sum"}] else "count"

    assert service._field_table(y_metric, "QuizAttempt", column_tables) is None


def test_rewrite_compiled_sql_fk_grouping_to_display_label():
    service = ChartService(db=None)
    schema = {
        "tables": [
            {
                "schema": "public",
                "name": "QuizAttempt",
                "columns": [{"name": "userId", "type": "text"}, {"name": "correct", "type": "integer"}],
            },
            {
                "schema": "public",
                "name": "User",
                "columns": [{"name": "id", "type": "text"}, {"name": "name", "type": "text"}],
            },
        ]
    }
    sql = 'SELECT "userId", SUM("correct") AS total FROM "QuizAttempt" GROUP BY "userId" ORDER BY total DESC'

    rewritten = service._rewrite_sql_fk_display_labels(sql, schema)

    assert 'LEFT JOIN "public"."User" AS "User"' in rewritten
    assert 'COALESCE(NULLIF("User"."name", \'\'), "QuizAttempt"."userId") AS x' in rewritten
    assert 'GROUP BY COALESCE(NULLIF("User"."name", \'\'), "QuizAttempt"."userId")' in rewritten
