"""Regression test: _run_diagnostic's target_metric fallback used to scan
df.columns for ANY numeric-dtype column with zero ID/surrogate-key filtering
-- live-reproduced this session (see screenshot in conversation): a query
whose result led with a `status_id` column (values 1-4) got status_id
resolved as the diagnostic/prescriptive target metric purely because it was
numeric and happened to come first, producing sensitivity analysis and
What-If Simulator scenarios like "increase status_id by 15%" that mean
nothing to a user -- while the actual real metric (e.g. total_enrolled) sat
right next to it, correctly classified as a real metric by
data_profiler.py's DataProfile but never consulted by this fallback.

Root cause: the upstream-resolved target_metric (from schema/query-based
delegation) can legitimately not match the actual SQL result's column name
(aliasing, casing, computed columns) -- DataProfile.metric_columns is
already correctly ID-filtered (data_profiler.py's _ID_PATTERNS routes
id/_id/_key/_code columns to dimension_columns instead), so the fallback
should prefer it over a raw, unfiltered dtype scan.
"""

import pandas as pd

from ee.modules.ai.nodes.analytics_node import _run_diagnostic
from ee.modules.ai.utils.data_profiler import DataProfile


def _make_df():
    # status_id (numeric, ID-like) intentionally listed FIRST, matching the
    # real bug: SQL results often lead with the row's identifying column.
    return pd.DataFrame(
        {
            "status_id": [1, 2, 3, 4, 1, 2, 3, 4, 1, 2],
            "average_score": [83.4, 89.7, 83.6, 90.3, 84.1, 88.2, 81.9, 86.5, 82.0, 87.3],
            "total_enrolled": [4, 4, 4, 4, 5, 3, 6, 4, 5, 4],
        }
    )


def _make_profile():
    # Mirrors what data_profiler.profile_dataframe would actually produce for
    # the df above: status_id correctly excluded from metric_columns.
    return DataProfile(
        n_rows=10,
        n_columns=3,
        metric_columns=["average_score", "total_enrolled"],
        dimension_columns=["status_id"],
    )


def test_diagnostic_prefers_profiled_metric_over_id_column_when_target_missing():
    df = _make_df()
    profile = _make_profile()

    # Simulates the real-world mismatch: upstream resolved a target_metric
    # name that doesn't match this df's actual column name (aliasing/casing).
    result = _run_diagnostic(df, profile, target_metric="enrollment_status")

    resolved = result.to_dict() if hasattr(result, "to_dict") else result
    baseline_metric = (resolved.get("metric_decomposition") or {}).get("root_metric") if isinstance(resolved, dict) else None
    assert baseline_metric in ("average_score", "total_enrolled")
    assert baseline_metric != "status_id"


def test_diagnostic_still_falls_back_to_raw_scan_when_profile_has_no_metrics():
    """If DataProfile genuinely found no real metric (e.g. profiling itself
    failed upstream), the raw dtype scan must still be usable as a last
    resort rather than erroring out entirely."""
    df = _make_df()
    empty_profile = DataProfile(n_rows=10, n_columns=3, metric_columns=[], dimension_columns=[])

    result = _run_diagnostic(df, empty_profile, target_metric="enrollment_status")

    resolved = result.to_dict() if hasattr(result, "to_dict") else result
    assert isinstance(resolved, dict) and not resolved.get("error")
    # No profiled metrics available -- falls back to raw numeric scan, which
    # legitimately may land on status_id here. Which sub-analysis actually
    # populates (metric_decomposition vs. causal_analysis) depends on data
    # shape; this test only guards that the fallback chain resolves *a*
    # target metric and produces a real result rather than erroring, using
    # whichever field the engine happened to fill in.
    resolved_metric = (
        (resolved.get("metric_decomposition") or {}).get("root_metric")
        or (resolved.get("causal_analysis") or {}).get("outcome")
    )
    assert resolved_metric in ("status_id", "average_score", "total_enrolled")
