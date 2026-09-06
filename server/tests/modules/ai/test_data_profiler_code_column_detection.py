"""Regression test: DataProfile's column classifier only caught surrogate-key/
status-code columns whose NAME matched _ID_PATTERNS (id/_id/_key/_code/pk).
An enterprise data source whose equivalent column is named anything else
(StatusCode with no underscore, "grp", "stat_no", ...) sailed straight into
metric_columns -- live-reproduced this session as a "status_id" column
(caught by name) ending up as the target metric for a What-If Simulator;
the same shape of column under a different name would NOT have been caught
before this fix.

_looks_like_code_column adds a name-independent structural signal: low
cardinality relative to row count + whole-number values + no genuine-metric
name hint (rating/score/amount/...). Deliberately conservative -- verified
here to not misclassify genuine low-cardinality metrics (a 1-5 rating, an
NPS score) as dimensions.

Note: tests/modules/ai/test_data_profiler.py (pre-existing) imports from the
wrong module path (src.modules.ai.utils.data_profiler instead of
ee.modules...) and fails collection in this environment independent of this
change -- this file uses the correct ee.modules import path.
"""

import pandas as pd

from ee.modules.ai.utils.data_profiler import profile_dataframe


def test_unconventionally_named_status_code_excluded_from_metrics():
    """The exact bug scenario, but with a column name _ID_PATTERNS would
    NOT catch -- this is what the old name-only check missed."""
    df = pd.DataFrame(
        {
            "StatusCode": [1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3, 4, 1, 2, 3],
            "average_score": [83.4, 89.7, 83.6, 90.3, 84.1, 88.2, 81.9, 86.5, 82.0, 87.3, 85.1, 84.4, 83.9, 88.8, 86.2],
        }
    )
    profile = profile_dataframe(df)
    assert "StatusCode" not in profile.metric_columns
    assert "StatusCode" in profile.dimension_columns
    assert "average_score" in profile.metric_columns


def test_conventionally_named_id_still_excluded():
    """Existing name-based path still works (no regression)."""
    df = pd.DataFrame(
        {
            "status_id": [1, 2, 3, 4, 1, 2, 3, 4, 1, 2],
            "revenue": [100.0, 200.0, 150.0, 300.0, 120.0, 220.0, 160.0, 310.0, 140.0, 230.0],
        }
    )
    profile = profile_dataframe(df)
    assert "status_id" not in profile.metric_columns
    assert "revenue" in profile.metric_columns


def test_genuine_low_cardinality_rating_metric_not_misclassified():
    """A real 1-5 satisfaction rating must stay a metric -- same shape
    (low cardinality, small integers, lots of repeats) as a status code,
    differentiated here only by name. Documents the known limit: an
    unusually-named genuine metric could still be misclassified, which is
    the honest tradeoff of a purely structural/name signal without real
    schema PK/FK metadata or an LLM/semantic-layer classification."""
    df = pd.DataFrame(
        {
            "satisfaction_rating": [5, 4, 3, 5, 4, 5, 2, 4, 5, 3, 4, 5, 4, 3, 5],
            "customer_id": list(range(1, 16)),
        }
    )
    profile = profile_dataframe(df)
    assert "satisfaction_rating" in profile.metric_columns
    assert "customer_id" not in profile.metric_columns


def test_high_cardinality_numeric_id_still_classified_by_name_or_left_as_metric():
    """A high-cardinality surrogate key (e.g. a real primary key with a
    unique value per row) is NOT what _looks_like_code_column targets (it
    only fires on LOW cardinality) -- but a conventionally-named one is
    still caught by the existing name-based path, unaffected by this change."""
    df = pd.DataFrame(
        {
            "order_id": list(range(1, 21)),
            "amount": [10.5 * i for i in range(1, 21)],
        }
    )
    profile = profile_dataframe(df)
    assert "order_id" not in profile.metric_columns
    assert "amount" in profile.metric_columns


def test_continuous_low_sample_metric_not_misclassified_as_code():
    """Few rows with an incidentally-small distinct-value count (e.g. a
    rounded percentage across only 6 rows) must not trip the repetition-
    density guard and get misclassified as a code."""
    df = pd.DataFrame(
        {
            "conversion_rate": [12.0, 15.0, 18.0, 20.0, 22.0, 25.0],
            "region": ["east", "west", "north", "south", "east", "west"],
        }
    )
    profile = profile_dataframe(df)
    assert "conversion_rate" in profile.metric_columns


def test_schema_pk_fk_metadata_is_authoritative_even_with_metric_like_name():
    """Real schema PK/FK metadata beats both the name pattern and the
    structural heuristic -- even a column whose NAME would normally read as
    a genuine metric (high cardinality, no code-like repetition) must be
    excluded when the actual database says it's a key. This is the
    "enterprise doesn't use _id/_key naming at all" case done properly: no
    guessing, the database already knows."""
    df = pd.DataFrame(
        {
            "amount": list(range(1, 21)),  # high-cardinality, unique per row -- looks exactly like a real metric
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
    profile = profile_dataframe(df, schema=schema)
    assert "amount" not in profile.metric_columns
    assert "revenue" in profile.metric_columns


def test_no_schema_falls_back_to_heuristics_unchanged():
    """schema=None (the default -- every pre-existing caller) must behave
    exactly as before this change."""
    df = pd.DataFrame(
        {
            "status_id": [1, 2, 3, 4, 1, 2, 3, 4, 1, 2],
            "revenue": [100.0, 200.0, 150.0, 300.0, 120.0, 220.0, 160.0, 310.0, 140.0, 230.0],
        }
    )
    profile = profile_dataframe(df)
    assert "status_id" not in profile.metric_columns
    assert "revenue" in profile.metric_columns
