"""Regression tests for holistic workflow hardening (alignment, chart, routing, mode matrix)."""

from src.modules.ai.nodes.post_query_brain import _check_intent_result_alignment
from src.modules.ai.utils.guaranteed_chart_builder import build_guaranteed_chart
from src.modules.ai.data_source_capabilities import is_file_upload_duckdb, uses_duckdb_for_execution
from src.modules.ai.utils.schema_for_llm import (
    compute_likely_dimension_columns,
    format_schema_for_llm,
    list_temporal_column_names_from_schema,
    schema_needs_refresh,
)
from src.modules.ai.nodes.error_correction_node import (
    _sql_fingerprint,
    _record_attempted_sql,
    _is_duplicate_sql,
    _format_sql_history_for_prompt,
    _uses_post_query_sql_budget_lane,
)
from src.modules.ai.config.workflow_config import WorkflowConfig


def test_alignment_gate_triggers_on_metric_mismatch():
    query = "top 10 policy_number by premium_annual"
    rows = [{"payment_status": "paid", "record_count": 3}]
    intent = {
        "primary_metric_hint": "premium_annual",
        "primary_dimension_hint": "policy_number",
        "is_ranking": True,
        "sql_columns": {"resolved_metrics": ["premium_annual"], "resolved_dimensions": ["policy_number"]},
    }
    score, _reason, corrections = _check_intent_result_alignment(
        query, rows, intent, "SELECT payment_status, COUNT(*) AS record_count FROM t GROUP BY 1"
    )
    # Penalties cap at 0.65 → score = 0.35; with lenient threshold (0.30)
    # this produces a low score but stays in the warning zone (not correction zone).
    assert score <= 0.35
    assert "Expected metric" in _reason or "not found" in _reason


def test_chart_builder_domain_agnostic_columns():
    """Manufacturing-style columns without domain metadata still produce a valid chart."""
    data = [
        {"line_id": f"L{i % 3}", "yield_rate": 0.85 + i * 0.01, "defect_count": i % 5}
        for i in range(12)
    ]
    chart = build_guaranteed_chart(
        data,
        query="yield rate by production line",
        intent={"data_source_schema": {"business_metadata": {}}},
    )
    series = chart.get("series") or []
    assert isinstance(series, list) and len(series) >= 1
    assert series[0].get("data") is not None


def test_file_upload_duckdb_covers_csv_not_sample_warehouse():
    assert is_file_upload_duckdb("csv", None) is True
    assert is_file_upload_duckdb("file", "csv") is True
    assert is_file_upload_duckdb("sample_duckdb", None) is False
    assert uses_duckdb_for_execution("sample_duckdb", None) is True


def test_schema_helpers_dimensions_and_temporal():
    schema = {
        "tables": [
            {
                "name": "orders",
                "columns": [
                    {"name": "region", "type": "VARCHAR", "distinct_count": 12},
                    {"name": "order_date", "type": "DATE", "distinct_count": 400},
                ],
            }
        ]
    }
    dims = compute_likely_dimension_columns(schema)
    assert "region" in dims
    temporal = list_temporal_column_names_from_schema(schema)
    assert "order_date" in temporal


def test_mode_x_source_matrix_smoke():
    """Lightweight matrix: each mode pairs with representative source capability flags."""
    modes = ("descriptive", "diagnostic", "predictive", "prescriptive", "animate", "executive_report")
    sources = ("csv", "postgresql", "sample_duckdb", "knowledge_base")
    for _m in modes:
        for s in sources:
            duck = uses_duckdb_for_execution(s, None)
            file_like = is_file_upload_duckdb(s, None)
            assert isinstance(duck, bool)
            assert isinstance(file_like, bool)
            if s == "knowledge_base":
                assert duck is False and file_like is False
            if s == "csv":
                assert duck is True and file_like is True
            if s == "sample_duckdb":
                assert duck is True and file_like is False


# ── SQL deduplication and fix history tests ──────────────────────────────────


