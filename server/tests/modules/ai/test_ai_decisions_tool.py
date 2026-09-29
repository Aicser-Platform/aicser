"""AI Decisions: distinct-value reduction, bands, validation, PII scrubbing by default,
both backends (decision model / LLM fallback), and export joining answers back to rows."""

import csv
import io

import pytest

from ee.modules.ai.decisions import backends as B
from ee.modules.ai.decisions import tool_service as T


ROWS = [
    {"id": 1, "note": "Please refund my order"},
    {"id": 2, "note": "please  refund my ORDER"},  # same text after normalisation
    {"id": 3, "note": "Where is my parcel?"},
    {"id": 4, "note": ""},
]


def test_distinct_texts_collapse_rows_and_skip_empties():
    d = T.distinct_texts(ROWS, ["note"])
    assert len(d) == 2
    first_key = next(iter(d))
    assert d[first_key] == ("Please refund my order", 2)


def test_validation_and_bands():
    with pytest.raises(T.DecisionToolError):
        T.validate_definition("choice", "Which topic?", {"refund": "x"})
    with pytest.raises(T.DecisionToolError):
        T.validate_definition("maybe", "x", {})
    T.validate_definition("noul", "Is this a refund request?", {})
    assert T.band_for(0.9, 0.85) == "act" and T.band_for(0.6, 0.85) == "surface"
    assert T.band_for(0.3, 0.85) == "escalate" and T.band_for(None, 0.85) == "escalate"


def test_cost_estimate_counts_distinct_texts_only():
    q = T.question_set_for("noul", "Is this a refund request?", {}, 1)
    est = T.estimate_cost(["a" * 400, "b" * 400], q, "jev")
    assert est["input_tokens"] > 200 and est["estimated_cost"] is not None


def test_export_joins_answers_back_to_every_row_and_prefers_review():
    d = T.distinct_texts(ROWS, ["note"])
    k_refund, k_parcel = list(d)
    answers = {
        k_refund: {"value": "false", "confidence": 0.55, "band": "surface", "reviewed_value": "true"},
        k_parcel: {"value": "false", "confidence": 0.97, "band": "act", "reviewed_value": None},
    }
    out = list(csv.reader(io.StringIO(T.export_csv(ROWS, ["note"], answers, "Refund request?"))))
    assert out[0][-3:] == ["refund_request", "refund_request_confidence", "refund_request_needs_review"]
    by_id = {r[0]: r for r in out[1:]}
    assert by_id["1"][-3] == "true" and by_id["2"][-3] == "true"  # reviewer's correction wins
    assert by_id["3"][-3] == "false" and by_id["3"][-1] == ""
    assert by_id["4"][-3] == ""  # empty text: no decision


class _FakeJev(B.DecisionBackend):
    name = "jev"

    async def decide(self, state, qset, timeout_s):
        p = 0.95 if "refund" in state.lower() else 0.1
        return B.normalise_answers({"answers": {"answer": {"noul": p}}}, qset), {"cost": 0.0001}


@pytest.mark.asyncio
async def test_classify_with_decision_model(monkeypatch):
    monkeypatch.setattr(T, "get_backend", lambda: _FakeJev())
    q = T.question_set_for("noul", "Is this a refund request?", {}, 1)
    out = await T.classify_texts([("a", "Please refund"), ("b", "Where is my parcel")], q)
    assert out["a"].value == "true" and out["a"].confidence >= 0.95 and out["a"].source == "jev"
    assert out["b"].value == "false" and out["a"].cost == 0.0001


