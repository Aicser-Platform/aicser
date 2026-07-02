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
    return {
        "plan": "free",
        "config": get_plan_config("free"),
        "edition": "community",
        "managed_ai": False,
        "ai_usage_policy": "bring_your_own_provider_key",
    }
