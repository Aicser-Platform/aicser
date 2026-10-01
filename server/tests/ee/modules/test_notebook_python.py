"""Notebook Python is written for where it runs: the browser, on the notebook's DataFrames —
never an API call or database connection (the old prompt told the model to call
http://localhost:8000 with requests, which can't run there)."""

import json

import pytest

from ee.modules.ai.services.notebook_python import check_code, frames_block, generate_notebook_python

FRAMES = [{"name": "q5", "columns": ["supplier_name", "order_count", "total_order_value"], "rows": 15}]


def test_runnable_code_passes():
    assert check_code("top = q5.sort_values('total_order_value', ascending=False).head(5)\ntop") == []
    assert check_code("import matplotlib.pyplot as plt\nq5.plot.bar(x='supplier_name', y='order_count')") == []


@pytest.mark.parametrize("code, fragment", [
    ("import requests\nrequests.get('http://localhost:8000')", "requests"),
    ("from sqlalchemy import create_engine", "sqlalchemy"),
    ("df = pd.read_sql('select 1', con)", "read_sql"),
    ("df = pd.read_csv(open('x.csv'))", "opens a file"),
    ("def broken(:\n  pass", "syntax error"),
])
def test_code_that_cannot_run_here_is_caught(code, fragment):
    assert any(fragment in p for p in check_code(code))


def test_frames_are_described_by_name_and_columns():
    block = frames_block(FRAMES)
    assert "q5 (15 rows): supplier_name, order_count, total_order_value" in block
    assert frames_block([]) == "- none yet"


class FakeLLM:
    def __init__(self, replies):
        self.replies, self.prompts = list(replies), []

    async def generate_completion(self, **kwargs):
        self.prompts.append(kwargs["prompt"])
        return {"success": True, "content": json.dumps({"code": self.replies.pop(0)})}


@pytest.mark.asyncio
async def test_unrunnable_draft_is_retried_with_the_reason():
    llm = FakeLLM(["import requests\nrequests.get('x')", "q5.nlargest(5, 'total_order_value')"])
    out = await generate_notebook_python("top 5 suppliers by value", FRAMES, llm)
    assert out == {"success": True, "code": "q5.nlargest(5, 'total_order_value')"}
    assert "q5" in llm.prompts[0] and "can't run here" in llm.prompts[1]


@pytest.mark.asyncio
async def test_gives_up_honestly_after_two_unrunnable_drafts():
    out = await generate_notebook_python("x", FRAMES, FakeLLM(["import requests", "import psycopg2"]))
    assert out["success"] is False and "wouldn't run" in out["error"]


# Tables load in Python through the governed loader, like a SQL cell — never pd.read_* on a name.
SOURCE = {"name": "Retail", "tables": [{"name": "retail_supply_chain.stores", "columns": ["store_id", "region"]}]}


def test_governed_loader_is_runnable_and_file_readers_are_not():
    assert check_code('stores = aicser.table("retail_supply_chain.stores", source="Retail")\nstores.head()') == []
    assert check_code('df = aicser.sql("SELECT region, COUNT(*) AS n FROM retail_supply_chain.stores GROUP BY 1")') == []
    assert any("aicser.table" in p for p in check_code("df = pd.read_csv(stores)"))
    assert any("top level" in p for p in check_code("def f():\n    return aicser.table('x.y')"))


@pytest.mark.asyncio
async def test_the_model_is_told_the_source_and_its_tables():
    llm = FakeLLM(['stores = aicser.table("retail_supply_chain.stores", source="Retail")\nstores'])
    out = await generate_notebook_python("stores by region", [], llm, source=SOURCE)
    assert out["success"] is True
    assert 'data source "Retail"' in llm.prompts[0] and "retail_supply_chain.stores: store_id, region" in llm.prompts[0]


# Inline suggestions: only the text to insert, never a repeat of what's around the cursor.
from ee.modules.ai.services.notebook_python import _clean_completion, complete_code


def test_suggestion_is_only_the_new_text():
    assert _clean_completion("```python\ntop = q5.head()\n```", "x = 1\n", "") == "top = q5.head()"
    assert _clean_completion("q5.groupby('region')", "by = q5.", "") == "groupby('region')"
    assert _clean_completion("sum()\nprint(by)", "by = q5.", "\nprint(by)") == "sum()"
    assert _clean_completion("df['b']", "x = df", "") == "df['b']"
    # before an auto-closed bracket: stop where the suggestion would close it, keep nested calls
    assert _clean_completion('"total", ascending=False).head(10)', "top = d.sort_values(", ")") == '"total", ascending=False'
    assert _clean_completion("key=lambda s: len(s)", "d.sort_values(", ")") == "key=lambda s: len(s)"
    assert _clean_completion("   \n", "x", "") == ""
    assert len(_clean_completion("\n".join(f"a{i}" for i in range(20)), "x", "").split("\n")) == 8


@pytest.mark.asyncio
async def test_suggestion_knows_the_frames_and_says_nothing_on_an_empty_cell():
    class RawLLM(FakeLLM):
        async def generate_completion(self, **kwargs):
            self.prompts.append(kwargs["prompt"])
            return {"success": True, "content": self.replies.pop(0)}

    llm = RawLLM(["nlargest(5, 'total_order_value')"])
    assert await complete_code("python", "top = q5.", "", FRAMES, llm) == "nlargest(5, 'total_order_value')"
    assert "q5 (15 rows)" in llm.prompts[0] and "top = q5.<CURSOR>" in llm.prompts[0]
    assert await complete_code("python", "   ", "", FRAMES, FakeLLM([])) == ""


@pytest.mark.asyncio
async def test_the_model_is_told_the_approved_models_and_decisions():
    llm = FakeLLM(['q5.pipe(lambda d: d)'])
    await generate_notebook_python("score churn", FRAMES, llm,
                                   models=[{"name": "Churn", "task": "classification", "predicts": "predicted_churn", "inputs": ["tenure"]},
                                           {"name": "Weekly sales", "task": "forecast"}],
                                   decisions=[{"name": "Refund request?", "type": "noul", "instructions": "Is this a refund?"}])
    p = llm.prompts[0]
    assert 'aicser.predict("Churn", df)' in p and "from tenure" in p
    assert 'aicser.forecast("Weekly sales", periods=12)' in p and 'aicser.decide("Refund request?", df' in p
