"""Decision layer: off by default, shadow never changes behaviour, primary only acts on
confident answers, unsupported scripts abstain, and a confident 'not summable' verdict
turns SUM(document_number) into COUNT(DISTINCT …)."""

import pytest

from ee.modules.ai.decisions import backends as B
from ee.modules.ai.decisions import service as S
from ee.modules.ai.decisions.registry import COLUMN_ROLE, FRONT_DOOR


class _FakeBackend(B.DecisionBackend):
    name = "jev"

    def __init__(self, answers, delay=0.0):
        self._answers, self._delay, self.calls = answers, delay, 0

    async def decide(self, state, qset, timeout_s):
        import asyncio
        self.calls += 1
        if self._delay:
            await asyncio.sleep(self._delay)
        return B.normalise_answers({"answers": self._answers}, qset), {"cost": 0.0}


@pytest.fixture(autouse=True)
def no_log_no_cache(monkeypatch):
    monkeypatch.setattr(S, "_schedule_log", lambda *a, **k: None)
    import src.core.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", None)


def test_normalise_parses_all_question_types():
    out = B.normalise_answers({"answers": {
        "mode": {"type": "choice", "probabilities": {"predictive": 0.94, "standard": 0.06}, "confidence": 0.93},
        "needs_chart": {"type": "noul", "noul": 0.97},
        "needs_clarification": {"type": "noul", "noul": 0.1},
        "bogus": {"x": 1},
    }}, FRONT_DOOR)
    assert out["mode"]["value"] == "predictive" and out["mode"]["confidence"] == 0.93
    assert out["needs_chart"]["value"] is True and out["needs_clarification"]["value"] is False
    assert out["needs_clarification"]["confidence"] == pytest.approx(0.9)
    # unknown option / malformed answers are dropped, never raised
    assert "mode" not in B.normalise_answers({"answers": {"mode": {"choice": "nonsense"}}}, FRONT_DOOR)


@pytest.mark.asyncio
async def test_off_by_default(monkeypatch):
    monkeypatch.delenv("DECISION_LAYER_BACKEND", raising=False)
    out = await S.ask_decisions("front_door", "forecast revenue")
    assert out.mode == "off" and not out.answers


@pytest.mark.asyncio
async def test_shadow_answers_but_is_never_usable(monkeypatch):
    monkeypatch.setenv("DECISION_LAYER_BACKEND", "jev")
    monkeypatch.delenv("DECISION_LAYER_MODES", raising=False)
    fake = _FakeBackend({"mode": {"probabilities": {"predictive": 0.99}, "confidence": 0.99}})
    monkeypatch.setattr(S, "get_backend", lambda: fake)
    out = await S.ask_decisions("front_door", "forecast revenue")
    assert out.mode == "shadow" and out.confident("mode") and not out.usable("mode")


@pytest.mark.asyncio
async def test_primary_respects_threshold_timeout_and_org_allowlist(monkeypatch):
    monkeypatch.setenv("DECISION_LAYER_BACKEND", "jev")
    monkeypatch.setenv("DECISION_LAYER_MODES", '{"front_door": "primary"}')
    monkeypatch.setenv("DECISION_THRESHOLDS", '{"front_door": 0.9}')
    monkeypatch.setattr(S, "get_backend", lambda: _FakeBackend(
        {"mode": {"probabilities": {"predictive": 0.8}, "confidence": 0.8}}))
    out = await S.ask_decisions("front_door", "forecast revenue")
    assert out.mode == "primary" and not out.usable("mode")  # below threshold → caller keeps LLM path

    monkeypatch.setattr(S, "get_backend", lambda: _FakeBackend({}, delay=3))
    out = await S.ask_decisions("front_door", "q", timeout_s=0.1)
    assert out.error == "timeout" and not out.answers

    monkeypatch.setenv("DECISION_LAYER_ALLOWED_ORGS", "org-a")
    out = await S.ask_decisions("front_door", "q", S.DecisionContext(organization_id="org-b"))
    assert out.mode == "off"


