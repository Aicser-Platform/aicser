"""A 402 names the plan to upgrade to. It used to say "pro" for every feature, so a Free org
told to buy Pro for alerts (a Team feature) was still locked out after upgrading."""

import pytest

from src.modules.pricing.plans import PLAN_CONFIGS, minimum_plan_for_feature


@pytest.mark.parametrize(
    "feature, plan",
    [("alerts", "team"), ("lakehouse", "pro"), ("ml_models", "pro"), ("audit_logs", "enterprise"), ("api_access", "free")],
)
def test_lowest_plan_that_includes_the_feature(feature, plan):
    assert minimum_plan_for_feature(feature) == plan


def test_named_plan_actually_unlocks_the_feature():
    for feature in {f for cfg in PLAN_CONFIGS.values() for f in cfg.get("features", {})}:
        plan = minimum_plan_for_feature(feature)
        if PLAN_CONFIGS[plan]["features"].get(feature):
            assert all(not PLAN_CONFIGS[p]["features"].get(feature) for p in list(PLAN_CONFIGS)[: list(PLAN_CONFIGS).index(plan)])


def test_unknown_feature_points_at_enterprise():
    assert minimum_plan_for_feature("no_such_feature") == "enterprise"
