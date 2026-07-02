"""Community Edition usage tracking stubs.

CE does not persist subscription usage or managed AI-credit consumption.
Provider API usage is billed and observable in the user's own provider account.
"""

from __future__ import annotations

from typing import Optional

from sqlalchemy.ext.asyncio import AsyncSession


async def resolve_organization_id(user_id: str, db: AsyncSession | None = None) -> Optional[str]:
    del db
    return user_id or None


async def track_usage(*args, **kwargs) -> bool:
    del args, kwargs
    return True


async def check_usage_limits(*args, **kwargs) -> tuple[bool, str]:
    del args, kwargs
    return True, "Community Edition does not track managed plan usage."