def test_laya_abstains_on_untrained_scripts():
    assert B.detect_scripts("ព្យាករណ៍ ចំណូល") == {"Khmer"}
    assert B.detect_scripts("forecast revenue") == {"Latin"}
    assert "Thai" in B.detect_scripts("พยากรณ์รายได้")


@pytest.mark.asyncio
async def test_laya_unsupported_script_returns_no_answers(monkeypatch):
    monkeypatch.setenv("LAYA_ENDPOINT", "http://laya.local/decide")
    monkeypatch.setenv("LAYA_SUPPORTED_SCRIPTS", "Latin")
    answers, meta = await B.LayaBackend().decide("ព្យាករណ៍ ចំណូល", FRONT_DOOR, 1.0)
    assert answers == {} and meta["error"] == "unsupported_script"


SCHEMA = {"tables": [{"name": "data", "columns": [{"name": "sales_document", "type": "INTEGER"},
                                                  {"name": "document_date", "type": "DATE"},
                                                  {"name": "region", "type": "VARCHAR"}]}]}
LLM_SQL = ("SELECT DATE_TRUNC('WEEK', \"document_date\") AS period, SUM(\"sales_document\") AS value "
           "FROM \"data\" WHERE region = 'EMEA' GROUP BY 1")


def _state():
    return {"data_source_id": "ds1",
            "delegation_context": {"target_metric": "data.sales_document", "metric_aggregation": "sum"}}


@pytest.mark.asyncio
async def test_classifier_identifier_counts_distinct_and_keeps_filters(monkeypatch):
    from ee.modules.ai.decisions import column_guard as G

    monkeypatch.delenv("DECISION_LAYER_BACKEND", raising=False)

    async def label(state, schema, column):
        return "identifier", 0.93

    monkeypatch.setattr(G, "_classifier_label", label)
    state = _state()
    decision = await G.decide_metric_aggregation(state, "forecast weekly sales documents", SCHEMA)
    assert decision and decision.to_agg == "count_distinct" and decision.source == "column_classifier"
    sql = G.apply_aggregate_rewrite(LLM_SQL, decision, "duckdb")
    assert 'COUNT(DISTINCT "sales_document")' in sql and "region = 'EMEA'" in sql and "SUM(" not in sql
    G.record_adjustment(state, decision)
    assert state["delegation_context"]["metric_aggregation"] == "count_distinct"
    assert "identifier" in state["delegation_context"]["data_notes"][0]
    assert state["execution_metadata"]["metric_guard"]["source"] == "column_classifier"


@pytest.mark.asyncio
async def test_guard_leaves_real_metrics_and_low_confidence_alone(monkeypatch):
    from ee.modules.ai.decisions import column_guard as G

    monkeypatch.delenv("DECISION_LAYER_BACKEND", raising=False)
    for lbl in (("metric", 0.99), ("identifier", 0.5), (None, 0.0)):
        async def label(state, schema, column, _l=lbl):
            return _l
        monkeypatch.setattr(G, "_classifier_label", label)
        assert await G.decide_metric_aggregation(_state(), "q", SCHEMA) is None
    monkeypatch.setenv("AISER_METRIC_GUARD", "off")
    async def ident(state, schema, column):
        return "identifier", 0.99
    monkeypatch.setattr(G, "_classifier_label", ident)
    assert await G.decide_metric_aggregation(_state(), "q", SCHEMA) is None


@pytest.mark.asyncio
async def test_decision_layer_primary_can_decide_and_shadow_cannot(monkeypatch):
    from ee.modules.ai.decisions import column_guard as G

    async def no_label(state, schema, column):
        return None, 0.0

    monkeypatch.setattr(G, "_classifier_label", no_label)
    monkeypatch.setenv("DECISION_LAYER_BACKEND", "jev")
    unsafe = {"role": {"probabilities": {"metric": 0.95}, "confidence": 0.95}, "safe_to_sum": {"noul": 0.03}}
    monkeypatch.setattr(S, "get_backend", lambda: _FakeBackend(unsafe))
    monkeypatch.setenv("DECISION_LAYER_MODES", '{"column_role": "shadow"}')
    assert await G.decide_metric_aggregation(_state(), "q", SCHEMA) is None
    monkeypatch.setenv("DECISION_LAYER_MODES", '{"column_role": "primary"}')
    d = await G.decide_metric_aggregation(_state(), "q", SCHEMA)
    assert d and d.to_agg == "count" and d.source == "decision_layer"
    G.record_adjustment(st := _state(), d)
    assert "isn't meaningful" in st["delegation_context"]["data_notes"][0]


