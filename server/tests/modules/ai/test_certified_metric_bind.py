from datetime import datetime, timedelta, timezone

from ee.modules.ai.utils.evidence import bind_certified_metric, match_governed_metric
from ee.modules.ontology.freshness import evaluate_metric_freshness
from ee.modules.ontology.resolve import aliases_from_mapping, match_alias_tokens


def test_uncertified_cannot_bind():
    metrics = [{"id": "m1", "name": "Revenue", "certified": False}]
    assert bind_certified_metric("show revenue", metrics) is None


def test_certified_name_match_binds():
    metrics = [{"id": "m1", "name": "Revenue", "certified": True}]
    bound = bind_certified_metric("what is revenue by region", metrics)
    assert bound is not None
    assert bound["id"] == "m1"
    assert bound["stale"] is False


def test_graph_pointer_wins_over_name_only():
    metrics = [
        {"id": "other", "name": "Revenue", "certified": True},
        {"id": "graph-m", "name": "Net Revenue", "certified": True},
    ]
    bound = bind_certified_metric(
        "net revenue this year",
        metrics,
        graph_metric_ids=["graph-m"],
    )
    assert bound["id"] == "graph-m"


def test_stale_slo_is_labeled():
    old = datetime.now(timezone.utc) - timedelta(hours=48)
    ev = evaluate_metric_freshness(
        {"freshness_slo_hours": 24, "updated_at": old.isoformat()}
    )
    assert ev["stale"] is True


def test_alias_resolve_fibo_style():
    mapping = {"table_concept": {"customers": "Customer", "loans": "Loan"}}
    aliases = aliases_from_mapping(mapping)
    hits = match_alias_tokens("customer balance by loan", aliases)
    assert any("Customer" in h or "customer" in h.lower() for h in hits)


def test_match_requires_overlap():
    assert (
        match_governed_metric(
            "weather in paris",
            [{"id": "m1", "name": "Revenue", "certified": True}],
        )
        is None
    )


def test_no_slo_is_not_stale():
    ev = evaluate_metric_freshness({"certified": True, "updated_at": "2000-01-01T00:00:00+00:00"})
    assert ev["stale"] is False
    assert ev["slo_hours"] is None
