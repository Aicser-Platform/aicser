"""Prepare's health score drops for each open issue, so fixing one raises it."""

from src.modules.prep.engine.profile_models import AssetProfile, ColumnProfile, KeyCandidate
from src.modules.prep.engine.scoring import health_score, health_with_findings


def _profile() -> AssetProfile:
    return AssetProfile(
        row_count=100,
        columns=[ColumnProfile(name="id", storage_type="BIGINT", inferred_type="bigint", inference_confidence=1.0)],
        key_candidates=[KeyCandidate(column="id", distinct_ratio=1.0, duplicate_count=0, is_unique=True)],
    )


def test_open_findings_lower_the_score():
    base = health_score(_profile())
    findings = [{"severity": "warning"}, {"severity": "warning"}, {"severity": "info"}]
    assert health_with_findings(_profile(), findings) == base - 11


def test_fixing_findings_raises_the_score():
    before = health_with_findings(_profile(), [{"severity": "warning"}, {"severity": "info"}])
    after = health_with_findings(_profile(), [{"severity": "info"}])
    assert after > before


def test_score_never_goes_below_zero():
    assert health_with_findings(_profile(), [{"severity": "error"}] * 20) == 0
