"""Answers say where their numbers came from; certified definitions win ambiguity."""

from ee.modules.ai.nodes.response_finalizer_node import _attach_metric_provenance
from ee.modules.ai.utils.evidence import match_governed_metric

METRICS = [
    {"name": "revenue", "certified": True, "description": "Net of refunds"},
    {"name": "gross_revenue", "certified": False},
]


def test_single_hit_and_certified_tie_break():
    assert match_governed_metric("show gross revenue by month", [METRICS[1]])["name"] == "gross_revenue"
    # "gross revenue" names both metrics; the certified one is the organization's source of truth
    assert match_governed_metric("gross revenue by month", METRICS)["name"] == "revenue"
    both_uncertified = [dict(m, certified=False) for m in METRICS]
    assert match_governed_metric("gross revenue by month", both_uncertified) is None


def test_provenance_for_each_path():
    s = {"sql_query": "SELECT 1", "execution_metadata": {}}
    _attach_metric_provenance(s)
    assert s["execution_metadata"]["metric_provenance"] == {"source": "generated_sql"}

    s = {"sql_query": "SELECT 1", "semantic_compiled": True, "semantic_query_spec": {"metric": "revenue"}}
    _attach_metric_provenance(s)
    assert s["execution_metadata"]["metric_provenance"]["source"] == "semantic_layer"

    preset = {"source": "semantic_layer", "metric": "revenue", "certified": True}
    s = {"sql_query": "SELECT 1", "execution_metadata": {"metric_provenance": preset}}
    _attach_metric_provenance(s)
    assert s["execution_metadata"]["metric_provenance"] is preset

    s = {"sql_query": "SELECT 1", "execution_metadata": {"metric_guard": {"column": "doc", "from": "sum", "to": "count_distinct"}}}
    _attach_metric_provenance(s)
    assert s["execution_metadata"]["metric_provenance"]["adjusted"]["column"] == "doc"

    s = {"execution_metadata": {}}
    _attach_metric_provenance(s)
    assert "metric_provenance" not in s["execution_metadata"]
