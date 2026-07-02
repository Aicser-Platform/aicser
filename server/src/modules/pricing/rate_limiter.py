"""Community Edition plan/credit limiter.

CE does not grant Aicser-managed AI credits. AI calls are expected to use
provider keys configured by the user or deployment owner, so credit accounting
is intentionally a no-op.
"""

from __future__ import annotations

from typing import Optional, Tuple

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.pricing.plans import is_feature_available


class RateLimiter:
    def __init__(self, db: AsyncSession):
        self.db = db

    async def check_ai_credits(
        self,
        organization_id: int | str,
        required_credits: int,
    ) -> Tuple[bool, str]:
        del organization_id, required_credits
        return True, "Community Edition uses user/provider AI keys; managed AI credits are not included or tracked."

    async def consume_credits(
        self,
        organization_id: int | str,
        credits: int,
        user_id: str,
        metadata: Optional[dict] = None,
    ) -> bool:
        del organization_id, credits, user_id, metadata
        return True

    async def check_feature_access(
        self,
        organization_id: int | str,
        feature: str,
    ) -> Tuple[bool, str]:
        del organization_id
        if is_feature_available("free", feature):
            return True, "Feature is available in Community Edition."
        return False, f"Feature '{feature}' is not available in Community Edition."

    async def check_project_limit(self, organization_id: int | str) -> Tuple[bool, str, int]:
        del organization_id
        return True, "unlimited", 0

    async def check_data_source_limit(self, organization_id: int | str) -> Tuple[bool, str, int]:
        del organization_id
        return True, "unlimited", 0
