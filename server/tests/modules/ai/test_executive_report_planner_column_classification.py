"""Root-cause fix: executive report column selection must exclude identifier
columns for EVERY section type, not just KPI sections, and must consult a
cached per-data-source LLM column classification as an additional signal on
top of the static LOW_VALUE_KPI word list.

Live bug this traces back to: an executive report's KPI grid summed/averaged
foreign-key columns (enrollment_id, student_id, ...) as if they were business
metrics. That specific symptom was already fixed via
is_identifier_like_kpi_column + rank_numeric_columns_for_kpi/_sql_kpi (see
test_report_kpi_domain_neutral.py) and _extract_kpi_values. But the actual
root cause was upstream: executive_report_planner_node._get_all_tables_info
classified every column into numerics/temporals/categoricals PURELY by SQL
type, with zero identifier awareness -- an INTEGER column named
"enrollment_id" landed straight in `numerics`. is_identifier_like_kpi_column
was only consulted much later, inside rank_numeric_columns_for_kpi, which is
KPI-section-specific. Every OTHER section type (timeseries, breakdown,
comparison, diagnostic) picked eff_numerics[0] directly with NO filtering
step at all -- an identifier column could become a timeseries/diagnostic
metric with zero defense.

This file tests the fix: _get_all_tables_info (via the new
_filter_identifier_numerics helper) now excludes identifier-shaped numeric
columns at the source, so every section type downstream inherits a clean
numerics list; and the new _llm_report_column_classification_signal wires in
a cached LLM verdict as an ADDITIONAL, authoritative override for enterprise
column-naming conventions (e.g. "TXN_REF") the static word list can never
anticipate -- mirroring the exact pattern already proven for
analytics_node.py's data_profiler.py wiring (see
test_analytics_node_llm_column_signal.py /
test_data_profiler_llm_column_classification.py).
"""

import pytest

from ee.modules.ai.nodes.executive_report_planner_node import (
    _filter_identifier_numerics,
    _get_all_tables_info,
    _llm_report_column_classification_signal,
    _resolve_fixed_sections,
)


# ── _filter_identifier_numerics ──────────────────────────────────────────

def test_filter_identifier_numerics_drops_only_the_identifier_shaped_columns():
    result = _filter_identifier_numerics(["enrollment_id", "revenue", "grade"])
    assert result == ["revenue", "grade"]


def test_filter_identifier_numerics_falls_back_when_everything_looks_like_an_id():
    """Graceful fallback for a pure junction/bridge table: if every numeric
    column looks like an identifier, keep the unfiltered list rather than
    leaving the table with zero usable numeric columns -- the same fallback
    pattern _sql_kpi already used before this fix, now shared at the source."""
    result = _filter_identifier_numerics(["user_id", "order_id"])
    assert result == ["user_id", "order_id"]


def test_filter_identifier_numerics_llm_signal_catches_word_list_blind_spot():
    """"txn_ref" matches nothing in LOW_VALUE_KPI (not even via the broad
    substring check) -- only a cached LLM verdict can catch it."""
    baseline = _filter_identifier_numerics(["txn_ref", "order_total"])
    assert baseline == ["txn_ref", "order_total"]  # heuristic alone misses it

    llm = {"txn_ref": {"classification": "identifier", "confidence": 0.88, "reasoning": "internal transaction id"}}
    result = _filter_identifier_numerics(["txn_ref", "order_total"], llm)
    assert result == ["order_total"]


# ── _get_all_tables_info: the actual root-cause fix site ────────────────

def test_get_all_tables_info_excludes_identifier_from_numerics_for_every_section_type():
    """Before the fix, `numerics` was purely type-based and enrollment_id
    (an INTEGER column) landed in it right alongside revenue -- with no
    identifier-awareness at this layer at all. Every section type reads
    `numerics` from here (not a KPI-specific list), so this single fix
    protects timeseries/breakdown/comparison/diagnostic/ranking too."""
    schema = {
        "tables": [
            {
                "name": "enrollments",
                "columns": [
                    {"name": "enrollment_id", "type": "INTEGER"},
                    {"name": "enrollment_date", "type": "DATE"},
                    {"name": "revenue", "type": "FLOAT"},
                ],
            }
        ]
    }
    tables_info = _get_all_tables_info(schema)
    assert len(tables_info) == 1
    assert tables_info[0]["numerics"] == ["revenue"]
    assert tables_info[0]["temporals"] == ["enrollment_date"]
    # The raw column listing (used for LLM prompt context / data_quality
    # sections) is untouched -- only the classified `numerics` pool is filtered.
    assert set(tables_info[0]["columns"]) == {"enrollment_id", "enrollment_date", "revenue"}


