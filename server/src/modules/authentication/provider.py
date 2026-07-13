"""
Auth provider seam between CE and EE.

CE owns this interface and a small registry. EE registers its own
implementation at startup (see src/core/lifespan.py, gated on
is_ee_enabled()) instead of CE importing the ee package by name. This
keeps the dependency direction one-way: EE depends on CE, never CE on EE.
"""

from typing import Optional, Protocol

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.authentication.service import authenticate_user, register_user
from src.modules.user.models import User


class AuthProvider(Protocol):
    async def authenticate(self, db: AsyncSession, email: str, password: str) -> Optional[User]:
        ...

    async def register(self, db: AsyncSession, email: str, username: str, password: str) -> User:
        ...


class CEAuthProvider:
    """Default provider: CE's own email/password auth (src/modules/authentication/service.py)."""

    async def authenticate(self, db: AsyncSession, email: str, password: str) -> Optional[User]:
        return await authenticate_user(db, email, password)

    async def register(self, db: AsyncSession, email: str, username: str, password: str) -> User:
        return await register_user(db, email, username, password)


_active_provider: AuthProvider = CEAuthProvider()


def register_auth_provider(provider: AuthProvider) -> None:
    """Override the active auth provider. Called by EE at startup when enabled."""
    global _active_provider
    _active_provider = provider


def get_auth_provider() -> AuthProvider:
    return _active_provider
