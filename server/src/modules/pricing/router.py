"""Community Edition pricing API."""

from __future__ import annotations

from fastapi import APIRouter

from src.modules.pricing.plans import PLAN_CONFIGS, get_plan_config

router = APIRouter()


@router.get("/plans")
async def list_plans():
    return {"plans": PLAN_CONFIGS, "edition": "community"}


@router.get("/current")
async def current_plan():
    from src.core.deployment_mode import is_self_host_deployment
    from src.core.edition import is_ee_enabled
    if is_self_host_deployment() and is_ee_enabled():
        return {
            "plan": "enterprise",
            "config": get_plan_config("enterprise"),
            "edition": "enterprise",
            "managed_ai": False,
            "ai_usage_policy": "bring_your_own_provider_key",
        }
    return {
        "plan": "free",
        "config": get_plan_config("free"),
        "edition": "community",
        "managed_ai": False,
        "ai_usage_policy": "bring_your_own_provider_key",
    }