def test_get_all_tables_info_llm_signal_excludes_enterprise_named_identifier():
    schema = {
        "tables": [
            {
                "name": "orders",
                "columns": [
                    {"name": "txn_ref", "type": "BIGINT"},
                    {"name": "order_total", "type": "DECIMAL"},
                ],
            }
        ]
    }
    baseline = _get_all_tables_info(schema)
    assert set(baseline[0]["numerics"]) == {"txn_ref", "order_total"}  # heuristic alone can't tell

    llm = {"txn_ref": {"classification": "identifier", "confidence": 0.9, "reasoning": "internal transaction id"}}
    filtered = _get_all_tables_info(schema, llm_classifications=llm)
    assert filtered[0]["numerics"] == ["order_total"]


def test_get_all_tables_info_falls_back_when_a_tables_only_numeric_columns_are_ids():
    """A junction/bridge table with only FK columns must not be left with an
    empty numerics list -- same graceful fallback as _filter_identifier_numerics."""
    schema = {
        "tables": [
            {
                "name": "enrollment_roster",
                "columns": [
                    {"name": "student_id", "type": "INTEGER"},
                    {"name": "section_id", "type": "INTEGER"},
                ],
            }
        ]
    }
    tables_info = _get_all_tables_info(schema)
    assert tables_info[0]["numerics"] == ["student_id", "section_id"]


# ── End-to-end: a non-KPI section type never gets an identifier metric ──

def test_resolve_fixed_sections_timeseries_never_picks_an_identifier_metric():
    """The specific gap called out in the root-cause report: timeseries (and
    breakdown/comparison/diagnostic) sections use eff_numerics[0] directly.
    Before the fix, if "enrollment_id" sorted before "revenue" in the
    schema's column order, it would have become eff_numerics[0] and the
    "Trend Analysis" chart would have plotted a foreign key over time. Since
    _get_all_tables_info now filters at the source, this can no longer
    happen for ANY fixed section type, proven here end-to-end through
    _resolve_fixed_sections."""
    schema = {
        "tables": [
            {
                "name": "enrollments",
                "columns": [
                    {"name": "enrollment_id", "type": "INTEGER"},
                    {"name": "enrollment_date", "type": "DATE"},
                    {"name": "revenue", "type": "FLOAT"},
                ],
            }
        ]
    }
    tables_info = _get_all_tables_info(schema)
    classified = {
        "numeric": tables_info[0]["numerics"],
        "temporal": tables_info[0]["temporals"],
        "categorical": tables_info[0]["categoricals"],
        "other": [],
    }
    tier_config = {
        "fixed_sections": [
            {"id": "trend", "type": "timeseries", "title": "Trend Analysis", "required": True, "order": 1},
        ],
    }
    sections = _resolve_fixed_sections(
        tier_config, classified, "enrollments", "duckdb",
        tables_info[0]["columns"], tables_info=tables_info,
    )
    assert len(sections) == 1
    sql = sections[0]["sql"]
    assert sql is not None
    assert "enrollment_id" not in sql
    assert "revenue" in sql


# ── _llm_report_column_classification_signal: fail-open cache chokepoint ──

@pytest.mark.asyncio
async def test_llm_report_signal_returns_none_without_data_source_id():
    assert await _llm_report_column_classification_signal(None, {"tables": []}) is None


@pytest.mark.asyncio
async def test_llm_report_signal_returns_none_without_schema():
    assert await _llm_report_column_classification_signal("ds-1", None) is None
    assert await _llm_report_column_classification_signal("ds-1", {}) is None


@pytest.mark.asyncio
async def test_llm_report_signal_returns_none_when_schema_not_a_dict():
    assert await _llm_report_column_classification_signal("ds-1", "not-a-schema") is None


@pytest.mark.asyncio
async def test_llm_report_signal_fetches_cache_with_data_source_id_and_schema(monkeypatch):
    import ee.modules.ai.services.column_semantic_classifier as ccmod

    seen = {}

    async def fake_ensure_fresh(data_source_id, schema):
        seen["data_source_id"] = data_source_id
        seen["schema"] = schema
        return {"revenue": {"classification": "metric", "confidence": 0.9, "reasoning": "r"}}

    monkeypatch.setattr(ccmod, "ensure_column_classifications_fresh", fake_ensure_fresh)

    schema = {"tables": [{"name": "orders", "columns": [{"name": "revenue", "type": "NUMERIC"}]}]}
    result = await _llm_report_column_classification_signal("ds-1", schema)

    assert result == {"revenue": {"classification": "metric", "confidence": 0.9, "reasoning": "r"}}
    assert seen == {"data_source_id": "ds-1", "schema": schema}


@pytest.mark.asyncio
async def test_llm_report_signal_fails_open_to_none_when_cache_lookup_raises(monkeypatch):
    """A classification-cache problem (DB down, import error, ...) must never
    block or degrade report planning below the heuristic-only baseline."""
    import ee.modules.ai.services.column_semantic_classifier as ccmod

    async def raising_ensure_fresh(*a, **k):
        raise RuntimeError("cache backend unavailable")

    monkeypatch.setattr(ccmod, "ensure_column_classifications_fresh", raising_ensure_fresh)

    schema = {"tables": [{"name": "orders", "columns": [{"name": "revenue", "type": "NUMERIC"}]}]}
    result = await _llm_report_column_classification_signal("ds-1", schema)
    assert result is None
