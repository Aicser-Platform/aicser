"""Regression tests for Chat mode staying on the fast streaming path when a
data source is connected.

Root cause: api_streaming.py's conversational streaming path (real token-by-
token LLM streaming, no multi-stage pipeline) previously only activated when
`not request.data_source_id` -- so a user who explicitly selected Chat mode
in the UI, but had a data source connected (the common case), silently fell
through to the full LangGraph supervisor pipeline instead: no token
streaming, and the generic "Understand -> Query -> Analyze -> Visualize"
stepper UI, which looks and feels like a heavyweight SQL analytics run
rather than a chat reply. The explicit mode selection was never being
respected once a data source existed.

Fixed by checking analysis_mode == "chat"/"conversational" (normalized)
alongside the missing-data-source case, and by giving the LLM a schema-only
context (table/column names, no live query) via
CONVERSATIONAL_SYSTEM_PROMPT_WITH_SCHEMA + _chat_mode_schema_summary, so it
can answer structural questions directly and honestly hand off to Auto/
Analytics mode for anything needing real computed data -- rather than either
running a query itself (which would reintroduce the pipeline delay) or
answering with numbers it doesn't actually have.
"""

from ee.modules.ai.api_streaming import _chat_mode_schema_summary, _normalize_mode


def test_chat_mode_normalizes_to_conversational_alias():
    assert _normalize_mode("conversational") in ("chat", "conversational")
    assert _normalize_mode("Chat") in ("chat", "conversational")
    assert _normalize_mode("CONVERSATIONAL") in ("chat", "conversational")


def test_other_modes_do_not_match_chat():
    for mode in ("predictive", "diagnostic", "prescriptive", "standard", "descriptive", "dashboard"):
        assert _normalize_mode(mode) not in ("chat", "conversational")


def test_schema_summary_lists_table_and_column_names():
    schema = {
        "tables": [
            {"name": "subscribers", "columns": [{"name": "id"}, {"name": "plan_id"}, {"name": "name"}]},
            {"name": "usage_records", "columns": [{"name": "id"}, {"name": "bill_date"}]},
        ]
    }
    summary = _chat_mode_schema_summary(schema)
    assert "TABLE subscribers: id, plan_id, name" in summary
    assert "TABLE usage_records: id, bill_date" in summary


def test_schema_summary_never_includes_row_counts_or_values():
    """Chat mode never runs a query -- the summary must not imply it has
    live data (row counts, sample values), only structure."""
    schema = {
        "tables": [
            {"name": "plans", "row_count": 5, "columns": [{"name": "id"}, {"name": "name"}]},
        ]
    }
    summary = _chat_mode_schema_summary(schema)
    assert "5" not in summary
    assert "row_count" not in summary


def test_schema_summary_handles_missing_schema_gracefully():
    assert _chat_mode_schema_summary(None) == "No schema available."
    assert _chat_mode_schema_summary({}) == "No schema available."


def test_schema_summary_handles_flat_columns_shape():
    """Some schema payloads are a single table's columns at the top level
    (schema.columns) rather than a tables[] list -- must still produce a
    usable summary, not silently drop the data."""
    schema = {"table_name": "sales", "columns": [{"name": "amount"}, {"name": "date"}]}
    summary = _chat_mode_schema_summary(schema)
    assert "TABLE sales: amount, date" in summary
