"""Regression: chart axes must match ranking NL (TEXT id columns, metric vs COUNT)."""

from __future__ import annotations

from typing import Any, Dict, List

import pytest

from ee.modules.ai.utils.guaranteed_chart_builder import build_guaranteed_chart


def _category_labels_from_chart(chart: Dict[str, Any]) -> List[str]:
    """Bar: category on xAxis; horizontal_bar: category on yAxis."""
    ya = chart.get("yAxis") or {}
    xa = chart.get("xAxis") or {}
    if isinstance(ya, dict) and ya.get("type") == "category" and ya.get("data"):
        return [str(x) for x in ya["data"]]
    if isinstance(xa, dict) and xa.get("type") == "category" and xa.get("data"):
        return [str(x) for x in xa["data"]]
    return []


@pytest.mark.parametrize(
    "query",
    [
        "Top 10 policy_number by premium_annual?",
        "top 10 policy_number by premium_annual",
    ],
)
def test_ranking_prefers_query_named_text_id_over_low_cardinality_category(query: str):
    """
    policy_number is often classified as TEXT (high cardinality). It must still win over
    payment_status for 'top … policy_number …' questions.
    """
    data = [
        {
            "policy_number": f"POL-{i:03d}",
            "payment_status": "paid" if i % 2 == 0 else "overdue",
            "premium_annual": 1000 + i * 73,
            "record_count": i * 11,
        }
        for i in range(1, 16)
    ]
    intent = {"is_ranking": True, "top_n": 10}
    chart = build_guaranteed_chart(data, query=query, intent=intent)
    labels = _category_labels_from_chart(chart)
    assert labels, chart
    joined = " | ".join(labels)
    assert "POL-" in joined, f"Expected policy ids on category axis, got: {labels}"
    # Should not use payment_status as the breakdown for this question
    assert not all(x.lower() in ("paid", "overdue") for x in labels), labels

    x_name = ((chart.get("xAxis") or {}) if isinstance(chart.get("xAxis"), dict) else {}).get("name", "")
    assert "premium" in str(x_name).lower()


def test_premium_query_deprioritizes_record_count_when_both_present():
    data = [
        {"sku": f"S{i}", "premium_annual": 50.0 + i, "record_count": 999 - i}
        for i in range(5)
    ]
    chart = build_guaranteed_chart(
        data,
        query="Top 5 sku by premium_annual",
        intent={"is_ranking": True, "top_n": 5},
    )
    x_name = ((chart.get("xAxis") or {}) if isinstance(chart.get("xAxis"), dict) else {}).get("name", "")
    y_name = ((chart.get("yAxis") or {}) if isinstance(chart.get("yAxis"), dict) else {}).get("name", "")
    names = f"{x_name} {y_name}".lower()
    assert "premium" in names
    assert "record" not in names.replace("premium_annual", "")


def test_ranking_prefers_customer_name_over_customer_id():
    data = [
        {
            "customer_id": i,
            "name": f"Customer {i}",
            "avg_loan_amount": 40000 + i * 1000,
            "loan_count": 2,
        }
        for i in range(1, 6)
    ]
    chart = build_guaranteed_chart(
        data,
        query="how much amount loan per top 10 customers",
        intent={"is_ranking": True, "top_n": 10},
    )
    labels = _category_labels_from_chart(chart)
    assert labels
    assert any("Customer" in x for x in labels), labels
    assert not all(x.isdigit() for x in labels), labels


def test_misaligned_count_result_gets_data_grounded_title_not_nl_premium_claim():
    """When SQL only returns counts but the user asked about premium, title must not lie."""
    data = [
        {"payment_status": "paid" if i % 2 == 0 else "overdue", "record_count": 300 - i}
        for i in range(2)
    ]
    chart = build_guaranteed_chart(
        data,
        query="Top 10 policy_number by premium_annual?",
        intent={"is_ranking": True, "top_n": 10},
    )
    title = (chart.get("title") or {}).get("text", "") if isinstance(chart.get("title"), dict) else ""
    assert title
    assert "premium" not in title.lower(), title
    assert "record" in title.lower()


def test_bar_drops_count_and_average_against_million_scale_total():
    data = [
        {"category": "Deposits", "total": 5_500_000, "average": 420.0, "count": 84},
        {"category": "Loans", "total": 1_200_000, "average": 90.0, "count": 12},
        {"category": "Fees", "total": 800_000, "average": 55.0, "count": 40},
    ]
    chart = build_guaranteed_chart(
        data,
        query="spend / revenue by category",
        title="Spend / Revenue by Category",
    )
    names = [str(s.get("name", "")).lower() for s in (chart.get("series") or [])]
    assert names, chart
    assert any("total" in n for n in names)
    assert not any("count" in n for n in names)
    assert not any("average" in n for n in names)
    grid = chart.get("grid") or {}
    assert grid.get("containLabel") is True


def test_boolean_flag_loses_to_real_category_axis():
    data = [
        {"loan_type": "mortgage", "npl_flag": False, "total": 5_500_000},
        {"loan_type": "auto", "npl_flag": True, "total": 1_200_000},
        {"loan_type": "personal", "npl_flag": False, "total": 800_000},
    ]
    chart = build_guaranteed_chart(data, query="spend by category")
    labels = _category_labels_from_chart(chart)
    joined = " ".join(labels).lower()
    assert any(tok in joined for tok in ("mortgage", "auto", "personal")), labels
    assert "false" not in joined
    assert "true" not in joined
