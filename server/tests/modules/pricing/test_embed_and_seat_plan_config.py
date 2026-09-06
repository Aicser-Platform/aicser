"""Regression tests for the embed-analytics and viewer/editor-seat plan
config added to ee/modules/pricing/plans.py.

Context: embed token creation/management previously had zero plan gating —
enforce_permission only checks RBAC role (is this user an admin in their
org), never subscription tier, so a Free-org admin could mint unlimited
white-labeled embed tokens identical to a paid org's. Separately, Team-plan
seat billing charged every additional member at the same flat rate
regardless of role, even though Aicser's RBAC already models a read-only
org_viewer role distinct from org_owner/org_admin/org_member — industry
practice (Tableau, Domo, Looker) prices read-only seats far below build/edit
seats since real orgs run many more viewers than builders.
"""

from ee.modules.pricing.plans import PLAN_CONFIGS, get_plan_config, get_plan_limits, is_feature_available


def test_free_has_no_embed_access():
    assert is_feature_available("free", "embed_analytics") is False
    assert is_feature_available("free", "embed_white_label") is False
    assert get_plan_limits("free")["embed_views_limit"] == 0


def test_pro_has_branded_embed_but_not_white_label():
    """Pro gets embedding at all -- a real differentiator below every
    competitor's embedding price floor (cheapest dedicated white-label
    embed tool researched, Metabase, starts at $575/mo) -- but the Aicser
    badge stays, matching the 'branded embed on the entry paid tier, white-
    label on the team tier' structure."""
    assert is_feature_available("pro", "embed_analytics") is True
    assert is_feature_available("pro", "embed_white_label") is False
    assert get_plan_limits("pro")["embed_views_limit"] == 5000


def test_team_has_white_label_embed():
    assert is_feature_available("team", "embed_analytics") is True
    assert is_feature_available("team", "embed_white_label") is True
    assert get_plan_limits("team")["embed_views_limit"] == 50000


def test_enterprise_embed_is_unlimited():
    assert is_feature_available("enterprise", "embed_analytics") is True
    assert is_feature_available("enterprise", "embed_white_label") is True
    assert get_plan_limits("enterprise")["embed_views_limit"] == -1


def test_embed_views_limit_scales_up_with_plan_tier():
    """Free -> Pro -> Team -> unlimited must be strictly increasing, matching
    every other metered dimension (ai_credits_limit, storage_limit_gb) --
    a regression here would mean a paid tier is more restrictive than a
    cheaper one, which is its own kind of bug."""
    free = get_plan_limits("free")["embed_views_limit"]
    pro = get_plan_limits("pro")["embed_views_limit"]
    team = get_plan_limits("team")["embed_views_limit"]
    enterprise = get_plan_limits("enterprise")["embed_views_limit"]

    assert free < pro < team
    assert enterprise == -1  # unlimited, not just "a bigger number"


def test_team_viewer_seats_priced_well_below_editor_seats():
    team = get_plan_config("team")
    editor_price = team["additional_seat_price"]
    viewer_price = team["additional_viewer_seat_price"]

    assert viewer_price > 0
    assert viewer_price < editor_price, (
        "Viewer (read-only) seats must be cheaper than editor seats -- "
        "that's the entire point of splitting the pricing"
    )


def test_team_includes_a_generous_viewer_seat_allowance():
    """A tight viewer allowance defeats the purpose -- the whole strategy is
    letting orgs roll out read-only access broadly without hitting the
    editor-seat wall (industry precedent: Domo's cheap Viewer licenses vs
    limited paid Administrator seats)."""
    team = get_plan_config("team")
    assert team["included_viewer_seats"] > team["included_seats"]


def test_enterprise_seats_and_views_are_unlimited_not_just_large():
    ent = get_plan_config("enterprise")
    assert ent["included_seats"] == -1
    assert ent["included_viewer_seats"] == -1
    assert ent["embed_views_limit"] == -1


def test_every_tier_defines_every_new_key():
    """A tier silently missing one of these keys would fall back to
    PLAN_CONFIGS['free']'s value via .get() with no default in some call
    sites -- catch that at config-definition time, not at runtime."""
    required_keys = {
        "embed_views_limit",
        "included_viewer_seats",
        "additional_viewer_seat_price",
    }
    for slug, config in PLAN_CONFIGS.items():
        missing = required_keys - set(config.keys())
        assert not missing, f"Plan '{slug}' is missing keys: {missing}"

    required_features = {"embed_analytics", "embed_white_label"}
    for slug, config in PLAN_CONFIGS.items():
        missing = required_features - set(config.get("features", {}).keys())
        assert not missing, f"Plan '{slug}' features dict is missing: {missing}"
