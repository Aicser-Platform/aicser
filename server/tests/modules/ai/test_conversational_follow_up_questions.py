"""Regression tests: Chat mode's terminal node (conversational_end_wrapper in
graph_builder.py) never set follow_up_questions at all, so Chat-mode turns
showed no follow-up chips while the full Auto/Analyze pipeline gets rich,
schema-grounded ones from response_finalizer_node's own enrichment step -- a
node the conversational short-circuit path (supervisor -> conversational_end
-> END) never reaches. conversational_follow_up_questions() closes that gap
with the same lightweight, real-column-name mechanism the fast-path greeting
responses already use, without adding Chat mode's whole reason for existing
(speed) a second LLM round-trip.
"""

from ee.modules.ai.orchestrator.graph_builder import conversational_follow_up_questions


_SCHEMA = {
    "tables": [
        {
            "name": "orders",
            "columns": [
                {"name": "order_id", "type": "integer"},
                {"name": "customer_id", "type": "integer"},
                {"name": "revenue", "type": "numeric"},
                {"name": "region", "type": "varchar"},
                {"name": "order_date", "type": "timestamp"},
            ],
        }
    ]
}


def test_no_data_source_returns_conversational_guidance_not_data_questions():
    out = conversational_follow_up_questions(has_data_source=False, data_source_schema=None)
    assert out
    assert any("connect a data source" in q.lower() for q in out)
    # Never the schema-driven data-question style, which would be misleading
    # (implying a real query/breakdown is possible) when there's no data source.
    assert not any(q.lower().startswith(("show ", "break down ", "top 10")) for q in out)


def test_data_source_with_schema_uses_real_column_names_not_generic_placeholders():
    out = conversational_follow_up_questions(has_data_source=True, data_source_schema=_SCHEMA)
    joined = " ".join(out).lower()
    assert "revenue" in joined or "region" in joined
    # Identifier columns must never surface as a suggested metric/dimension —
    # same class of bug already fixed for KPI cards elsewhere this session.
    assert "order_id" not in joined
    assert "customer_id" not in joined


def test_data_source_with_no_usable_schema_falls_back_to_static_data_questions():
    out = conversational_follow_up_questions(has_data_source=True, data_source_schema={})
    assert out
    # Falls back to FOLLOW_UP_QUESTIONS_DATA_ANALYSIS, not the no-data-source guidance.
    assert not any("connect a data source" in q.lower() for q in out)


def test_never_raises_on_malformed_schema():
    out = conversational_follow_up_questions(has_data_source=True, data_source_schema={"tables": "not-a-list"})
    assert isinstance(out, list)
