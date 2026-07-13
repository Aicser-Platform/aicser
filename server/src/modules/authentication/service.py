from datetime import datetime, timedelta, timezone
from typing import Optional
from uuid import UUID as PyUUID

from jose import jwt, JWTError
from passlib.context import CryptContext
from sqlalchemy import func, select
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from src.core.config import settings
from src.modules.user.models import User

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
_logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
EXPIRY_SECONDS = 7 * 24 * 60 * 60  # 7 days


def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd.verify(plain, hashed)


def create_access_token(user_id: str, email: str) -> str:
    expire = datetime.now(timezone.utc) + timedelta(seconds=EXPIRY_SECONDS)
    payload = {"sub": str(user_id), "email": email, "exp": expire}
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Raise JWTError if invalid or expired."""
    return jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])


def _pick_user_for_email(users: list[User], email: str) -> Optional[User]:
    """Prefer CE/password account when duplicate rows share an email."""
    if not users:
        return None
    if len(users) == 1:
        return users[0]
    _logger.warning(
        "Multiple users found for email %s; preferring CE/password account",
        email,
    )
    for user in users:
        if user.provider in ("ce", "local") and user.hashed_password:
            return user
    for user in users:
        if user.hashed_password:
            return user
    return users[0]


async def get_user_by_email(db: AsyncSession, email: str) -> Optional[User]:
    normalized = email.strip().lower()
    result = await db.execute(
        select(User).where(func.lower(User.email) == normalized)
    )
    return _pick_user_for_email(list(result.scalars().all()), email)


async def get_user_by_id(db: AsyncSession, user_id: str) -> Optional[User]:
    result = await db.execute(select(User).where(User.id == PyUUID(user_id)))
    return result.scalar_one_or_none()


async def authenticate_user(db: AsyncSession, email: str, password: str) -> Optional[User]:
    user = await get_user_by_email(db, email)
    if not user or not user.hashed_password:
        return None
    if not verify_password(password, user.hashed_password):
        return None
    return user


async def register_user(db: AsyncSession, email: str, username: str, password: str) -> User:
    normalized = email.strip().lower()
    result = await db.execute(
        select(User).where(
            func.lower(User.email) == normalized,
            User.provider.in_(["ce", "local"])
        )
    )
    if result.scalars().first():
        raise ValueError("Email already registered with local account")
    user = User(
        email=email,
        username=username,
        hashed_password=hash_password(password),
        provider="ce",
        is_verified=True,
    )
    db.add(user)
    try:
        await db.commit()
    except IntegrityError:
        await db.rollback()
        raise ValueError("Email already registered")
    await db.refresh(user)
    return user


async def change_user_password(db: AsyncSession, user_id: str, new_password: str) -> None:
    user = await get_user_by_id(db, user_id)
    if not user:
        raise ValueError("User not found")
    user.hashed_password = hash_password(new_password)
    await db.commit()
