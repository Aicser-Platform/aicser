"""Front door: one decision call per request answers what, how much and whether to clarify;
the three-band policy (act / surface / escalate) decides what may drive behaviour; and
calibration scores confidence against agreement and real outcomes."""

import pytest

from ee.modules.ai.decisions import backends as B
from ee.modules.ai.decisions import calibration as C
from ee.modules.ai.decisions import front_door as F
from ee.modules.ai.decisions import service as S


class _Fake(B.DecisionBackend):
    name = "jev"

    def __init__(self, answers):
        self.answers, self.calls = answers, 0

    async def decide(self, state, qset, timeout_s):
        self.calls += 1
        return B.normalise_answers({"answers": self.answers}, qset), {"cost": 0.0}


def _choice(dist, conf):
    return {"probabilities": dist, "confidence": conf}


@pytest.fixture(autouse=True)
def _env(monkeypatch):
    monkeypatch.setattr(S, "_schedule_log", lambda *a, **k: None)
    import src.core.cache as cache_mod
    monkeypatch.setattr(cache_mod, "cache", None)
    monkeypatch.setenv("DECISION_LAYER_BACKEND", "jev")
    monkeypatch.setenv("DECISION_LAYER_MODES", '{"front_door": "primary"}')
    monkeypatch.setenv("DECISION_THRESHOLDS", '{"front_door": 0.85}')
    F._BY_REQUEST.clear()


def _use(monkeypatch, answers, rid="req-1"):
    fake = _Fake(answers)
    monkeypatch.setattr(S, "get_backend", lambda: fake)
    monkeypatch.setattr(F, "_request_identity", lambda: {"organization_id": None, "user_id": None, "request_id": rid})
    return fake


@pytest.mark.asyncio
async def test_bands_act_surface_escalate(monkeypatch):
    _use(monkeypatch, {
        "strategy": _choice({"direct_answer": 0.92, "analysis": 0.05, "chat_only": 0.03}, 0.92),
        "mode": _choice({"standard": 0.6, "diagnostic": 0.4}, 0.6),
        "difficulty": {"score": 0, "confidence": 0.9},
        "needs_clarification": {"noul": 0.7},   # 0.7 confidence: surface -> a flag must not act
        "wants_fresh": {"noul": 0.02},          # confident "no"
    })
    plan = await F.front_door_plan("User request: total sales last month")
    assert plan.strategy == "direct_answer" and plan.strategy_band == "act"
    assert plan.mode == "standard" and plan.mode_band == "surface"
    assert plan.difficulty == "simple" and plan.effort_budget == 1
    assert plan.needs_clarification is None and plan.wants_fresh is False
    assert plan.strategy_runner_up == "analysis"


@pytest.mark.asyncio
async def test_escalate_leaves_fields_empty_and_off_returns_none(monkeypatch):
    _use(monkeypatch, {"strategy": _choice({"agent": 0.4, "analysis": 0.35, "chat_only": 0.25}, 0.4)})
    plan = await F.front_door_plan("x")
    assert plan.strategy is None and plan.strategy_band == "escalate"
    monkeypatch.setenv("DECISION_LAYER_MODES", '{"front_door": "shadow"}')
    F._BY_REQUEST.clear()
    assert await F.front_door_plan("x") is None


@pytest.mark.asyncio
async def test_one_call_per_request_shared_by_supervisor_and_classifier(monkeypatch):
    fake = _use(monkeypatch, {
        "strategy": _choice({"analysis": 0.95, "direct_answer": 0.05}, 0.95),
        "mode": _choice({"predictive": 0.7, "standard": 0.3}, 0.7),
        "needs_chart": {"noul": 0.97}, "needs_narrative": {"noul": 0.96},
    })
    await F.front_door_plan("state from supervisor")
    verdict = await F.front_door_primary("state from classifier")
    assert fake.calls == 1
    # Mode was only plausible (0.7): usable, but surfaced for confirmation with the runner-up.
    assert verdict["mode"] == "predictive" and verdict["mode_band"] == "surface"
    assert verdict["alternatives"] == ["standard"]


def test_state_carries_constraints_errors_and_cache_hint():
    s = F.build_front_door_state(
        "forecast revenue", data_context="warehouse", constraints=["analysis mode: auto"],
        error_history=["timeout on narrative"], cache_hint="same question answered 5 min ago",
    )
    for part in ("Constraints: analysis mode: auto", "Earlier attempts failed: timeout on narrative",
                 "Previous answer available", "User request: forecast revenue"):
        assert part in s


def test_calibration_scores_against_agreement_and_outcomes(monkeypatch):
    monkeypatch.setenv("DECISION_CALIBRATION_MIN_SAMPLES", "10")
    good = [{"question_set": "front_door", "question_key": "mode", "confidence": 0.95, "agrees": True}] * 19
    good += [{"question_set": "front_door", "question_key": "mode", "confidence": 0.95, "agrees": False}]
    over = [{"question_set": "front_door", "question_key": "strategy", "confidence": 0.95, "used": True,
             "outcome": {"decision": "approved", "feedback": "dislike"}}] * 12
    res = C.calibration_from_rows(good + over)
    assert res["front_door.mode"]["status"] == "ok" and res["front_door.mode"]["ece"] <= 0.05
    assert res["front_door.strategy"]["status"] == "drift"  # 95% confident, users disliked every answer
    assert C.row_correct({"used": True, "outcome": {"decision": "approved"}}) is True
    assert C.row_correct({"used": True, "outcome": {"decision": "degraded_pass"}}) is False
    assert C.row_correct({}) is None
