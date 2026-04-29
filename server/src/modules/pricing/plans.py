"""
Pricing Plan Configuration
Defines all plan tiers and their features/limits
"""

from typing import Dict, Any


DEFAULT_AI_MODEL_MULTIPLIERS = {
    "gpt-5": 1.5,
    "gpt-4.1": 1.5,
    "gpt-4o": 1.0,
    "gpt-4o-mini": 1.0,
    "gpt-4": 1.5,
    "claude-3-sonnet": 2.0,
    "claude-3-haiku": 1.0,
    "claude-3-opus": 3.0,
    "auto": 1.25,
}

DEFAULT_AI_ANALYSIS_MULTIPLIERS = {
    "chat": 0.3,
    "conversational": 0.3,
    "descriptive": 0.5,
    "standard": 0.5,
    "diagnostic": 1.0,
    "predictive": 1.0,
    "animate": 1.0,
    "deep": 1.0,
    "prescriptive": 1.5,
    "executive_report": 1.0,
    "executive_report_brief": 1.0,
    "executive_report_standard": 1.5,
    "executive_report_comprehensive": 2.0,
}

# Canonical AI mode entitlements used by API-level feature gates
FREE_ALLOWED_AI_MODES = ["chat", "descriptive", "predictive", "animate"]
PAID_ALLOWED_AI_MODES = [
    "chat",
    "descriptive",
    "predictive",
    "diagnostic",
    "prescriptive",
    "animate",
    "executive_report",
    "deep",
]

DEFAULT_AI_DATASET_TIERS = [
    # Dataset-size add-on credits (applied once per request).
    # Note: Per-request caps still apply (ai_credit_max_per_request), so very large datasets may hit the cap on lower tiers.
    {"threshold_bytes": 1 * 1024 * 1024 * 1024 * 1024, "credits": 12},  # >1TB
    {"threshold_bytes": 1 * 1024 * 1024 * 1024, "credits": 6},          # >1GB
    {"threshold_bytes": 500 * 1024 * 1024, "credits": 4},               # >500MB
    {"threshold_bytes": 10 * 1024 * 1024, "credits": 2},
    {"threshold_bytes": 1 * 1024 * 1024, "credits": 1},
    # Any non-empty dataset: small base add-on
    {"threshold_bytes": 0, "credits": 0.5},
]