def test_rewrite_is_noop_when_column_not_aggregated():
    from ee.modules.ai.decisions.column_guard import AggregationDecision, apply_aggregate_rewrite

    d = AggregationDecision("sales_document", "sum", "count_distinct", "identifier", "column_classifier")
    assert apply_aggregate_rewrite('SELECT SUM("amount") FROM "data"', d, "duckdb") is None


def test_explicit_count_beats_name_heuristic():
    from ee.modules.ai.utils.mode_sql_builders import _agg_expr

    assert _agg_expr('"price_list_id"', "count_distinct", "price_list_id") == 'COUNT(DISTINCT "price_list_id")'
    assert _agg_expr('"unit_price"', "sum", "unit_price") == 'AVG("unit_price")'


class _CountingLLM:
    def __init__(self):
        self.calls = 0

    async def generate_completion_with_tools(self, **kw):
        self.calls += 1
        return {"success": True, "tool_calls": [{"arguments": {
            "confident": True, "mode": "standard", "needs_chart": True, "needs_narrative": True}}]}


_CONFIDENT_FRONT_DOOR = {
    "mode": {"probabilities": {"predictive": 0.97}, "confidence": 0.97},
    "needs_chart": {"noul": 0.99}, "needs_narrative": {"noul": 0.95},
    "needs_clarification": {"noul": 0.05}, "injection_risk": {"noul": 0.01},
}


@pytest.mark.asyncio
async def test_router_primary_confident_skips_llm(monkeypatch):
    from ee.modules.ai.utils.routing_utils import classify_user_intent

    monkeypatch.setenv("DECISION_LAYER_BACKEND", "jev")
    monkeypatch.setenv("DECISION_LAYER_MODES", '{"front_door": "primary"}')
    monkeypatch.setattr(S, "get_backend", lambda: _FakeBackend(_CONFIDENT_FRONT_DOOR))
    llm = _CountingLLM()
    res = await classify_user_intent("forecast revenue for next quarter", "standard", llm)
    assert llm.calls == 0 and res.mode == "predictive" and res.reclassify_to == "predictive"


@pytest.mark.asyncio
async def test_router_primary_surfaces_plausible_and_escalates_unsure(monkeypatch):
    from ee.modules.ai.decisions import front_door as F
    from ee.modules.ai.utils.routing_utils import classify_user_intent

    monkeypatch.setenv("DECISION_LAYER_BACKEND", "jev")
    monkeypatch.setenv("DECISION_LAYER_MODES", '{"front_door": "primary"}')
    # Plausible (surface band, 0.5–threshold): no LLM call; the verdict is offered, not imposed.
    plausible = dict(_CONFIDENT_FRONT_DOOR, mode={"probabilities": {"predictive": 0.55, "standard": 0.45}, "confidence": 0.55})
    monkeypatch.setattr(S, "get_backend", lambda: _FakeBackend(plausible))
    F._BY_REQUEST.clear()
    llm = _CountingLLM()
    res = await classify_user_intent("maybe forecast?", "standard", llm)
    assert llm.calls == 0 and res.mode == "predictive" and res.confident is False
    assert res.alternatives == ["standard"] and res.reclassify_to is None
    # Unsure (escalate band, < 0.5): the LLM classifier decides, exactly as before.
    unsure = dict(_CONFIDENT_FRONT_DOOR, mode={"probabilities": {"predictive": 0.4}, "confidence": 0.4})
    monkeypatch.setattr(S, "get_backend", lambda: _FakeBackend(unsure))
    F._BY_REQUEST.clear()
    llm = _CountingLLM()
    res = await classify_user_intent("maybe forecast?", "standard", llm)
    assert llm.calls == 1 and res.mode == "standard"
