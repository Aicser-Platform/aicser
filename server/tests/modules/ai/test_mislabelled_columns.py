"""A data column shown under the name the user asked for ("tenure_months AS week" for a
question about weeks) is caught: the SQL lineage is a structural fact, whether the rename is
faithful is a model judgment, and a substitution is rewritten — never shown as the asked-for
thing. Faithful renames (order_total AS revenue) pass untouched."""

import json

import pytest

from ee.modules.ai.nodes.insight_synthesizer_node import _compute_data_facts
from ee.modules.ai.nodes.post_query_brain import post_query_brain_node
from ee.modules.ai.utils.result_checks import renamed_source_columns


@pytest.mark.parametrize(
    "sql, expected",
    [
        ('SELECT "tenure_months" AS week, COUNT(*) AS record_count FROM data GROUP BY "tenure_months"',
         {"week": "tenure_months"}),
        ("SELECT DATE_TRUNC('week', date) AS week, COUNT(*) AS n FROM d GROUP BY 1", {}),
        ("SELECT order_total AS revenue, region FROM o", {"revenue": "order_total"}),
        ("SELECT wk FROM (SELECT tenure_months AS wk FROM d) t", {"wk": "tenure_months"}),
        ("WITH a AS (SELECT tenure_months AS week FROM d) SELECT week FROM a", {"week": "tenure_months"}),
        ("SELECT region, total FROM (SELECT region, SUM(x) AS total FROM t GROUP BY region) s", {}),
        ('SELECT customer_name AS "Customer Name" FROM c', {}),
        (None, {}),
    ],
)
def test_rename_lineage(sql, expected):
    assert renamed_source_columns(sql) == expected


class FakeLLM:
    def __init__(self, faithful):
        self.faithful = faithful
        self.calls = 0

    async def generate_completion(self, **kwargs):
        self.calls += 1
        name = "week" if "'week'" in kwargs["prompt"] else "revenue"
        return {"success": True, "content": json.dumps({"columns": [{"name": name, "faithful": self.faithful, "reason": "r"}]})}


ROWS = [{"week": w, "record_count": n} for w, n in [(59, 149), (54, 130), (70, 129), (8, 127), (58, 127)]]
SQL = 'SELECT "tenure_months" AS week, COUNT(*) AS record_count FROM data GROUP BY "tenure_months" ORDER BY 2 DESC LIMIT 5'


def _state(rows=ROWS, sql=SQL, query="Which 5 weeks had the most records?"):
    return {"query": query, "query_result": rows, "sql_query": sql, "query_intent": {},
            "analytics_type": "descriptive", "execution_metadata": {}}


@pytest.fixture(autouse=True)
def _decision_layer_off(monkeypatch):
    monkeypatch.setenv("DECISION_LAYER_BACKEND", "off")


@pytest.mark.asyncio
async def test_substituted_column_is_sent_back_for_a_rewrite():
    llm = FakeLLM(faithful=False)
    out = await post_query_brain_node(_state(), litellm_service=llm)
    assert llm.calls == 1
    assert out["current_stage"] == "post_query_correction_needed"
    ctx = out["correction_context"]
    assert ctx["issue"] == "mislabelled_column"
    assert "tenure_months" in ctx["instruction"] and "week" in ctx["instruction"]


@pytest.mark.asyncio
async def test_faithful_rename_passes():
    rows = [{"revenue": 100.0, "region": "A"}, {"revenue": 80.0, "region": "B"}, {"revenue": 60.0, "region": "C"}]
    out = await post_query_brain_node(
        _state(rows, "SELECT order_total AS revenue, region FROM o", "Revenue by region"),
        litellm_service=FakeLLM(faithful=True),
    )
    assert out["current_stage"] != "post_query_correction_needed"


@pytest.mark.asyncio
async def test_no_rename_means_no_judgment_call():
    llm = FakeLLM(faithful=False)
    rows = [{"week": "2024-01-01", "n": 5}, {"week": "2024-01-08", "n": 7}, {"week": "2024-01-15", "n": 6}]
    await post_query_brain_node(
        _state(rows, "SELECT DATE_TRUNC('week', date) AS week, COUNT(*) AS n FROM d GROUP BY 1"), litellm_service=llm,
    )
    assert llm.calls == 0


@pytest.mark.asyncio
async def test_when_no_judgment_is_available_the_answer_is_not_blocked():
    out = await post_query_brain_node(_state(), litellm_service=None)
    assert out["current_stage"] != "post_query_correction_needed"


