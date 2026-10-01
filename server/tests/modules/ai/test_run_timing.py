"""Learned per-mode durations drive the UI's expectation-setting."""

import src.core.cache as core_cache
from ee.modules.ai.utils import run_timing as rt


class _Cache(dict):
    def get(self, k, d=None):
        return dict.get(self, k, d)

    def set(self, k, v, ttl=None):
        self[k] = v
        return True


def test_hint_needs_enough_runs_and_uses_org_then_global(monkeypatch):
    monkeypatch.setattr(core_cache, "cache", _Cache())
    for d in (10, 12, 11):
        rt.record_run("org1", "decision_intelligence", d)
    assert rt.timing_hint("org1", "decision_intelligence") is None
    for d in (30, 9, 13, 12):
        rt.record_run("org1", "decision_intelligence", d)
    hint = rt.timing_hint("org1", "decision_intelligence")
    assert hint == {"expected_s": 12, "slow_s": 13, "samples": 7}  # one 30 s outlier is not "usual"
    assert rt.timing_hint("org1", "animate") is None


def test_window_keeps_recent_runs(monkeypatch):
    monkeypatch.setattr(core_cache, "cache", _Cache())
    for _ in range(60):
        rt.record_run(None, "standard", 5)
    assert rt.timing_hint("any-org", "standard")["samples"] == 40
