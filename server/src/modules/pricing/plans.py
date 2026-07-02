"""Community Edition pricing plan defaults.

CE has no billing backend. These helpers provide the small API surface used by
shared CE routes while treating the instance as a free/community plan.
"""

from __future__ import annotations

from typing import Any, Dict

PLAN_CONFIGS: Dict[str, Dict[str, Any]] = {
    "free": {
        "name": "Community",
        "price_monthly": 0,
        "price_yearly": 0,
        # CE does not include Aicser-managed AI credits. Users can connect
        # their own provider keys in Settings -> API Keys.
        "ai_credits_limit": 0,
        "max_projects": -1,
        "max_users": -1,
        "max_data_sources": -1,
        "storage_limit_gb": -1,
        "data_history_days": -1,
        "included_seats": -1,
        "additional_seat_price": 0,
        "api_calls_per_month": -1,
        "ai_credit_max_per_request": 0,
        "features": {
            "watermark": True,
            "theme_customization": False,
            "api_access": True,
            "provider_ai_keys": True,
            "managed_ai_credits": False,
            "white_label": False,
            "collaboration": False,
            "advanced_collaboration": False,
            "advanced_ai": False,
            "cross_source_analytics": True,
            "team_governance": False,
            "priority_support": False,
            "dedicated_support": False,
            "on_premise": False,
            "compliance": False,
            "sla": False,
            "export_formats": ["png"],
            "scheduled_reports": False,
            "platform_services": False,
            "spark_query_engine": False,
            "bi_sync": False,
            "catalog": False,
            "lakehouse": False,
            "streaming": False,
            "alerts": False,
            "pivot_table": False,
        },
    }
}


def get_plan_config(plan_type: str | None) -> Dict[str, Any]:
    return PLAN_CONFIGS.get((plan_type or "free").lower(), PLAN_CONFIGS["free"])


def is_feature_available(plan_type: str | None, feature: str) -> bool:
    return bool(get_plan_config(plan_type).get("features", {}).get(feature, False))


def get_plan_limits(plan_type: str | None) -> Dict[str, Any]:
    config = get_plan_config(plan_type)
    return {
        "ai_credits_limit": config["ai_credits_limit"],
        "ai_credits_per_user_limit": config.get("ai_credits_per_user_limit"),
        "max_projects": config["max_projects"],
        "max_users": config["max_users"],
        "max_data_sources": config["max_data_sources"],
        "storage_limit_gb": config["storage_limit_gb"],
        "data_history_days": config.get("data_history_days"),
        "included_seats": config.get("included_seats"),
        "additional_seat_price": config.get("additional_seat_price"),
    }
