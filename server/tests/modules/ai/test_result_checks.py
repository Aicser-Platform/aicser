"""Result sanity caveats: split categories and sparse measures are named; clean results
produce none."""

from ee.modules.ai.nodes.insight_synthesizer_node import _build_insight_prompt
from ee.modules.ai.utils.result_checks import find_key_variants, find_sparse_metrics, result_caveats


def test_case_and_space_variants_flagged():
    rows = [{"country": "Cambodia", "v": 10}, {"country": "cambodia ", "v": 5}, {"country": "Thailand", "v": 7}]
    f = find_key_variants(rows)
    assert f and f[0]["column"] == "country" and f[0]["variants"][0] == ["Cambodia", "cambodia "]
    assert "split" in result_caveats(rows)[0]


def test_sparse_metric_flagged():
    rows = [{"k": str(i), "amount": (None if i % 3 == 0 else float(i))} for i in range(9)]
    assert find_sparse_metrics(rows) == [{"column": "amount", "null_share": 0.333}]
    assert "33% of rows have no value" in result_caveats(rows)[0]


def test_clean_result_has_no_caveats():
    rows = [{"region": r, "sales": i * 10.0} for i, r in enumerate(["North", "South", "East", "West", "Central"])]
    assert result_caveats(rows) == []
    assert result_caveats([]) == [] and result_caveats(None) == []


def test_caveats_reach_the_insight_prompt():
    prompt = _build_insight_prompt(
        query="sales by country", data_facts=["x"], sample_csv="", total_rows=3, chart_description="",
        analytics_type="descriptive", result_caveats=["country: values split"],
    )
    assert "Data caveats" in prompt and "country: values split" in prompt
    assert "Data caveats" not in _build_insight_prompt(
        query="q", data_facts=["x"], sample_csv="", total_rows=3, chart_description="", analytics_type="descriptive",
    )


_SCHEMA = {"tables": [
    {"name": "orders", "columns": [{"name": "id"}, {"name": "customer_id"}, {"name": "amount"}]},
    {"name": "order_items", "columns": [{"name": "id"}, {"name": "order_id"}, {"name": "sku"}, {"name": "qty"}]},
]}


def test_fanout_flags_one_side_measure_after_one_to_many_join():
    from ee.modules.ai.utils.result_checks import fanout_caveats, find_fanout_risks

    bad = "SELECT o.customer_id, SUM(o.amount) FROM orders o JOIN order_items i ON i.order_id = o.id GROUP BY 1"
    risks = find_fanout_risks(bad, _SCHEMA, "postgresql")
    assert risks == [{"measure": "orders.amount", "fans_out_over": "order_items", "aggregate": "SUM"}]
    assert "overstated" in fanout_caveats(bad, _SCHEMA)[0]
    # Measures from the many side, or no join, are fine.
    ok = "SELECT o.customer_id, SUM(i.qty) FROM orders o JOIN order_items i ON i.order_id = o.id GROUP BY 1"
    assert find_fanout_risks(ok, _SCHEMA) == []
    assert find_fanout_risks("SELECT SUM(amount) FROM orders", _SCHEMA) == []


def test_row_count_jump_compares_with_last_run(monkeypatch):
    from ee.modules.ai.utils import result_checks as RC

    store = {}

    class _Cache:
        def get(self, k):
            return store.get(k)

        def set(self, k, v, ttl=None):
            store[k] = v

    import src.core.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", _Cache())
    sql = "SELECT day, SUM(x) FROM t GROUP BY 1"
    assert RC.row_count_jump_caveat("ds1", sql, 365) is None  # first run: nothing to compare
    assert RC.row_count_jump_caveat("ds1", sql, 360) is None  # normal variation
    msg = RC.row_count_jump_caveat("ds1", "select day,  sum(x) from t group by 1", 40)
    assert msg and "40 rows, versus 360" in msg
    assert RC.row_count_jump_caveat("ds2", sql, 5) is None  # other source, own history
