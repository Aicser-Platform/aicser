"""
Plan/credits and feature-gating rate limiter.

Role: Enforces subscription limits (AI credits, plan-based quotas) and plan checks.
Used by data, charts, queries, projects, and feature_gate. For API-level request
rate limiting on AI endpoints, see app.middleware.rate_limiter.
"""

import logging
import os
import time
from typing import Tuple, Optional
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from src.modules.pricing.plans import get_plan_config, PLAN_CONFIGS
from src.shared.transactional_email import send_transactional_email

logger = logging.getLogger(__name__)

# Per-process throttle for high-usage alert emails (multi-worker: each worker has its own window)
_ai_usage_alert_last_sent: dict[str, float] = {}


def _ai_usage_alert_throttle_seconds() -> int:
    try:
        return int(os.getenv("AI_USAGE_ALERT_THROTTLE_SECONDS", "86400") or "86400")
    except ValueError:
        return 86400


def _ai_usage_alert_in_cooldown(organization_id: int) -> bool:
    """True if a successful send happened recently for this org (skip another attempt)."""
    throttle = _ai_usage_alert_throttle_seconds()
    if throttle <= 0:
        return False
    key = str(organization_id)
    now = time.time()
    last = _ai_usage_alert_last_sent.get(key, 0.0)
    if now - last < float(throttle):
        logger.debug(
            "AI usage alert email throttled for org %s (%.0fs < %ss since last success)",
            organization_id,
            now - last,
            throttle,
        )
        return True
    return False


def _record_ai_usage_alert_sent(organization_id: int) -> None:
    """Call only after send_transactional_email returned True."""
    _ai_usage_alert_last_sent[str(organization_id)] = time.time()


