"""Tests for the statistical signal computation layer: outlier detection,
trend significance, and concentration ratio over real query-result rows.

This is new capability, not a bug fix — the platform previously had no
statistical rigor behind "why this metric matters" (dashboard/report insight
narration relied entirely on LLM judgment eyeballing a handful of sample
rows). These functions give real, computed numbers to cite instead, matching
the compute-then-narrate discipline of Power BI Quick Insights/ThoughtSpot
SpotIQ. Domain-agnostic throughout: tests intentionally span unrelated
schemas (retail, healthcare, manufacturing) to prove no hidden vocabulary
dependency.
"""

from ee.modules.ai.services.insight_statistics import (
    compute_concentration,
    compute_outliers,
    compute_section_signals,
    compute_trend_significance,
    format_signals_for_prompt,
    infer_fields,
    notability_score,
)


class TestInferFields:
    def test_identifies_metric_label_and_time(self):
        rows = [{"month": "2026-01", "region": "West", "revenue": 100.0}]
        fields = infer_fields(rows)
        assert fields["time_field"] == "month"
        assert fields["metric_field"] == "revenue"
        assert fields["label_field"] == "region"

    def test_empty_rows_returns_all_none(self):
        assert infer_fields([]) == {"metric_field": None, "label_field": None, "time_field": None}

    def test_works_without_a_time_column(self):
        rows = [{"carrier": "Acme Air", "delay_minutes": 12.5}]
        fields = infer_fields(rows)
        assert fields["time_field"] is None
        assert fields["metric_field"] == "delay_minutes"
        assert fields["label_field"] == "carrier"


class TestComputeOutliers:
    def test_flags_a_genuine_outlier(self):
        rows = [
            {"carrier": "A", "delay_minutes": 5},
            {"carrier": "B", "delay_minutes": 6},
            {"carrier": "C", "delay_minutes": 4},
            {"carrier": "D", "delay_minutes": 95},
        ]
        outliers = compute_outliers(rows, "delay_minutes", label_field="carrier")
        assert len(outliers) == 1
        assert outliers[0]["label"] == "D"
        assert outliers[0]["direction"] == "above"

    def test_no_outliers_in_a_flat_distribution(self):
        rows = [{"x": "a", "v": 10}, {"x": "b", "v": 11}, {"x": "c", "v": 9}, {"x": "d", "v": 10}]
        assert compute_outliers(rows, "v", label_field="x") == []

    def test_too_few_points_returns_empty_not_a_guess(self):
        rows = [{"x": "a", "v": 10}, {"x": "b", "v": 1000}]
        assert compute_outliers(rows, "v") == []

    def test_zero_variance_returns_empty(self):
        rows = [{"v": 5}, {"v": 5}, {"v": 5}]
        assert compute_outliers(rows, "v") == []


class TestComputeTrendSignificance:
    def test_strong_upward_trend_high_confidence(self):
        rows = [
            {"month": "2026-01", "patients": 100},
            {"month": "2026-02", "patients": 120},
            {"month": "2026-03", "patients": 140},
            {"month": "2026-04", "patients": 160},
        ]
        trend = compute_trend_significance(rows, "month", "patients")
        assert trend["direction"] == "up"
        assert trend["confidence"] == "high"
        assert trend["r_squared"] > 0.9
        assert trend["pct_change_start_to_end"] == 60.0

    def test_noisy_data_low_confidence(self):
        rows = [
            {"month": "2026-01", "v": 100},
            {"month": "2026-02", "v": 5},
            {"month": "2026-03", "v": 200},
            {"month": "2026-04", "v": 2},
        ]
        trend = compute_trend_significance(rows, "month", "v")
        assert trend["confidence"] in ("low", "medium")

    def test_too_few_points_returns_none(self):
        rows = [{"month": "2026-01", "v": 1}, {"month": "2026-02", "v": 2}]
        assert compute_trend_significance(rows, "month", "v") is None

    def test_flat_series_has_zero_slope(self):
        rows = [{"month": m, "v": 50} for m in ("2026-01", "2026-02", "2026-03")]
        trend = compute_trend_significance(rows, "month", "v")
        assert trend["direction"] == "flat"


class TestComputeConcentration:
    def test_top_n_share_of_total(self):
        rows = [
            {"customer": "Acme", "revenue": 700},
            {"customer": "Globex", "revenue": 200},
            {"customer": "Initech", "revenue": 50},
            {"customer": "Umbrella", "revenue": 50},
        ]
        result = compute_concentration(rows, "revenue", label_field="customer", top_n=1)
        assert result["share_pct"] == 70.0
        assert result["top_labels"] == ["Acme"]

    def test_even_split_has_low_top_n_share(self):
        rows = [{"x": str(i), "v": 25} for i in range(4)]
        result = compute_concentration(rows, "v", label_field="x", top_n=1)
        assert result["share_pct"] == 25.0

    def test_all_zero_returns_none(self):
        rows = [{"x": "a", "v": 0}, {"x": "b", "v": 0}]
        assert compute_concentration(rows, "v", label_field="x") is None


class TestNotabilityScore:
    def test_higher_signal_strength_scores_higher(self):
        weak = notability_score({"trend": {"r_squared": 0.1}})
        strong = notability_score({"trend": {"r_squared": 0.95}})
        assert strong > weak

    def test_empty_signals_score_zero(self):
        assert notability_score({}) == 0.0


class TestComputeSectionSignalsIntegration:
    def test_domain_agnostic_across_unrelated_schemas(self):
        """Same function, three unrelated schemas — proves no hidden
        vocabulary dependency, matching the discipline used for the other
        domain-neutrality fixes this session."""
        retail = [{"region": r, "sales": v} for r, v in [("East", 900), ("West", 50), ("North", 50)]]
        healthcare = [{"month": m, "admissions": v} for m, v in [("2026-01", 40), ("2026-02", 55), ("2026-03", 70)]]
        manufacturing = [{"line": l, "defect_count": v} for l, v in [("L1", 3), ("L2", 4), ("L3", 2), ("L4", 55)]]

        for rows in (retail, healthcare, manufacturing):
            signals = compute_section_signals(rows)
            assert signals  # each of these shapes should produce at least one signal

    def test_no_metric_column_returns_empty(self):
        rows = [{"name": "a"}, {"name": "b"}]
        assert compute_section_signals(rows) == {}

    def test_empty_input_is_a_safe_no_op(self):
        assert compute_section_signals([]) == {}
        assert compute_section_signals(None) == {}


class TestFormatSignalsForPrompt:
    def test_renders_all_present_signal_types(self):
        signals = {
            "trend": {"direction": "up", "periods": 4, "pct_change_start_to_end": 60.0, "confidence": "high", "r_squared": 0.95},
            "outliers": [{"label": "D", "value": 95, "z_score": 2.3, "direction": "above"}],
            "concentration": {"top_n": 1, "top_labels": ["Acme"], "share_pct": 70.0, "total_rows": 4},
        }
        text = format_signals_for_prompt(signals)
        assert "TREND" in text
        assert "OUTLIER" in text
        assert "CONCENTRATION" in text

    def test_empty_signals_produces_empty_string(self):
        assert format_signals_for_prompt({}) == ""