@pytest.mark.asyncio
async def test_llm_fallback_parses_and_rejects_invalid_options(monkeypatch):
    monkeypatch.setattr(T, "get_backend", lambda: B.DecisionBackend())  # "off"
    replies = iter(['{"value": "billing", "confidence": 0.8}', '{"value": "astrology", "confidence": 0.99}'])

    class _Svc:
        async def generate_completion(self, **kw):
            assert "<record>" in kw["prompt"]  # row text is fenced as data
            return {"success": True, "content": next(replies)}

    monkeypatch.setattr(T._LLMClassifier, "_service", lambda self: _Svc())
    q = T.question_set_for("choice", "Which topic?", {"billing": "money", "shipping": "delivery"}, 1)
    out = await T.classify_texts([("a", "charged twice")], q)
    assert out["a"].value == "billing" and out["a"].source == "llm"
    out = await T.classify_texts([("b", "stars")], q)
    assert out["b"].value is None and out["b"].confidence is None


@pytest.mark.asyncio
async def test_preview_scrubs_by_default_and_reports_counts(monkeypatch):
    seen = []

    async def rows(*a, **k):
        return [{"note": "Refund to jane@example.com"}, {"note": "Refund to jane@example.com"}, {"note": "late"}]

    async def classify(items, qset, **k):
        seen.extend(t for _, t in items)
        return {key: T.Answer("true", 0.9, "jev") for key, _ in items}

    monkeypatch.setattr(T, "load_rows", rows)
    monkeypatch.setattr(T, "classify_texts", classify)
    monkeypatch.setattr(T, "scrub", lambda t, personal=False: t.replace("jane@example.com", "[EMAIL]"))

    class _Def:
        question_type, instructions, criteria, version, threshold, allow_raw_text = "noul", "Refund?", {}, 1, 0.85, False

    res = await T.preview(_Def, user_id="u", organization_id="o", data_source_id="d", sql="SELECT note FROM t",
                          text_columns=["note"])
    assert res["row_count"] == 3 and res["distinct_count"] == 2
    assert all("jane@example.com" not in t for t in seen) and "[EMAIL]" in seen[0]
    assert res["rows"][0]["rows"] == 2 and res["rows"][0]["band"] == "act"


def _record_keep(monkeypatch):
    from src.modules.data.services import pii_scrubber as P

    seen = {}

    def fake(text, keep_entities=frozenset()):
        seen[text] = keep_entities
        return text

    monkeypatch.setattr(P.pii_scrubber, "scrub_text", fake)
    return seen


def test_scrub_keeps_places_and_organisations_as_context(monkeypatch):
    seen = _record_keep(monkeypatch)
    T.scrub("Customer called about a broken fridge delivered to Kampot by Acme")
    keep = seen["Customer called about a broken fridge delivered to Kampot by Acme"]
    assert {"LOCATION", "ORGANIZATION", "NRP", "DATE_TIME"} <= keep
    assert "PERSON" not in keep  # names in prose are still masked


def test_short_label_values_skip_name_detection_unless_column_is_personal(monkeypatch):
    seen = _record_keep(monkeypatch)
    T.scrub("Siem Reap")
    assert "PERSON" in seen["Siem Reap"]  # a label, not a person
    T.scrub("John Smith", personal_columns=True)
    assert "PERSON" not in seen["John Smith"]


def test_personal_columns_are_recognised_by_name():
    assert T.has_personal_columns(["customer_name"])
    assert T.has_personal_columns(["email"])
    assert not T.has_personal_columns(["province"])
    assert not T.has_personal_columns(["province_name", "product_name"])


def test_training_rows_trust_reviews_then_confident_answers_only():
    from ee.modules.ai.decisions import tool_service as TS

    rows = [
        {"id": 1, "msg": "Package arrived broken", "region": "N"},
        {"id": 2, "msg": "Thanks, quick delivery", "region": "S"},
        {"id": 3, "msg": "Where is my order?", "region": "N"},
        {"id": 4, "msg": "", "region": "S"},
    ]
    key = lambda t: TS.text_key(t)  # noqa: E731
    answers = {
        key("Package arrived broken"): {"value": "true", "band": "act", "reviewed_value": None},
        key("Thanks, quick delivery"): {"value": "true", "band": "surface", "reviewed_value": "false"},
        key("Where is my order?"): {"value": "false", "band": "surface", "reviewed_value": None},
    }
    out, stats = TS.training_rows(rows, ["msg"], answers, "complaint")
    assert [(r["id"], r["complaint"]) for r in out] == [(1, "true"), (2, "false")]
    assert stats == {"reviewed": 1, "confident": 1, "skipped": 2}
    assert out[0]["region"] == "N" and out[0]["msg"] == "Package arrived broken"


