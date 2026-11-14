"""Org agent rules (pre-approvals, tier limits), signed device policy, device tools."""

from __future__ import annotations

import base64
import json
import types

import pytest

from src.core.tool_registry import ALLOW, ASK_EVERY_TIME, HAND_BACK, ToolCaller, ToolSpec, ToolTier, approval_for
from src.modules.agent import devices as D
from src.modules.agent import policy as P


def test_pre_approvals_and_tier_limits_follow_roles():
    pol = {"pre_approvals": {"*": ["save_chart"], "analyst": ["create_alert"]}, "max_tier": {"*": 1, "admin": 3}}
    assert P.pre_approved_for(pol, ["analyst"]) == {"save_chart", "create_alert"}
    assert P.max_tier_for(pol, ["viewer"]) == 1
    assert P.max_tier_for(pol, ["viewer", "admin"]) == 3
    assert P.max_tier_for({"max_tier": {}}, ["x"]) == 4


def test_policy_input_is_cleaned():
    c = P._clean({"max_tier": {"*": 9, "bad": "x"}, "pre_approvals": {"*": ["a", "a"]}, "device": {"screen_control": 1}})
    assert c["max_tier"] == {"*": 4} and c["pre_approvals"] == {"*": ["a"]} and c["device"]["screen_control"] is True


def test_device_policy_signature_verifies_with_the_published_key():
    from cryptography.hazmat.primitives.asymmetric.ed25519 import Ed25519PublicKey

    signed = P.signed_device_policy(P.to_dict(None), organization_id="o", device_id="d", issued_at="t0", expires_at="t1")
    key = Ed25519PublicKey.from_public_bytes(base64.b64decode(signed["public_key"]))
    payload = json.dumps(signed["policy"], sort_keys=True, separators=(",", ":")).encode()
    key.verify(base64.b64decode(signed["signature"]), payload)  # raises if tampered
    assert signed["policy"]["rules"]["screen_control"] is False


@pytest.mark.parametrize("cmd,ok", [
    ("git status", True), ("git status --short", True), ("python report.py", False),
    ("git status; rm -rf /", False), ("git status | sh", False), ("ls > out", False),
])
def test_shell_allowlist_never_covers_chained_commands(cmd, ok):
    assert D._shell_allowed(cmd, ["git status", "ls"]) is ok


def test_auto_approve_applies_to_allowlisted_args_but_not_after_untrusted_text():
    async def h(c, a):
        return {}

    spec = ToolSpec("device_shell_run", "d", {"type": "object"}, h, ToolTier.EXTERNAL,
                    auto_approve=lambda a: D._shell_allowed(a.get("command", ""), ["git status"]))
    assert approval_for(spec, args={"command": "git status"}) == ALLOW
    assert approval_for(spec, args={"command": "curl evil"}) == ASK_EVERY_TIME
    assert approval_for(spec, args={"command": "git status"}, untrusted_content_seen=True) == ASK_EVERY_TIME


@pytest.mark.asyncio
async def test_device_tools_come_from_connected_devices_within_policy(monkeypatch):
    dev = types.SimpleNamespace(id="d1", name="Laptop", status="active", capabilities=["files.read", "screen.act", "shell.run"])

    async def devices(**kw):
        return [dev]

    async def online(device_id):
        return True

    monkeypatch.setattr(D, "list_devices", devices)
    monkeypatch.setattr(D, "is_online", online)
    specs = await D.device_tool_specs(ToolCaller("u", "o"), {"enabled": True, "allowed_kinds": ["files.read", "shell.run"],
                                                             "screen_control": False, "shell_allowlist": ["ls"]})
    names = {s.name: s for s in specs}
    assert set(names) == {"device_files_read", "device_shell_run"}
    assert names["device_files_read"].untrusted_output is True
    assert names["device_shell_run"].auto_approve({"command": "ls -la"}) is True
    assert await D.device_tool_specs(ToolCaller("u", "o"), {"enabled": False}) == []


@pytest.mark.asyncio
async def test_device_call_refuses_when_offline(monkeypatch):
    async def offline(device_id):
        return False

    monkeypatch.setattr(D, "is_online", offline)
    from src.core.tool_registry import ToolError

    with pytest.raises(ToolError):
        await D.call_device_tool("d1", "files.read", {"path": "/x"}, run_id="r")