PLAN_CONFIGS: Dict[str, Dict[str, Any]] = {
    "free": {
        "name": "Free",
        "price_monthly": 0,
        "price_yearly": 0,
        "ai_credits_limit": 30,
        "max_projects": 1,
        "max_users": 1,
        "max_data_sources": 2,
        "storage_limit_gb": 5,
        "data_history_days": 7,
        "included_seats": 1,
        "additional_seat_price": 0,
        "api_calls_per_month": 100,
        "ai_credit_max_per_request": 10,
        "ai_base_analysis_cost": 1.0,
        "ai_model_multipliers": DEFAULT_AI_MODEL_MULTIPLIERS,
        "ai_analysis_mode_multipliers": DEFAULT_AI_ANALYSIS_MULTIPLIERS,
        "allowed_ai_modes": list(FREE_ALLOWED_AI_MODES),
        "ai_dataset_tiers": DEFAULT_AI_DATASET_TIERS,
        "features": {
            "watermark": True,
            "theme_customization": False,
            "api_access": False,
            "white_label": False,
            "collaboration": False,
            "advanced_collaboration": False,
            "advanced_ai": False, # No deep analysis, forecast, optimize modes
            "cross_source_analytics": False,
            "team_governance": False,
            "priority_support": False,
            "dedicated_support": False,
            "on_premise": False,
            "compliance": False,
            "sla": False,
            "dedicated_success": False,
            "export_formats": ["png"],  # Limited exports
            # Platform Services sidebar + Query Editor Spark (Pro+)
            "platform_services": False,
            "spark_query_engine": False,
            "bi_sync": False,
            "catalog": False,
            "lakehouse": False,
            "streaming": False,
        },
    },
    "pro": {
        "name": "Pro",
        "price_monthly": 25.0,
        "price_yearly": 250.0,  # ~17% savings
        "ai_credits_limit": 900,
        "max_projects": -1,  # Unlimited
        "max_users": 3,
        "max_data_sources": -1,  # Unlimited
        "storage_limit_gb": 100,
        "data_history_days": 180,
        "included_seats": 1,
        "additional_seat_price": 0,
        "api_calls_per_month": 10000,
        "ai_credit_max_per_request": 10,
        "ai_base_analysis_cost": 1.0,
        "ai_model_multipliers": DEFAULT_AI_MODEL_MULTIPLIERS,
        "ai_analysis_mode_multipliers": DEFAULT_AI_ANALYSIS_MULTIPLIERS,
        "allowed_ai_modes": list(PAID_ALLOWED_AI_MODES),
        "ai_dataset_tiers": DEFAULT_AI_DATASET_TIERS,
        "features": {
            "watermark": False,
            "theme_customization": True,
            "api_access": True,
            "white_label": False,
            "collaboration": False,
            "advanced_collaboration": False,
            "advanced_ai": True, # Deep analysis, forecast modes
            "cross_source_analytics": True,
            "team_governance": False,
            "priority_support": True,
            "dedicated_support": False,
            "on_premise": False,
            "compliance": False,
            "sla": False,
            "dedicated_success": False,
            "export_formats": ["png", "pdf", "svg"],
            "scheduled_reports": False,  # Reserved for Team+
            "platform_services": True,
            "spark_query_engine": True,
            "bi_sync": True,
            "catalog": True,
            "lakehouse": True,
            "streaming": True,
        },
    },
    "team": {
        "name": "Team",
        "price_monthly": 99.0,
        "price_yearly": 990.0,  # ~17% savings
        "min_seats": 5,
        "price_per_seat": 20.0,
        "included_seats": 5,
        "additional_seat_price": 25.0,
        "ai_credits_limit": 5000,
        "ai_credits_per_user_limit": 1000,
        "max_projects": -1,
        "max_users": 5,  # Base included seats; additional seats increase via billing
        "max_data_sources": -1,
        "storage_limit_gb": 500,
        "data_history_days": 365,
        "api_calls_per_month": 100000,
        "ai_credit_max_per_request": 10,
        "ai_base_analysis_cost": 1.0,
        "ai_model_multipliers": DEFAULT_AI_MODEL_MULTIPLIERS,
        "ai_analysis_mode_multipliers": DEFAULT_AI_ANALYSIS_MULTIPLIERS,
        "allowed_ai_modes": list(PAID_ALLOWED_AI_MODES),
        "ai_dataset_tiers": DEFAULT_AI_DATASET_TIERS,
        "features": {
            "watermark": False,
            "theme_customization": True,
            "api_access": True,
            "white_label": False,
            "collaboration": True,
            "advanced_collaboration": True,
            "team_governance": True,
            "advanced_ai": True,  # All AI modes
            "cross_source_analytics": True,
            "priority_support": True,
            "dedicated_support": True,
            "on_premise": False,
            "compliance": False,
            "sla": False,
            "dedicated_success": False,
            "export_formats": ["png", "pdf", "svg", "xlsx"],
            "scheduled_reports": True,
            "webhooks": True,
            # Available to team plans — useful for smaller teams too
            "alerts": True,
            "pivot_table": True,        # AntV S2 pivot tables
            "platform_services": True,
            "spark_query_engine": True,
            "bi_sync": True,
            "catalog": True,
            "lakehouse": True,
            "streaming": True,
        },
    },
    "enterprise": {
        "name": "Enterprise",
        "price_monthly": 0,  # Custom pricing
        "price_yearly": 0,
        "ai_credits_limit": -1,  # Unlimited / BYO model
        "max_projects": -1,
        "max_users": -1,
        "max_data_sources": -1,
        "storage_limit_gb": -1,
        "data_history_days": -1,
        "included_seats": -1,
        "additional_seat_price": 0,
        "ai_credit_max_per_request": 25,
        "ai_base_analysis_cost": 1.0,
        "ai_model_multipliers": DEFAULT_AI_MODEL_MULTIPLIERS,
        "ai_analysis_mode_multipliers": DEFAULT_AI_ANALYSIS_MULTIPLIERS,
        "allowed_ai_modes": list(PAID_ALLOWED_AI_MODES),
        "ai_dataset_tiers": DEFAULT_AI_DATASET_TIERS,
        "features": {
            "watermark": False,
            "theme_customization": True,
            "api_access": True,
            "white_label": True,
            "collaboration": True,
            "advanced_collaboration": True,
            "team_governance": True,
            "advanced_ai": True, 
            "cross_source_analytics": True,
            "priority_support": True,
            "dedicated_support": True,
            "on_premise": True,
            "sso_saml": True,
            "compliance": True,
            "sla": True,
            "dedicated_success": True,
            "dedicated_success_manager": True,
            "custom_ai_models": True,
            "export_formats": ["png", "pdf", "svg", "xlsx", "pptx"],
            "scheduled_reports": True,
            "webhooks": True,
            "audit_logs": True,
            # EE platform modules (data-platform UI tabs + server routers)
            "platform_services": True,
            "spark_query_engine": True,
            "bi_sync": True,
            "catalog": True,
            "lakehouse": True,
            # Log / IoT / Network Stream Analytics (EE)
            "streaming": True,          # Kafka engine DDL + /data/streams endpoints
            "iot_connectors": True,     # InfluxDB, Prometheus-as-source, OpenSearch
            "network_graph": True,      # AntV G6 renderer
            "alerts": True,             # Full alert rules + events system
            "pivot_table": True,        # AntV S2 renderer
        },
    },
}

# Stripe Price IDs (from Stripe Dashboard)
STRIPE_PRICE_IDS = {
    "pro_monthly": "price_pro_monthly_xxx",  # Set in environment
    "pro_yearly": "price_pro_yearly_xxx",
    "team_monthly": "price_team_monthly_xxx",
    "team_yearly": "price_team_yearly_xxx",
}

def get_plan_config(plan_type: str) -> Dict[str, Any]:
    """Get configuration for a plan type"""
    return PLAN_CONFIGS.get(plan_type, PLAN_CONFIGS["free"])


def is_feature_available(plan_type: str, feature: str) -> bool:
    """Check if a feature is available for a plan"""
    config = get_plan_config(plan_type)
    return config.get("features", {}).get(feature, False)


def get_plan_limits(plan_type: str) -> Dict[str, Any]:
    """Get limits for a plan type"""
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

