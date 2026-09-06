"""Tests for the cached LLM column-classification signal wired into
data_profiler.py's _classify_columns (see ee/modules/ai/services/
column_semantic_classifier.py for the batched LLM call + cache that
produces this signal, and analytics_node.py for the caller that fetches it).

The user flagged twice that the heuristic-only classifier (real PK/FK schema
metadata + _ID_PATTERNS name matching + _looks_like_code_column's structural
guess) is a stand-in for the proper fix: an LLM that actually looks at each
column's name, type, and real sample values. This file proves the LLM signal
is wired in as an ADDITIONAL layer -- consulted only for columns the cheaper,
zero-latency signals couldn't already resolve, only trusted above a
confidence threshold, sanity-checked against the real dataframe values in
hand, and never required (llm_classifications=None reproduces today's exact
heuristic-only behavior, matching test_data_profiler_code_column_detection.py).
"""

import pandas as pd

from ee.modules.ai.utils.data_profiler import profile_dataframe


def test_llm_signal_rescues_metric_name_hint_false_negative():
    """_looks_like_code_column bails out early on any column whose NAME hints
    at a genuine metric (score/rating/amount/...), by design -- but that
    means a column that is actually a low-cardinality status/priority CODE
    happens to slip through untouched if its author named it with one of
    those words (e.g. "priority_score" meaning severity level 1-3, not a
    number to average). This is exactly the gap the LLM signal exists to
    close: it has the real sample values and isn't fooled by the name alone.
    """
    df = pd.DataFrame(
        {
            "priority_score": [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3],
            "revenue": [100.0 + i for i in range(15)],
        }
    )

    # Baseline: without the LLM signal, the metric-name hint bypasses the
    # structural code-column check entirely -- misclassified as a metric.
    baseline = profile_dataframe(df)
    assert "priority_score" in baseline.metric_columns

    llm = {
        "priority_score": {
            "classification": "dimension",
            "confidence": 0.92,
            "reasoning": "low-cardinality priority code, not an aggregatable value",
        }
    }
    profile = profile_dataframe(df, llm_classifications=llm)
    assert "priority_score" in profile.dimension_columns
    assert "priority_score" not in profile.metric_columns
    assert "revenue" in profile.metric_columns


def test_llm_signal_rescues_high_cardinality_numeric_dimension():
    """_looks_like_code_column only fires on LOW cardinality (<=20 distinct
    values) -- a high-cardinality numeric column with no metric-hint name and
    no _id/_key/_code suffix (e.g. postal codes stored as integers) sails
    straight into metric_columns today. The LLM, given real sample values,
    can recognize this isn't summable even though the structural signal
    alone can't."""
    df = pd.DataFrame(
        {
            "postal_number": list(range(10001, 10026)),  # 25 unique -- above the code-column cutoff
            "revenue": [10.5 * i for i in range(1, 26)],
        }
    )
    baseline = profile_dataframe(df)
    assert "postal_number" in baseline.metric_columns  # heuristic alone gets this wrong

    llm = {
        "postal_number": {
            "classification": "dimension",
            "confidence": 0.85,
            "reasoning": "postal/zip code values, not a quantity to aggregate",
        }
    }
    profile = profile_dataframe(df, llm_classifications=llm)
    assert "postal_number" in profile.dimension_columns
    assert "postal_number" not in profile.metric_columns


def test_llm_identifier_verdict_excludes_unconventionally_named_surrogate_key():
    """A surrogate key with neither a recognizable name (_id/_key/_code) nor
    real PK/FK schema metadata, and high enough cardinality that it isn't
    even in dimension range -- excluded entirely once the LLM says so, same
    as a real PK/FK column with that many distinct values would be."""
    df = pd.DataFrame(
        {
            "recno": list(range(1, 61)),  # 60 unique values -- above the dimension cutoff too
            "amount": [10.5 * i for i in range(1, 61)],
        }
    )
    baseline = profile_dataframe(df)
    assert "recno" in baseline.metric_columns  # unconventional name -- heuristic can't tell it's a key

    llm = {
        "recno": {
            "classification": "identifier",
            "confidence": 0.95,
            "reasoning": "sequential internal record number, not a business value",
        }
    }
    profile = profile_dataframe(df, llm_classifications=llm)
    assert "recno" not in profile.metric_columns
    assert "recno" not in profile.dimension_columns  # high-cardinality identifier -- skipped entirely
    assert "amount" in profile.metric_columns


def test_low_confidence_llm_verdict_is_ignored():
    """An LLM verdict below LLM_CONFIDENCE_THRESHOLD must not override the
    heuristic -- an LLM that itself isn't sure shouldn't silently outrank a
    decent structural signal."""
    df = pd.DataFrame(
        {
            "priority_score": [1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3, 1, 2, 3],
            "revenue": [100.0 + i for i in range(15)],
        }
    )
    llm = {
        "priority_score": {
            "classification": "dimension",
            "confidence": 0.3,  # below threshold
            "reasoning": "not sure",
        }
    }
    profile = profile_dataframe(df, llm_classifications=llm)
    assert "priority_score" in profile.metric_columns  # heuristic wins


