"""
Stress test for all architectural GAP fixes in guaranteed_chart_builder.py.

Tests cover:
  GAP-H1: Gauge requires row_count==1
  GAP-H2: Pie rejects negative metric values
  GAP-H3: Cardinality uses full data, not sample
  GAP-H4: Temporal sort uses real date parsing
  GAP-M1: horizontal_bar respects intent top_n
  GAP-M2: Grouped chart falls back when group has 1 unique value
  GAP-M3: Gauge builder guards against multi-row data
  GAP-L3: Downsample sorts by metric DESC for ranking/bar
"""

import sys
import os
import importlib
import importlib.util

# ---------------------------------------------------------------------------
# Direct-import the two utility modules without triggering the full
# app.modules.ai package (which pulls in httpx and other heavy deps).
# ---------------------------------------------------------------------------
_UTILS_DIR = os.path.join(
    os.path.dirname(__file__), os.pardir, os.pardir, os.pardir,
    "modules", "ai", "utils"
)
_UTILS_DIR = os.path.normpath(_UTILS_DIR)


def _load_module(name: str, path: str):
    spec = importlib.util.spec_from_file_location(name, path)
    mod = importlib.util.module_from_spec(spec)
    sys.modules[name] = mod
    spec.loader.exec_module(mod)
    return mod


_gcb = _load_module(
    "guaranteed_chart_builder",
    os.path.join(_UTILS_DIR, "guaranteed_chart_builder.py"),
)

GuaranteedChartBuilder = _gcb.GuaranteedChartBuilder
ChartTypeSelector = _gcb.ChartTypeSelector
analyze_columns = _gcb.analyze_columns

# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------
_pass = 0
_fail = 0


def _check(name: str, condition: bool, msg: str = ""):
    global _pass, _fail
    if condition:
        _pass += 1
        print(f"  ✅ {name}")
    else:
        _fail += 1
        print(f"  ❌ {name}: {msg}")


# ===================================================================
# GAP-H1: Gauge requires row_count == 1
# ===================================================================
def test_gap_h1_gauge_only_single_row():
    print("\n── GAP-H1: Gauge requires row_count==1 ──")

    # 1 row KPI → should be gauge
    data_1 = [{"total_revenue": 125000}]
    intent_kpi = {"is_kpi": True}
    col_analysis = analyze_columns(data_1)
    ct, *_ = ChartTypeSelector.select_chart_type(col_analysis, 1, "what is total revenue", intent=intent_kpi)
    _check("1-row KPI → gauge", ct == "gauge", f"got {ct}")

    # 3-row KPI → should NOT be gauge (use bar for comparability)
    data_3 = [
        {"total_revenue": 125000},
        {"total_revenue": 200000},
        {"total_revenue": 350000},
    ]
    col_analysis_3 = analyze_columns(data_3)
    ct3, *_ = ChartTypeSelector.select_chart_type(col_analysis_3, 3, "what is total revenue", intent=intent_kpi)
    _check("3-row KPI → NOT gauge", ct3 != "gauge", f"got {ct3}")


# ===================================================================
# GAP-H2: Pie selection rejects negative metric values
# ===================================================================
def test_gap_h2_pie_no_negatives():
    print("\n── GAP-H2: Pie rejects negative metrics ──")

    data = [
        {"region": "North", "profit": 500},
        {"region": "South", "profit": -200},
        {"region": "East", "profit": 300},
    ]
    intent = {"is_decomposition": True}
    col_analysis = analyze_columns(data)
    ct, *_ = ChartTypeSelector.select_chart_type(col_analysis, 3, "profit breakdown by region", intent=intent)
    _check("Negative metric → NOT pie", ct != "pie", f"got {ct}")

    # All positive → should be pie
    data_pos = [
        {"region": "North", "profit": 500},
        {"region": "South", "profit": 200},
        {"region": "East", "profit": 300},
    ]
    intent_pos = {"is_decomposition": True}
    col_analysis_pos = analyze_columns(data_pos)
    ct_pos, *_ = ChartTypeSelector.select_chart_type(col_analysis_pos, 3, "profit share by region", intent=intent_pos)
    _check("All positive decomposition → pie", ct_pos == "pie", f"got {ct_pos}")


# ===================================================================
# GAP-H3: Cardinality uses full data
# ===================================================================
def test_gap_h3_full_cardinality():
    print("\n── GAP-H3: Cardinality uses full data ──")

    # Create 50-row data where first 20 rows have only 5 unique categories
    # but all 50 rows have 40 unique categories → should NOT be pie
    data = []
    for i in range(50):
        data.append({"product": f"Product_{i % 40}", "sales": 100 + i * 10})

    col_analysis = analyze_columns(data)
    unique_count = col_analysis["product"]["metadata"].get("unique_count", 0)
    _check(
        "Full-data unique count (expect 40, not ≤20 from sample)",
        unique_count == 40,
        f"got unique_count={unique_count}"
    )


