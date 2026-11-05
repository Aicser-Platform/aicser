"""Phase 3 server side: signed on-device model catalog, and tuning examples from approved runs."""

from __future__ import annotations

import base64
import json
import types

import pytest

from src.modules.agent import device_models as DM
from src.modules.agent import policy as P
from src.modules.agent import tuning as T

GOOD = {"id": "planner-small", "name": "Planner (small)", "role": "planner", "url": "https://models.example/p.gguf",
        "sha256": "a" * 64, "size_bytes": 2_000_000_000, "license": "Apache-2.0", "min_ram_gb": 8}


def test_catalog_is_empty_until_the_operator_configures_it(monkeypatch):
    monkeypatch.delenv("AISER_DEVICE_MODEL_CATALOG", raising=False)
    assert DM.load_catalog() == []


def test_catalog_loads_inline_or_from_a_file(monkeypatch, tmp_path):
    monkeypatch.setenv("AISER_DEVICE_MODEL_CATALOG", json.dumps({"models": [GOOD]}))
    assert [m["id"] for m in DM.load_catalog()] == ["planner-small"]
    f = tmp_path / "catalog.json"
    f.write_text(json.dumps([GOOD]))
    monkeypatch.setenv("AISER_DEVICE_MODEL_CATALOG", str(f))
    assert DM.load_catalog()[0]["min_vram_gb"] == 0.0


@pytest.mark.parametrize("bad", [
    {**GOOD, "sha256": "nothex"}, {**GOOD, "url": "http://insecure/p.gguf"}, {**GOOD, "role": "chat"},
    {k: v for k, v in GOOD.items() if k != "license"},
])
def test_an_invalid_entry_rejects_the_catalog(monkeypatch, bad):
    monkeypatch.setenv("AISER_DEVICE_MODEL_CATALOG", json.dumps([bad]))
    assert DM.load_catalog() == []


def test_org_narrows_the_catalog_and_the_desktop_can_verify_it():
    second = {**GOOD, "id": "screen-small", "role": "screen"}
    models = [DM._validate(GOOD), DM._validate(second)]
    assert [m["id"] for m in DM.allowed_for(models, {"allowed_models": ["screen-small"]})] == ["screen-small"]
    assert len(DM.allowed_for(models, {})) == 2
    signed = DM.signed_catalog(models, organization_id="o1")
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    key = Ed25519PublicKey.from_public_bytes(base64.b64decode(signed["public_key"]))
    key.verify(base64.b64decode(signed["signature"]), signed["signed_json"].encode())  # raises if tampered
    assert json.loads(signed["signed_json"]) == signed["catalog"]


def test_policy_keeps_allowed_models_and_the_tuning_opt_in():
    clean = P._clean({"device": {"allowed_models": ["b", "a", "a"]}, "tuning_opt_in": True})
    assert clean["device"]["allowed_models"] == ["a", "b"] and clean["tuning_opt_in"] is True
    assert P._clean({})["tuning_opt_in"] is False


def _run(messages, answer="Revenue rose 12%."):
    return types.SimpleNamespace(id="r1", agent_version="2", result={"answer": answer}, messages=messages)


def test_tuning_example_keeps_the_work_and_shortens_tool_replies():
    msgs = [{"role": "user", "content": "Revenue by month"},
            {"role": "assistant", "content": "Querying.", "tool_calls": [{"id": "c1", "type": "function",
                                                                          "function": {"name": "run_query", "arguments": "{}"}}]},
            {"role": "tool", "tool_call_id": "c1", "content": "x" * 5000}]
    ex = T.example_from_run(_run(msgs))
    roles = [m["role"] for m in ex["messages"]]
    assert roles == ["system", "user", "assistant", "tool", "assistant"]
    assert len(ex["messages"][3]["content"]) == T.TOOL_REPLY_CHARS
    assert ex["messages"][-1]["content"] == "Revenue rose 12%."


def test_runs_without_an_answer_or_with_folded_steps_are_skipped():
    assert T.example_from_run(_run([{"role": "user", "content": "x"}], answer="")) is None
    assert T.example_from_run(_run([{"role": "user", "content": "[Notes on the work so far] ..."}])) is None