@pytest.mark.asyncio
async def test_no_retries_left_tells_the_reader_what_the_column_is(monkeypatch):
    import ee.modules.ai.nodes.post_query_brain as pqb

    monkeypatch.setattr(pqb, "can_retry", lambda *_a, **_k: False)
    out = await post_query_brain_node(_state(), litellm_service=FakeLLM(faithful=False))
    assert out["current_stage"] != "post_query_correction_needed"
    caveats = (out.get("execution_metadata") or {}).get("result_caveats") or []
    assert any('"week"' in c and "tenure_months" in c for c in caveats)


def test_facts_name_what_a_renamed_column_really_holds():
    facts = _compute_data_facts(ROWS, sql=SQL)
    assert any("'week' is the data column 'tenure_months'" in f for f in facts)
    assert "tenure_months" not in facts[0]  # never the first ("notable signal") fact


def test_data_gaps_from_the_sql_writer_are_cleaned():
    from ee.modules.ai.nodes.nl2sql_node import _clean_data_gaps

    assert _clean_data_gaps(None) == []
    assert _clean_data_gaps("No calendar date; grouped by tenure months") == ["No calendar date; grouped by tenure months"]
    assert _clean_data_gaps(["a", " ", "b", {"x": 1}, "c", "d"]) == ["a", "b", "c"]


@pytest.mark.asyncio
async def test_data_gaps_reach_the_reader_as_caveats():
    rows = [{"tenure_months": 59, "record_count": 149}, {"tenure_months": 54, "record_count": 130},
            {"tenure_months": 70, "record_count": 129}]
    state = _state(rows, 'SELECT "tenure_months", COUNT(*) AS record_count FROM data GROUP BY 1 ORDER BY 2 DESC LIMIT 5')
    state["execution_metadata"] = {"data_gaps": ["This data has no calendar dates, so weeks can't be shown; grouped by tenure months instead."]}
    out = await post_query_brain_node(state, litellm_service=FakeLLM(faithful=True))
    caveats = (out.get("execution_metadata") or {}).get("result_caveats") or []
    assert caveats and caveats[0].startswith("This data has no calendar dates")


def test_chart_title_names_what_is_plotted_when_data_lacks_the_asked_field():
    from ee.modules.ai.utils.guaranteed_chart_builder import build_guaranteed_chart

    rows = [{"region": "Phnom Penh", "record_count": 2699}, {"region": "Kandal", "record_count": 2657},
            {"region": "Siem Reap", "record_count": 2644}]
    q = "Name the five weeks that had the most records"
    asked = build_guaranteed_chart(rows, q)
    grounded = build_guaranteed_chart(rows, q, intent={"result_differs_from_question": True})
    title = lambda c: (c.get("title") or {}).get("text") if isinstance(c.get("title"), dict) else str(c.get("title"))
    assert "Week" in title(asked)
    assert title(grounded) == "Record Count by Region"


@pytest.mark.parametrize(
    "sql, flagged",
    [
        ("SELECT date_trunc('week', order_date) AS week, COUNT(order_id) AS customer_count FROM orders GROUP BY 1",
         {"customer_count"}),
        ("SELECT date_trunc('week', order_date) AS week, COUNT(order_id) AS order_count FROM orders GROUP BY 1", set()),
        ("SELECT region, COUNT(*) AS customer_count FROM customers GROUP BY region", set()),
        ("SELECT region, COUNT(*) AS customer_count FROM orders GROUP BY region", {"customer_count"}),
        ("SELECT region, COUNT(DISTINCT customer_id) AS customers FROM orders GROUP BY region", set()),
        ("SELECT region, SUM(price * qty) AS revenue FROM orders GROUP BY region", set()),
        ('SELECT "tenure_months" AS week, COUNT(*) AS record_count FROM data GROUP BY 1', {"week"}),
        ("SELECT plan, AVG(tenure_months) AS avg_tenure FROM data GROUP BY plan", set()),
    ],
)
def test_relabel_signal_covers_aggregates_without_flagging_plain_names(sql, flagged):
    from ee.modules.ai.utils.result_checks import relabelled_outputs

    assert set(relabelled_outputs(sql)) == flagged


@pytest.mark.asyncio
async def test_platform_compiled_sql_is_not_judged():
    llm = FakeLLM(faithful=False)
    state = _state()
    state["execution_metadata"] = {"sql_contract": "deterministic"}
    out = await post_query_brain_node(state, litellm_service=llm)
    assert llm.calls == 0 and out["current_stage"] != "post_query_correction_needed"