def test_sql_fingerprint_normalizes_whitespace_and_case():
    """Same logical SQL with different whitespace/casing should produce the same fingerprint."""
    fp1 = _sql_fingerprint("SELECT id FROM users WHERE active = 1")
    fp2 = _sql_fingerprint("select   id   from   users   where   active = 1")
    fp3 = _sql_fingerprint("SELECT id FROM users WHERE active = 2")
    assert fp1 == fp2, "Whitespace/case normalization should produce identical fingerprints"
    assert fp1 != fp3, "Different SQL should produce different fingerprints"


def test_post_query_sql_lane_flag_not_stage():
    """post_query brain must tag context; stage is overwritten before _correct_sql."""
    assert _uses_post_query_sql_budget_lane({"post_query_sql_lane": True, "issue": "x"}, "x") is True
    assert _uses_post_query_sql_budget_lane(None, "intent_sql_mismatch") is True
    assert _uses_post_query_sql_budget_lane({}, "wrong_scope") is True
    assert _uses_post_query_sql_budget_lane({}, "query_execution_error") is False


def test_record_and_detect_duplicate_sql():
    """Recording SQL builds history; _is_duplicate_sql checks against it."""
    state = {"execution_metadata": {}}
    assert _is_duplicate_sql(state, "SELECT 1 FROM t") is False
    _record_attempted_sql(state, "SELECT 1 FROM t", "some error")
    assert _is_duplicate_sql(state, "SELECT 1 FROM t") is True, "Same SQL should be detected"
    assert _is_duplicate_sql(state, "SELECT 2 FROM t") is False, "Different SQL should not match"
    _record_attempted_sql(state, "SELECT 1 FROM t", "same error")  # idempotent
    history = state["execution_metadata"]["sql_fix_history"]
    assert len(history) == 1, "Duplicate recording should not add a second entry"


async def test_correct_sql_truncated_llm_output_does_not_consume_budget(monkeypatch):
    """Truncated proposed SQL must not increment sql_correction (was burning 4/4 on token-cutoff loops)."""
    from src.modules.ai.nodes import error_correction_node as ecn

    async def fake_fix(*args, **kwargs):
        # No FROM clause → sql_looks_truncated True
        return "SELECT COUNT(*)"

    monkeypatch.setattr(ecn, "_apply_sql_rule_fixes", lambda *a, **k: None)
    monkeypatch.setattr(ecn, "_fix_sql_with_llm", fake_fix)

    state = {
        "sql_query": "SELECT COUNT(*) FROM orders",
        "error": "syntax error near JOIN",
        "execution_metadata": {
            "mode": "standard",
            "unified_retry_state": {"sql_correction": 0, "total_retries": 0},
        },
        "correction_context": {
            "error_type": "sql",
            "issue": "query_execution_error",
            "instruction": "fix join",
        },
    }
    ok = await ecn._correct_sql(state, litellm_service=object())
    assert ok is False
    assert state["execution_metadata"]["unified_retry_state"]["sql_correction"] == 0
    assert state.get("sql_correction_skip_reason") == "llm_returned_truncated_sql"


def test_format_sql_history_for_prompt_empty_and_populated():
    """History prompt should be empty when no attempts, and contain entries when populated."""
    empty_state = {"execution_metadata": {}}
    assert _format_sql_history_for_prompt(empty_state) == ""

    state = {"execution_metadata": {"sql_fix_history": [
        {"fingerprint": "abc", "sql_preview": "SELECT 1", "error_preview": "table not found"},
        {"fingerprint": "def", "sql_preview": "SELECT 2", "error_preview": "column not found"},
    ]}}
    prompt = _format_sql_history_for_prompt(state)
    assert "PREVIOUS FAILED ATTEMPTS" in prompt
    assert "SELECT 1" in prompt
    assert "SELECT 2" in prompt
    assert "table not found" in prompt


# ── Schema formatting: sample values and PK/FK annotations ──────────────────


def test_schema_format_includes_pk_fk_annotations():
    """PK and FK columns should be annotated in the schema output."""
    schema = {
        "tables": [{
            "name": "orders",
            "columns": [
                {"name": "order_id", "type": "INTEGER", "is_primary_key": True},
                {"name": "customer_id", "type": "INTEGER", "is_foreign_key": True},
                {"name": "amount", "type": "DECIMAL"},
            ],
        }]
    }
    output = format_schema_for_llm(schema)
    assert "(PK)" in output, "Primary key should be annotated with (PK)"
    assert "(FK)" in output, "Foreign key should be annotated with (FK)"


