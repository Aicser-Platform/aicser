from ee.modules.pricing.plans import PLAN_CONFIGS, is_feature_available
from ee.modules.pricing.sku_catalog import SKU_CATALOG, sku_catalog_payload


def test_sku_catalog_has_core_and_addons():
    ids = {s["id"] for s in SKU_CATALOG}
    assert {"kernel", "analyze", "ask", "govern", "operate", "decide", "platform", "channel", "industry"} <= ids
    payload = sku_catalog_payload()
    assert "Add-ons" in payload["rule"]


def test_govern_is_team_and_enterprise_only():
    assert is_feature_available("free", "govern") is False
    assert is_feature_available("pro", "govern") is False
    assert is_feature_available("team", "govern") is True
    assert is_feature_available("enterprise", "govern") is True


def test_operate_and_channel_flags_exist():
    for slug in ("team", "enterprise"):
        feats = PLAN_CONFIGS[slug]["features"]
        assert feats["operate"] is True
        assert feats["slack_teams"] is True
        assert feats["industry_packs"] is True
        assert feats["ai_cost_center"] is True
        assert feats["embed_isv"] is True