def test_schema_pk_fk_metadata_beats_conflicting_llm_verdict():
    """Real schema PK/FK metadata is ground truth from the database itself --
    it must win even over a confident, conflicting LLM verdict."""
    df = pd.DataFrame(
        {
            "amount": list(range(1, 21)),
            "revenue": [10.5 * i for i in range(1, 21)],
        }
    )
    schema = {
        "tables": [
            {
                "name": "orders",
                "columns": [
                    {"name": "amount", "is_primary_key": True},
                    {"name": "revenue"},
                ],
            }
        ]
    }
    llm = {"amount": {"classification": "metric", "confidence": 0.99, "reasoning": "looks numeric"}}
    profile = profile_dataframe(df, schema=schema, llm_classifications=llm)
    assert "amount" not in profile.metric_columns
    assert "revenue" in profile.metric_columns


def test_id_pattern_name_match_beats_conflicting_llm_verdict():
    """Deliberate scope choice: an _ID_PATTERNS name match is treated as part
    of the same zero-cost, zero-latency signal tier as real PK/FK metadata
    (both were already the identifier-detection path before the LLM signal
    was added) and is checked before the LLM cache -- so a confident but
    wrong LLM verdict can't override an unambiguous *_id/*_key/*_code name.
    The LLM signal exists to cover what that tier can't reach (see the
    postal_number / priority_score / recno tests above), not to second-guess
    an already-unambiguous name."""
    df = pd.DataFrame(
        {
            "status_id": [1, 2, 3, 4, 1, 2, 3, 4, 1, 2],
            "revenue": [100.0, 200.0, 150.0, 300.0, 120.0, 220.0, 160.0, 310.0, 140.0, 230.0],
        }
    )
    llm = {"status_id": {"classification": "metric", "confidence": 0.99, "reasoning": "wrong"}}
    profile = profile_dataframe(df, llm_classifications=llm)
    assert "status_id" not in profile.metric_columns
    assert "revenue" in profile.metric_columns


def test_llm_timestamp_verdict_ignored_when_content_does_not_parse_as_dates():
    """A "timestamp" verdict is only trusted when _is_temporal_column
    independently confirms the column's real values parse as dates --
    otherwise a wrong LLM guess could corrupt every downstream time-series
    calculation (trend/seasonality/forecast model selection all key off
    profile.time_column)."""
    df = pd.DataFrame(
        {
            "fiscal_period": [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4],
            "revenue": [100.0 + i for i in range(12)],
        }
    )
    llm = {"fiscal_period": {"classification": "timestamp", "confidence": 0.9, "reasoning": "wrong guess"}}
    profile = profile_dataframe(df, llm_classifications=llm)
    assert profile.time_column != "fiscal_period"
    # Falls through to the structural heuristic: low-cardinality whole
    # numbers, no metric-name hint -> code column -> dimension.
    assert "fiscal_period" in profile.dimension_columns


def test_llm_metric_verdict_ignored_when_column_is_not_actually_numeric():
    """A "metric" verdict is only trusted when the column is actually numeric
    in THIS result set -- guards against a stale/mismatched cache entry
    (e.g. from a schema where this name meant something else) from forcing a
    text column into metric_columns, where downstream code expects numbers."""
    df = pd.DataFrame(
        {
            "region": ["east", "west", "north", "south", "east", "west"],
            "revenue": [1.0, 2.0, 3.0, 4.0, 5.0, 6.0],
        }
    )
    llm = {"region": {"classification": "metric", "confidence": 0.9, "reasoning": "wrong"}}
    profile = profile_dataframe(df, llm_classifications=llm)
    assert "region" not in profile.metric_columns
    assert "region" in profile.dimension_columns


def test_llm_classification_lookup_is_case_insensitive():
    """Cached classifications are keyed by lowercased column name (see
    get_cached_column_classifications) since a query result's column casing
    can vary from the schema's declared casing."""
    df = pd.DataFrame(
        {
            "PostalNumber": list(range(10001, 10026)),
            "Revenue": [10.5 * i for i in range(1, 26)],
        }
    )
    llm = {"postalnumber": {"classification": "dimension", "confidence": 0.85, "reasoning": "zip code"}}
    profile = profile_dataframe(df, llm_classifications=llm)
    assert "PostalNumber" in profile.dimension_columns
    assert "PostalNumber" not in profile.metric_columns


def test_llm_classifications_none_matches_default_behavior():
    """llm_classifications=None (explicit) must be identical to omitting the
    argument entirely -- every pre-existing caller of profile_dataframe
    (catalog data-quality, predictive_models, the requirements gate) doesn't
    pass this argument at all."""
    df = pd.DataFrame(
        {
            "status_id": [1, 2, 3, 4, 1, 2, 3, 4, 1, 2],
            "revenue": [100.0, 200.0, 150.0, 300.0, 120.0, 220.0, 160.0, 310.0, 140.0, 230.0],
        }
    )
    profile_default = profile_dataframe(df)
    profile_explicit_none = profile_dataframe(df, llm_classifications=None)
    assert profile_default.metric_columns == profile_explicit_none.metric_columns
    assert profile_default.dimension_columns == profile_explicit_none.dimension_columns
    assert profile_default.time_column == profile_explicit_none.time_column