def test_schema_format_prioritizes_ref_tables_for_animate_by_type():
    """Animate + 'by type' should surface ref_* lookup tables (JOIN targets), not only fact tables."""
    schema = {
        "connection_database": "insurance",
        "tables": [
            {"name": "_placeholder", "schema": "insurance", "row_count": 0, "columns": [{"name": "x", "type": "INT"}]},
            {
                "name": "claims",
                "schema": "insurance",
                "row_count": 80,
                "columns": [
                    {"name": "claim_id", "type": "UUID"},
                    {"name": "claim_type_id", "type": "INT", "is_foreign_key": True},
                    {"name": "claim_amount", "type": "DECIMAL"},
                    {"name": "incurred_date", "type": "DATE"},
                ],
            },
            {
                "name": "ref_claim_type",
                "schema": "insurance",
                "row_count": 12,
                "columns": [
                    {"name": "claim_type_id", "type": "INT", "is_primary_key": True},
                    {"name": "type_name", "type": "VARCHAR"},
                ],
            },
        ],
    }
    q = "Animate bar chart with total claims amount per month by type"
    out = format_schema_for_llm(
        schema,
        query=q,
        max_tables=3,
        max_columns_per_table=20,
        compact=True,
        include_summary_line=False,
        analytics_type="animate",
    )
    assert "ref_claim_type" in out
    assert "_placeholder" not in out
    idx_claims = out.find("claims")
    idx_ref = out.find("ref_claim_type")
    assert idx_ref != -1 and idx_claims != -1
    assert idx_ref < idx_claims, "ref_claim_type should sort before claims for this animate query"


def test_schema_format_includes_sample_values():
    """When include_sample_values=True, sample data should appear in the output."""
    schema = {
        "tables": [{
            "name": "products",
            "columns": [
                {"name": "name", "type": "VARCHAR"},
                {"name": "price", "type": "DECIMAL"},
            ],
            "sample_data": [
                {"name": "Widget A", "price": 9.99},
                {"name": "Widget B", "price": 19.99},
            ],
        }]
    }
    with_samples = format_schema_for_llm(schema, include_sample_values=True)
    without_samples = format_schema_for_llm(schema, include_sample_values=False)
    assert "Widget A" in with_samples, "Sample values should appear when enabled"
    assert "Widget A" not in without_samples, "Sample values should not appear when disabled"


def test_extract_sql_preserves_single_line_date_trunc():
    """Step 4 JSON cleanup must not strip everything after the `',` in date_trunc('month', col)."""
    from src.modules.ai.utils.sql_cleaner import extract_sql_from_llm_output, sql_looks_truncated

    sql = (
        "SELECT date_trunc('month', c.closed_date) AS m, SUM(c.amount) AS t "
        "FROM insurance.claims c GROUP BY 1"
    )
    out = extract_sql_from_llm_output(sql)
    assert "FROM insurance.claims" in out
    assert not sql_looks_truncated(out)


def test_normalize_sql_contract_skips_lossy_extract_for_json_object():
    from src.modules.ai.utils.sql_cleaner import normalize_sql_from_llm_contract, sql_looks_truncated

    sql = (
        "SELECT date_trunc('month', c.closed_date) AS m FROM insurance.claims c"
    )
    out = normalize_sql_from_llm_contract(sql, sql_contract="json_object")
    assert "FROM insurance.claims" in out
    assert not sql_looks_truncated(out)


def test_normalize_workflow_sql_input_matches_contract_and_state():
    from src.modules.ai.utils.sql_cleaner import normalize_workflow_sql_input, sql_looks_truncated

    sql = "SELECT date_trunc('month', x.d) AS m FROM t x"
    out = normalize_workflow_sql_input(sql, state={"sql_contract": "json_object"})
    assert "FROM t" in out
    assert not sql_looks_truncated(out)
    out2 = normalize_workflow_sql_input(sql, sql_contract="json_object")
    assert out2 == out