class RateLimiter:
    """Rate limiting based on plan and credits"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def check_ai_credits(
        self,
        organization_id: int,
        required_credits: int,
    ) -> Tuple[bool, str]:
        """
        Check if organization has enough AI credits
        
        Returns:
            (is_allowed, message)
        """
        # Get organization
        result = await self.db.execute(
            text("""
                SELECT 
                    plan_type,
                    ai_credits_used,
                    ai_credits_limit,
                    trial_ends_at
                FROM organizations
                WHERE id = :org_id
            """),
            {"org_id": organization_id}
        )
        org = result.fetchone()
        
        if not org:
            return False, "Organization not found"
        
        plan_type = org.plan_type or "free"
        plan_config = get_plan_config(plan_type)
        
        # Enterprise has unlimited credits
        if plan_type == "enterprise" or plan_config["ai_credits_limit"] == -1:
            return True, "unlimited"
        
        # Check if trial expired
        if org.trial_ends_at and datetime.utcnow() > org.trial_ends_at:
            # Reset to free plan limits if trial expired
            if plan_type != "free":
                await self._reset_to_free_plan(organization_id)
                plan_config = get_plan_config("free")
        
        # Reset monthly credits if needed
        credits_used = org.ai_credits_used or 0
        credits_limit = plan_config["ai_credits_limit"]
        
        # Check if we need to reset (monthly reset)
        if await self._should_reset_monthly(organization_id):
            credits_used = 0
            await self._reset_monthly_credits(organization_id)
        
        # Check if enough credits
        if credits_used + required_credits > credits_limit:
            remaining = max(0, credits_limit - credits_used)
            return False, (
                f"Insufficient AI credits. "
                f"Used: {credits_used}/{credits_limit}. "
                f"Required: {required_credits}. "
                f"Remaining: {remaining}. "
                f"Upgrade to get more credits."
            )
        
        remaining = credits_limit - credits_used - required_credits
        return True, f"Credits available: {remaining}/{credits_limit}"
    
    async def consume_credits(
        self,
        organization_id: int,
        credits: int,
        user_id: str,
        metadata: Optional[dict] = None,
    ) -> bool:
        """Consume AI credits and log usage"""
        try:
            # Update organization credits
            await self.db.execute(
                text("""
                    UPDATE organizations
                    SET 
                        ai_credits_used = COALESCE(ai_credits_used, 0) + :credits,
                        updated_at = NOW()
                    WHERE id = :org_id
                """),
                {"org_id": organization_id, "credits": credits}
            )
            
            # Log usage record
            await self.db.execute(
                text("""
                    INSERT INTO usage_records (
                        organization_id,
                        user_id,
                        record_type,
                        quantity,
                        metadata,
                        created_at
                    ) VALUES (
                        :org_id,
                        :user_id,
                        'ai_query',
                        :quantity,
                        :metadata::jsonb,
                        NOW()
                    )
                """),
                {
                    "org_id": organization_id,
                    "user_id": user_id,
                    "quantity": credits,
                    "metadata": str(metadata or {}) if metadata else "{}",
                }
            )
            
            # Check if approaching limit (warn at 80%)
            result = await self.db.execute(
                text("""
                    SELECT 
                        ai_credits_used,
                        ai_credits_limit
                    FROM organizations
                    WHERE id = :org_id
                """),
                {"org_id": organization_id}
            )
            org = result.fetchone()
            
            if org and org.ai_credits_limit > 0:
                usage_percent = (org.ai_credits_used / org.ai_credits_limit) * 100
                if usage_percent >= 80:
                    logger.warning(
                        "Organization %s at %.1f%% of AI credits limit",
                        organization_id,
                        usage_percent,
                    )
                # Email only at high usage to avoid spamming on every AI call
                if usage_percent >= 90:
                    raw = os.getenv(
                        "AI_USAGE_ALERT_EMAILS",
                        os.getenv("BILLING_NOTIFICATION_EMAILS", ""),
                    ).strip()
                    if raw:
                        recipients = [x.strip() for x in raw.split(",") if x.strip()]
                        if recipients and not _ai_usage_alert_in_cooldown(organization_id):
                            sent = await send_transactional_email(
                                recipients,
                                f"[Aicser] AI credits at {usage_percent:.0f}% (org {organization_id})",
                                f"Organization ID: {organization_id}\n"
                                f"Used: {org.ai_credits_used} / Limit: {org.ai_credits_limit}\n"
                                f"Approx. usage: {usage_percent:.1f}%\n",
                            )
                            if sent:
                                _record_ai_usage_alert_sent(organization_id)
            
            await self.db.commit()
            return True
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to consume credits: {str(e)}")
            return False
    
    async def check_feature_access(
        self,
        organization_id: int,
        feature: str,
    ) -> Tuple[bool, str]:
        """Check if organization can access a feature"""
        result = await self.db.execute(
            text("SELECT plan_type FROM organizations WHERE id = :org_id"),
            {"org_id": organization_id}
        )
        org = result.fetchone()
        
        if not org:
            return False, "Organization not found"
        
        plan_config = get_plan_config(org.plan_type or "free")
        features = plan_config.get("features", {})
        
        if feature in features and features[feature]:
            return True, "Feature available"
        
        plan_name = plan_config["name"]
        return False, f"Feature '{feature}' requires {plan_name} plan or higher"
    
    async def check_project_limit(
        self,
        organization_id: int,
    ) -> Tuple[bool, str, int]:
        """Check if organization can create more projects"""
        result = await self.db.execute(
            text("""
                SELECT 
                    plan_type,
                    max_projects,
                    (SELECT COUNT(*) FROM projects WHERE organization_id = :org_id AND is_active = TRUE) as current_projects
                FROM organizations
                WHERE id = :org_id
            """),
            {"org_id": organization_id}
        )
        org = result.fetchone()
        
        if not org:
            return False, "Organization not found", 0
        
        plan_config = get_plan_config(org.plan_type or "free")
        max_projects = plan_config["max_projects"]
        current_projects = org.current_projects or 0
        
        # Unlimited
        if max_projects == -1:
            return True, "unlimited", current_projects
        
        if current_projects >= max_projects:
            return False, (
                f"Project limit reached. "
                f"Current: {current_projects}/{max_projects}. "
                f"Upgrade to create more projects."
            ), current_projects
        
        remaining = max_projects - current_projects
        return True, f"Projects available: {remaining}/{max_projects}", current_projects
    
    async def check_data_source_limit(
        self,
        organization_id: int,
    ) -> Tuple[bool, str, int]:
        """Check if organization can add more data sources"""
        result = await self.db.execute(
            text("""
                SELECT 
                    plan_type,
                    (
                        SELECT COUNT(*)
                        FROM data_sources ds
                        JOIN projects p ON p.id = ds.project_id
                        WHERE p.organization_id = :org_id
                          AND ds.is_active = TRUE
                          AND ds.type != 'sample_duckdb'
                    ) as current_sources
                FROM organizations
                WHERE id = :org_id
            """),
            {"org_id": organization_id}
        )
        org = result.fetchone()
        
        if not org:
            return False, "Organization not found", 0
        
        plan_config = get_plan_config(org.plan_type or "free")
        max_sources = plan_config["max_data_sources"]
        current_sources = org.current_sources or 0
        
        # Unlimited
        if max_sources == -1:
            return True, "unlimited", current_sources
        
        if current_sources >= max_sources:
            return False, (
                f"Data source limit reached. "
                f"Current: {current_sources}/{max_sources}. "
                f"Upgrade to add more data sources."
            ), current_sources
        
        remaining = max_sources - current_sources
        return True, f"Data sources available: {remaining}/{max_sources}", current_sources
    
    async def _should_reset_monthly(self, organization_id: int) -> bool:
        """Check if monthly credits should be reset"""
        result = await self.db.execute(
            text("""
                SELECT 
                    updated_at,
                    ai_credits_used
                FROM organizations
                WHERE id = :org_id
            """),
            {"org_id": organization_id}
        )
        org = result.fetchone()
        
        if not org or not org.updated_at:
            return False
        
        # Reset if last update was more than 30 days ago
        days_since_update = (datetime.utcnow() - org.updated_at).days
        return days_since_update >= 30
    
    async def _reset_monthly_credits(self, organization_id: int):
        """Reset monthly AI credits"""
        await self.db.execute(
            text("""
                UPDATE organizations
                SET 
                    ai_credits_used = 0,
                    updated_at = NOW()
                WHERE id = :org_id
            """),
            {"org_id": organization_id}
        )
        await self.db.commit()
    
    async def _reset_to_free_plan(self, organization_id: int):
        """Reset organization to free plan (when trial expires)"""
        free_config = get_plan_config("free")
        await self.db.execute(
            text("""
                UPDATE organizations
                SET 
                    plan_type = 'free',
                    ai_credits_limit = :credits_limit,
                    max_projects = :max_projects,
                    updated_at = NOW()
                WHERE id = :org_id
            """),
            {
                "org_id": organization_id,
                "credits_limit": free_config["ai_credits_limit"],
                "max_projects": free_config["max_projects"],
            }
        )
        await self.db.commit()