def test_column_advice_flags_ids_and_structured_only_data():
    from ee.modules.ai.decisions import tool_service as TS

    rows = [{"customer_id": f"C{i}", "plan": "basic" if i % 2 else "pro", "tenure": i % 60, "fee": 10 + i * 0.37,
             "note": "customer called twice about a late refund and sounded upset" if i % 3 else "happy with the service overall"}
            for i in range(200)]
    kinds = {a["kind"]: a for a in TS.column_advice(rows, ["customer_id", "plan", "tenure", "fee"])}
    assert kinds["identifier_columns"]["columns"] == ["customer_id"]
    assert "structured_only" in kinds
    assert TS.column_advice(rows, ["note"]) == []


def test_scrub_row_masks_names_only_in_personal_columns():
    from ee.modules.ai.decisions import tool_service as TS

    text = "customer_name: Dara Sok\nregion: Kandal"
    out = TS.scrub_row(text, ["customer_name", "region"])
    assert "region: Kandal" in out


def test_review_quality_measures_agreement_per_band():
    from ee.modules.ai.decisions.tool_service import review_quality

    rows = ([{"value": "a", "reviewed_value": "a", "band": "act", "confidence": 0.95}] * 18
            + [{"value": "a", "reviewed_value": "b", "band": "act", "confidence": 0.95}] * 2
            + [{"value": "b", "reviewed_value": "a", "band": "surface", "confidence": 0.6}] * 5
            + [{"value": "b", "reviewed_value": None, "band": "surface", "confidence": 0.6}] * 7)
    q = review_quality(rows)
    assert q["reviewed"] == 25 and q["agreed"] == 18 and q["status"] == "measured"
    assert q["by_band"]["act"]["agreement"] == 0.9 and q["by_band"]["surface"]["agreement"] == 0.0
    assert q["interval"][0] < 0.72 < q["interval"][1]
    assert q["overconfidence"] > 0 and q["corrections"][0] == {"change": "b → a", "count": 5}
    assert review_quality([])["status"] == "insufficient"


@pytest.mark.asyncio
async def test_notebook_rows_are_decided_once_per_text_scrubbed_and_joined_back(monkeypatch):
    seen = []

    async def classify(items, qset, **k):
        seen.extend(t for _, t in items)
        return {key: T.Answer("true" if "refund" in t.lower() else "false", 0.9 if "refund" in t.lower() else 0.6, "jev")
                for key, t in items}

    class _Clf:
        name = "jev"

    async def clf(org):
        return _Clf()

    monkeypatch.setattr(T, "classify_texts", classify)
    monkeypatch.setattr(T, "classifier_for", clf)
    monkeypatch.setattr(T, "scrub", lambda t, personal=False: t.replace("jane@example.com", "[EMAIL]"))

    class _Def:
        question_type, instructions, criteria, version, threshold, allow_raw_text = "noul", "Refund?", {}, 1, 0.85, False

    rows = [{"note": "Refund to jane@example.com"}, {"note": "refund to jane@example.com"}, {"note": "late"}, {"note": ""}]
    out = await T.decide_rows(_Def, rows, ["note"], organization_id="o")
    assert len(seen) == 2 and all("jane@example.com" not in t for t in seen)
    assert [r["value"] for r in out["results"]] == ["true", "true", "false", None]
    assert [r["band"] for r in out["results"]] == ["act", "act", "surface", None]

    monkeypatch.setattr(T, "max_inline_distinct", lambda: 1)
    with pytest.raises(T.DecisionToolError, match="Start a run"):
        await T.decide_rows(_Def, rows, ["note"], organization_id="o")