def test_schema_format_compact_includes_sample_row_when_enabled():
    """Compact mode must still surface at least one sample_row (large schemas use compact=True)."""
    schema = {
        "tables": [{
            "name": "products",
            "columns": [
                {"name": "name", "type": "VARCHAR"},
                {"name": "price", "type": "DECIMAL"},
            ],
            "sample_data": [{"name": "Widget A", "price": 9.99}],
        }]
    }
    out = format_schema_for_llm(
        schema,
        compact=True,
        include_sample_values=True,
        include_summary_line=False,
    )
    assert "sample_row" in out
    assert "Widget A" in out
    assert "GROUNDING:" in out


# ── Schema completeness detection ────────────────────────────────────────────


def test_schema_needs_refresh_detects_incomplete_schema():
    """Schema with tables but no columns should be flagged for refresh."""
    incomplete = {"tables": [
        {"name": "orders", "columns": []},
        {"name": "products"},
    ]}
    assert schema_needs_refresh(incomplete) is True

    complete = {"tables": [
        {"name": "orders", "columns": [{"name": "id", "type": "INT"}]},
    ]}
    assert schema_needs_refresh(complete) is False

    empty = {"tables": []}
    assert schema_needs_refresh(empty) is False

    none_schema = None
    assert schema_needs_refresh(none_schema) is False


# ── Follow-up detection in intent analysis ───────────────────────────────────


def test_intent_analysis_detects_follow_up():
    """Queries referencing previous results should set is_follow_up=True."""
    from src.modules.ai.utils.intent_analysis import extract_query_intent

    follow_ups = [
        "show that by month",
        "now filter to only active customers",
        "break it down by region",
        "same but for last year",
        "drill down into Q1",
        "also add the count",
    ]
    for q in follow_ups:
        intent = extract_query_intent(q)
        assert intent.get("is_follow_up") is True, f"Expected is_follow_up=True for: {q!r}"

    new_queries = [
        "show me total revenue by region",
        "how many customers signed up this month",
        "what is the average order value",
    ]
    for q in new_queries:
        intent = extract_query_intent(q)
        assert intent.get("is_follow_up") is False, f"Expected is_follow_up=False for: {q!r}"


# ── User-friendly error sanitization ─────────────────────────────────────────


def test_user_friendly_errors_blocks_technical_details():
    """Technical stack traces and class names should never reach the user."""
    from src.modules.ai.utils.user_friendly_errors import make_error_user_friendly

    technical_msgs = [
        'Traceback (most recent call last): File "/app/main.py", line 42',
        "raise ValueError('unexpected None in self.__init__')",
        "KeyError: 'missing_key' in <class 'dict'>",
        "AttributeError: 'NoneType' object at 0x7fffe28c0",
    ]
    for msg in technical_msgs:
        result = make_error_user_friendly(msg)
        assert "traceback" not in result.lower(), f"Leaked technical detail: {result!r}"
        assert "raise " not in result.lower(), f"Leaked technical detail: {result!r}"
        assert "0x" not in result.lower(), f"Leaked technical detail: {result!r}"

    long_msg = "x " * 200
    result = make_error_user_friendly(long_msg)
    assert len(result) <= 320, f"Error message too long ({len(result)} chars)"


# ── Graceful response column regex ───────────────────────────────────────────


def test_graceful_response_column_regex_handles_many_formats():
    """Column name extraction should work for various DB error formats."""
    import re

    pattern = (
        r"""(?:column|field)\s*['"` ]+(\w+)"""
        r"""|(?:column|field)\s+(\w+)\s+(?:does not exist|not found|is not valid)"""
        r"""|(?:unknown|missing|invalid)\s+(?:column|field)\s*['"` ]*(\w+)"""
    )

    test_cases = {
        "column 'revenue' does not exist": "revenue",
        'column "amount" not found': "amount",
        "column `status` is not valid": "status",
        "Unknown column 'total_price'": "total_price",
        "Missing column cost": "cost",
        "column revenue does not exist": "revenue",
        "invalid field margin": "margin",
    }
    for error_text, expected_col in test_cases.items():
        match = re.search(pattern, error_text.lower())
        assert match is not None, f"No match for: {error_text!r}"
        extracted = next((g for g in match.groups() if g), None)
        assert extracted == expected_col.lower(), (
            f"Expected {expected_col!r} from {error_text!r}, got {extracted!r}"
        )