# ===================================================================
# GAP-H4: Temporal sort uses real date parsing
# ===================================================================
def test_gap_h4_temporal_date_sort():
    print("\n── GAP-H4: Temporal sort uses real date parsing ──")

    # Months in non-alphabetical order: Feb 2025, Jan 2025, Mar 2025
    data = [
        {"month": "Feb 2025", "sales": 200},
        {"month": "Jan 2025", "sales": 150},
        {"month": "Mar 2025", "sales": 300},
    ]
    chart = GuaranteedChartBuilder.build_chart(data, "monthly sales trend")
    x_data = chart.get("xAxis", {}).get("data", [])
    # Should be chronological: Jan, Feb, Mar (not alphabetical: Feb, Jan, Mar)
    _check(
        "Temporal sort → Jan before Feb before Mar",
        x_data == ["Jan 2025", "Feb 2025", "Mar 2025"] if x_data else False,
        f"got x_data={x_data}"
    )


# ===================================================================
# GAP-M1: horizontal_bar respects intent top_n
# ===================================================================
def test_gap_m1_horizontal_bar_top_n():
    print("\n── GAP-M1: horizontal_bar respects intent top_n ──")

    data = [{"product": f"Product {chr(65+i)}", "revenue": (10 - i) * 1000} for i in range(10)]
    intent = {"is_ranking": True, "top_n": 5}

    chart = GuaranteedChartBuilder.build_chart(data, "top 5 products by revenue", intent=intent)

    # Horizontal bar: categories are on yAxis
    categories = chart.get("yAxis", {}).get("data", [])
    if not categories:
        # Might be a regular bar; check xAxis
        categories = chart.get("xAxis", {}).get("data", [])

    _check(
        "top_n=5 → exactly 5 bars",
        len(categories) == 5,
        f"got {len(categories)} categories: {categories}"
    )


# ===================================================================
# GAP-M2: Grouped chart with 1 group → falls back to simple chart
# ===================================================================
def test_gap_m2_single_group_fallback():
    print("\n── GAP-M2: Single group fallback ──")

    # Data that looks grouped but has only 1 unique group value
    data = [
        {"month": "2025-01", "category": "Electronics", "revenue": 100},
        {"month": "2025-02", "category": "Electronics", "revenue": 150},
        {"month": "2025-03", "category": "Electronics", "revenue": 200},
    ]

    # Force grouped_line
    chart = GuaranteedChartBuilder.build_chart(
        data, "revenue monthly by category", chart_type="grouped_line"
    )

    # Should degrade to simple line (no legend with multiple entries)
    series = chart.get("series", [])
    _check(
        "Single group → falls back to simple chart (1 series)",
        len(series) == 1,
        f"got {len(series)} series"
    )

    # Force grouped_bar
    chart_bar = GuaranteedChartBuilder.build_chart(
        data, "revenue by month and category", chart_type="grouped_bar"
    )
    series_bar = chart_bar.get("series", [])
    _check(
        "Single group bar → falls back to simple bar (1 series)",
        len(series_bar) == 1,
        f"got {len(series_bar)} series"
    )


# ===================================================================
# GAP-M3: Gauge builder guards against multi-row data
# ===================================================================
def test_gap_m3_gauge_multi_row_guard():
    print("\n── GAP-M3: Gauge builder multi-row guard ──")

    data = [
        {"metric_name": "Revenue", "value": 50000},
        {"metric_name": "Profit", "value": 12000},
    ]

    # Force gauge chart type on multi-row data
    chart = GuaranteedChartBuilder.build_chart(data, "key metrics", chart_type="gauge")

    # Should NOT be a gauge (should fall back to bar)
    series_type = chart.get("series", [{}])[0].get("type", "")
    _check(
        "2-row gauge → falls back to bar",
        series_type == "bar",
        f"got series type={series_type}"
    )


# ===================================================================
# GAP-L3: Downsample sorts by metric DESC for ranking
# ===================================================================
def test_gap_l3_ranking_downsample():
    print("\n── GAP-L3: Ranking downsample sorts by metric ──")

    max_rows = GuaranteedChartBuilder.MAX_CHART_ROWS
    total_rows = max_rows + 200  # Guarantee we exceed MAX_CHART_ROWS

    # Create rows where later rows have HIGHER values
    # If downsample just takes first N, we'd miss the highest values
    data = [{"product": f"P{i:04d}", "revenue": i * 100} for i in range(total_rows)]
    # Row 0 = 0, last row = (total_rows-1)*100

    downsampled = GuaranteedChartBuilder._downsample_for_chart(data, "horizontal_bar", y_col="revenue")

    _check(
        f"Downsampled to ≤{max_rows} rows",
        len(downsampled) <= max_rows,
        f"got {len(downsampled)}"
    )

    # The highest-value row should be in the downsampled set
    expected_max = (total_rows - 1) * 100
    max_val_in_sample = max(r["revenue"] for r in downsampled)
    _check(
        f"Highest value ({expected_max}) preserved in downsample",
        max_val_in_sample == expected_max,
        f"got max={max_val_in_sample}"
    )

    # Lowest values (0, 100, ...) should be dropped since we sort DESC
    min_val_in_sample = min(r["revenue"] for r in downsampled)
    _check(
        "Lowest values dropped (min in sample > 0)",
        min_val_in_sample > 0,
        f"got min={min_val_in_sample}"
    )


