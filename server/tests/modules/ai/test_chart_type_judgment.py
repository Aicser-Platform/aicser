"""Chart type is a judgment (decision layer when primary, else one short model call), checked
against what the data can support; the data-shape rules only decide when no judgment exists."""

import json

import pytest

from ee.modules.ai.utils.chart_decision import decide_chart_type, result_facts
from ee.modules.ai.utils.guaranteed_chart_builder import analyze_columns, apply_decided_chart_type, build_guaranteed_chart

CATS = [{"plan": "basic", "fee": 109.5}, {"plan": "plus", "fee": 106.3}, {"plan": "pro", "fee": 102.4}]
WEEKS = [{"week": f"2024-01-{d:02d}", "orders": v} for d, v in zip((1, 8, 15, 22, 29), (5, 7, 6, 9, 8))]


class FakeLLM:
    def __init__(self, chart, confidence=0.9):
        self.chart, self.confidence, self.calls, self.prompts = chart, confidence, 0, []

    async def generate_completion(self, **kwargs):
        self.calls += 1
        self.prompts.append(kwargs["prompt"])
        return {"success": True, "content": json.dumps({"chart": self.chart, "confidence": self.confidence, "reason": "r"})}


@pytest.fixture(autouse=True)
def _decision_layer_off(monkeypatch):
    monkeypatch.setenv("DECISION_LAYER_BACKEND", "off")


def _apply(decided, rows, x, y, group=None, non_additive=None):
    ca = analyze_columns(rows)
    return apply_decided_chart_type(decided, "bar", x, y, [], group, ca, rows, non_additive or set())


def test_supported_choice_replaces_the_rule_and_keeps_columns():
    assert _apply("horizontal_bar", CATS, "plan", "fee")[:3] == ("horizontal_bar", "plan", "fee")
    assert _apply("line", WEEKS, "week", "orders")[0] == "line"
    assert _apply("bar", CATS, "plan", "fee", group="region")[0] == "grouped_bar"


def test_unsupported_choice_is_refused():
    assert _apply("line", CATS, "plan", "fee")[0] == "bar"                    # categories aren't an ordered axis
    assert _apply("pie", CATS, "plan", "fee", non_additive={"fee"})[0] == "bar"  # shares of averages
    assert _apply("kpi", CATS, "plan", "fee")[0] == "bar"                     # several rows


@pytest.mark.asyncio
async def test_model_decides_when_confident_and_sees_what_the_sql_says():
    llm = FakeLLM("horizontal_bar")
    out = await decide_chart_type("Top plans by fee", CATS, sql="SELECT plan, AVG(fee) AS fee FROM c GROUP BY plan ORDER BY 2 DESC",
                                  litellm_service=llm)
    assert out == {"chart": "horizontal_bar", "source": "model"}
    assert "sorted by fee" in llm.prompts[0] and "not additive" in llm.prompts[0]


@pytest.mark.asyncio
async def test_unsure_or_single_row_leaves_it_to_the_rules():
    assert await decide_chart_type("fee by plan", CATS, litellm_service=FakeLLM("pie", confidence=0.3)) is None
    llm = FakeLLM("bar")
    assert await decide_chart_type("total fee", [{"fee": 5}], litellm_service=llm) is None and llm.calls == 0
    assert await decide_chart_type("fee by plan", CATS, litellm_service=None) is None


@pytest.mark.asyncio
async def test_chart_step_uses_the_judgment():
    from ee.modules.ai.nodes.chart_builder_node import chart_builder_node

    out = await chart_builder_node(
        {"query": "Compare fee across plans", "query_result": CATS,
         "sql_query": "SELECT plan, SUM(fee) AS fee FROM c GROUP BY plan", "query_intent": {}},
        litellm_service=FakeLLM("horizontal_bar"),
    )
    chart = out.get("echarts_config") or {}
    y = chart.get("yAxis")
    y = y[0] if isinstance(y, list) else y
    assert (y or {}).get("type") == "category"  # horizontal bars: categories on the y axis
    assert (out.get("execution_metadata") or {}).get("chart_decision", {}).get("source") == "model"


def test_rules_still_decide_without_a_judgment():
    assert build_guaranteed_chart(CATS, "fee by plan")["series"][0]["type"] == "bar"


def test_result_facts_are_from_the_sql():
    facts = result_facts("SELECT plan, AVG(fee) AS fee FROM c GROUP BY plan ORDER BY 2 DESC", ["no customer id"])
    assert "sorted by fee" in facts and "not additive" in facts and "no customer id" in facts


FLOWS = [
    {"channel": "Online", "product": "Shoes", "region": "North", "revenue": 120.0},
    {"channel": "Online", "product": "Bags", "region": "South", "revenue": 80.0},
    {"channel": "Store", "product": "Shoes", "region": "North", "revenue": 60.0},
    {"channel": "Store", "product": "Hats", "region": "South", "revenue": 40.0},
]


def test_sankey_is_drawn_across_every_category_level():
    ca = analyze_columns(FLOWS)
    t, x, y, _, _ = apply_decided_chart_type("sankey", "bar", "channel", "revenue", [], None, ca, FLOWS, set())
    assert t == "sankey"
    chart = build_guaranteed_chart(FLOWS, "How does revenue flow from channel to product to region?",
                                   chart_type="sankey")
    s = chart["series"][0]
    assert s["type"] == "sankey" and chart["aiserSankeyLevels"] == ["channel", "product", "region"]
    names = {n["name"].replace("​", "") for n in s["data"]}
    assert {"Online", "Store", "Shoes", "Bags", "Hats", "North", "South"} <= names
    link = next(l for l in s["links"] if l["source"] == "Online" and l["target"].startswith("Shoes"))
    assert link["value"] == 120.0


def test_sankey_is_refused_when_the_data_cannot_flow():
    ca = analyze_columns(CATS)
    assert _apply("sankey", CATS, "plan", "fee")[0] == "bar"  # one category column: nothing flows
    ca2 = analyze_columns(FLOWS)
    t = apply_decided_chart_type("sankey", "bar", "channel", "revenue", [], None, ca2, FLOWS, {"revenue"})[0]
    assert t == "bar"  # an average can't be split into flows
