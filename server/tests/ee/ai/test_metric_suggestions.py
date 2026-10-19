import json
from unittest.mock import AsyncMock, MagicMock

import pytest

from ee.modules.ai.metric_suggestions import clean, suggest_metrics

COLUMNS = [
    {"name": "order_id", "type": "BIGINT", "distinct_count": 100},
    {"name": "customer_id", "type": "VARCHAR", "distinct_count": 40},
    {"name": "amount", "type": "DECIMAL(12,2)"},
    {"name": "region", "type": "VARCHAR", "distinct_count": 5},
]


def test_keeps_valid_suggestions_in_order():
    raw = {"metrics": [
        {"title": "Revenue", "type": "sum", "column": "amount", "description": "Money in."},
        {"title": "Customers", "type": "count_distinct", "column": "customer_id"},
        {"title": "Average order", "type": "custom", "expression": "SUM(amount) / NULLIF(COUNT(*), 0)"},
    ]}
    out = clean(raw, COLUMNS, [])
    assert [m["name"] for m in out] == ["revenue", "customers", "average_order"]
    assert out[0]["column"] == "amount" and out[0]["description"] == "Money in."
    assert out[2]["expression"].startswith("SUM(amount)")


def test_drops_unknown_columns_bad_types_and_unsafe_sql():
    raw = {"metrics": [
        {"title": "Profit", "type": "sum", "column": "profit"},              # no such column
        {"title": "Region total", "type": "sum", "column": "region"},        # text can't be summed
        {"title": "Median", "type": "median", "column": "amount"},           # unknown aggregation
        {"title": "Sneaky", "type": "custom", "expression": "(SELECT max(x) FROM users)"},
        {"title": "No agg", "type": "custom", "expression": "amount * 2"},
        {"title": "Other column", "type": "custom", "expression": "SUM(cost)"},
        {"title": "Orders", "type": "count", "column": "order_id"},
    ]}
    assert [m["name"] for m in clean(raw, COLUMNS, [])] == ["orders"]


def test_skips_what_already_exists_and_bad_payloads():
    assert clean({"metrics": [{"title": "Revenue", "type": "sum", "column": "amount"}]}, COLUMNS, ["revenue"]) == []
    assert clean({"metrics": "nope"}, COLUMNS, []) == []
    assert clean(None, COLUMNS, []) == []


@pytest.mark.asyncio
async def test_sends_only_the_profile_and_parses_the_reply():
    llm = MagicMock()
    llm.generate_completion = AsyncMock(return_value={
        "success": True, "content": json.dumps({"metrics": [{"title": "Revenue", "type": "sum", "column": "amount"}]}),
    })
    out = await suggest_metrics("orders", 100, COLUMNS, [], llm=llm)
    assert out[0]["name"] == "revenue"
    prompt = llm.generate_completion.await_args.kwargs["prompt"]
    assert '"amount": DECIMAL(12,2)' in prompt and "100 rows" in prompt


@pytest.mark.asyncio
async def test_model_failure_is_raised():
    llm = MagicMock()
    llm.generate_completion = AsyncMock(return_value={"success": False, "error": "No AI model configured"})
    with pytest.raises(RuntimeError):
        await suggest_metrics("orders", 100, COLUMNS, [], llm=llm)