# ===================================================================
# Additional: Integration test — churn rate with complex SQL metrics
# ===================================================================
def test_integration_churn_rate():
    print("\n── Integration: Churn rate complex metric ──")

    data = [
        {"customer_segment": "Enterprise", "acquisition_channel": "Direct", "total_customers": 50, "churned_customers": 10, "churn_rate_percent": 20.0},
        {"customer_segment": "Enterprise", "acquisition_channel": None, "total_customers": 30, "churned_customers": 5, "churn_rate_percent": 16.67},
        {"customer_segment": "SMB", "acquisition_channel": "Online", "total_customers": 100, "churned_customers": 35, "churn_rate_percent": 35.0},
        {"customer_segment": "SMB", "acquisition_channel": "Partner", "total_customers": 80, "churned_customers": 20, "churn_rate_percent": 25.0},
    ]

    chart = GuaranteedChartBuilder.build_chart(
        data,
        "How does churn rate vary by customer segment and acquisition channel?",
        intent={
            "is_comparison": False,
            "is_ranking": False,
            "primary_metric_hint": "churn rate",
        }
    )

    # Should produce a non-empty chart
    series = chart.get("series", [])
    _check("Churn chart has series", len(series) > 0, f"got {len(series)} series")

    # Check that NULL acquisition_channel is rendered as a readable label, not "None"
    # It could appear in xAxis, yAxis, or legend
    all_labels = []
    x_axis = chart.get("xAxis", {})
    y_axis = chart.get("yAxis", {})
    if isinstance(x_axis, dict):
        all_labels.extend(x_axis.get("data", []))
    if isinstance(y_axis, dict):
        all_labels.extend(y_axis.get("data", []))
    legend = chart.get("legend", {})
    if isinstance(legend, dict):
        all_labels.extend(legend.get("data", []))

    has_raw_none = any(lbl in ("None", "null", "none") for lbl in all_labels)
    _check(
        "No raw 'None' in chart labels",
        not has_raw_none,
        f"found raw None in labels: {all_labels}"
    )


# ===================================================================
# Additional: Top N with many categories
# ===================================================================
def test_top_n_large_dataset():
    print("\n── Additional: Top N from large dataset ──")

    data = [{"city": f"City_{i}", "population": 1000000 - i * 5000} for i in range(200)]

    intent = {"is_ranking": True, "top_n": 10}
    chart = GuaranteedChartBuilder.build_chart(data, "top 10 cities by population", intent=intent)

    # Should show exactly 10 bars
    y_data = chart.get("yAxis", {}).get("data", [])
    x_data = chart.get("xAxis", {}).get("data", [])
    categories = y_data if y_data and chart.get("yAxis", {}).get("type") == "category" else x_data

    _check(
        "200 rows + top_n=10 → 10 bars",
        len(categories) == 10,
        f"got {len(categories)}"
    )


# ===================================================================
# Additional: Pie with too many categories → bar fallback
# ===================================================================
def test_pie_too_many_categories():
    print("\n── Additional: Pie with >12 categories → bar ──")

    data = [{"department": f"Dept_{i}", "budget": 10000 + i * 500} for i in range(25)]
    intent = {"is_decomposition": True}
    col_analysis = analyze_columns(data)
    ct, *_ = ChartTypeSelector.select_chart_type(col_analysis, 25, "budget breakdown by department", intent=intent)
    _check("25 categories → NOT pie", ct != "pie", f"got {ct}")


# ===================================================================
# Run all tests
# ===================================================================
if __name__ == "__main__":
    print("=" * 60)
    print("  GAP FIX STRESS TEST")
    print("=" * 60)

    test_gap_h1_gauge_only_single_row()
    test_gap_h2_pie_no_negatives()
    test_gap_h3_full_cardinality()
    test_gap_h4_temporal_date_sort()
    test_gap_m1_horizontal_bar_top_n()
    test_gap_m2_single_group_fallback()
    test_gap_m3_gauge_multi_row_guard()
    test_gap_l3_ranking_downsample()
    test_integration_churn_rate()
    test_top_n_large_dataset()
    test_pie_too_many_categories()

    print("\n" + "=" * 60)
    total = _pass + _fail
    print(f"  RESULTS: {_pass}/{total} passed, {_fail} failed")
    print("=" * 60)

    if _fail > 0:
        sys.exit(1)
    else:
        print("\n  🎉 ALL TESTS PASSED!")
        sys.exit(0)
