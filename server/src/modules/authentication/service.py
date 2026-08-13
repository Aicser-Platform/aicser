from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import html
import secrets
from typing import Optional
from uuid import UUID as PyUUID

from jose import jwt, JWTError
from passlib.context import CryptContext
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from src.core.config import settings
from src.modules.authentication.models import PasswordResetToken
from src.modules.user.models import User
from src.shared.transactional_email import send_transactional_email

_pwd = CryptContext(schemes=["bcrypt"], deprecated="auto")
_logger = logging.getLogger(__name__)

ALGORITHM = "HS256"
EXPIRY_SECONDS = 7 * 24 * 60 * 60  # 7 days
PASSWORD_RESET_EXPIRY_MINUTES = 30
PASSWORD_RESET_CODE_ATTEMPT_LIMIT = 5
PASSWORD_RESET_PUBLIC_MESSAGE = (
    "If an account exists for that email, you will receive password reset instructions shortly."
)


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


def _hash_reset_value(value: str) -> str:
    key = settings.SECRET_KEY.encode("utf-8")
    return hmac.new(key, value.encode("utf-8"), hashlib.sha256).hexdigest()


def _is_local_password_user(user: User | None) -> bool:
    return bool(
        user
        and user.hashed_password
        and (user.provider in ("ce", "local", "ee") or user.provider is None)
    )


def _password_reset_url(token: str) -> str:
    base = settings.FRONTEND_URL.rstrip("/") or "http://localhost:3000"
    return f"{base}/reset-password?token={token}"


def _password_reset_email(email: str, reset_url: str, code: str) -> tuple[str, str, str]:
    subject = "Reset your Aicser password"
    body_text = (
        "We received a request to reset your Aicser password.\n\n"
        f"Reset your password here: {reset_url}\n\n"
        "If the link does not work, use this recovery code on the reset page:\n"
        f"{code}\n\n"
        f"This reset expires in {PASSWORD_RESET_EXPIRY_MINUTES} minutes. "
        "If you did not request this, you can ignore this email."
    )
    safe_url = html.escape(reset_url, quote=True)
    safe_email = html.escape(email)
    safe_code = html.escape(code)
    body_html = (
        "<p>We received a request to reset your Aicser password.</p>"
        f'<p><a href="{safe_url}">Reset password</a></p>'
        "<p>If the link does not work, use this recovery code on the reset page:</p>"
        f"<p><strong>{safe_code}</strong></p>"
        f"<p>This reset expires in {PASSWORD_RESET_EXPIRY_MINUTES} minutes. "
        "If you did not request this, you can ignore this email.</p>"
        f"<p>Requested for {safe_email}</p>"
    )
    return subject, body_text, body_html


async def request_password_reset(
    db: AsyncSession,
    email: str,
    *,
    request_ip: str | None = None,
    user_agent: str | None = None,
) -> None:
    """Create and email a reset token when the email belongs to a local account."""
    normalized = email.strip().lower()
    user = await get_user_by_email(db, normalized)
    if not _is_local_password_user(user):
        if user:
            _logger.info(
                "Password reset email skipped for non-local account: email=%s provider=%s has_password=%s",
                normalized,
                user.provider,
                bool(user.hashed_password),
            )
        return

    now = datetime.now(timezone.utc)
    await db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
            PasswordResetToken.expires_at > now,
        )
        .values(used_at=now)
    )

    token = secrets.token_urlsafe(32)
    code = f"{secrets.randbelow(1_000_000):06d}"
    reset = PasswordResetToken(
        user_id=user.id,
        email=normalized,
        token_hash=_hash_reset_value(token),
        code_hash=_hash_reset_value(f"{normalized}:{code}"),
        expires_at=now + timedelta(minutes=PASSWORD_RESET_EXPIRY_MINUTES),
        request_ip=(request_ip or "")[:64] or None,
        user_agent=(user_agent or "")[:512] or None,
    )
    db.add(reset)
    await db.commit()

    reset_url = _password_reset_url(token)
    subject, body_text, body_html = _password_reset_email(normalized, reset_url, code)
    sent = await send_transactional_email([normalized], subject, body_text, body_html=body_html)
    if not sent:
        _logger.info("Password reset email was not sent because no email provider is configured")


async def reset_password_with_token_or_code(
    db: AsyncSession,
    *,
    password: str,
    token: str | None = None,
    email: str | None = None,
    code: str | None = None,
) -> User:
    now = datetime.now(timezone.utc)
    reset: PasswordResetToken | None = None

    if token:
        result = await db.execute(
            select(PasswordResetToken).where(
                PasswordResetToken.token_hash == _hash_reset_value(token),
                PasswordResetToken.used_at.is_(None),
                PasswordResetToken.expires_at > now,
            )
        )
        reset = result.scalar_one_or_none()
    elif email and code:
        normalized = email.strip().lower()
        user = await get_user_by_email(db, normalized)
        if not _is_local_password_user(user):
            raise ValueError("Invalid or expired password reset")
        result = await db.execute(
            select(PasswordResetToken)
            .where(
                PasswordResetToken.user_id == user.id,
                PasswordResetToken.used_at.is_(None),
                PasswordResetToken.expires_at > now,
            )
            .order_by(PasswordResetToken.created_at.desc())
            .limit(1)
        )
        reset = result.scalar_one_or_none()
        if reset:
            if reset.attempts >= PASSWORD_RESET_CODE_ATTEMPT_LIMIT:
                raise ValueError("Invalid or expired password reset")
            expected_hash = _hash_reset_value(f"{normalized}:{code.strip()}")
            if not hmac.compare_digest(reset.code_hash, expected_hash):
                reset.attempts += 1
                await db.commit()
                raise ValueError("Invalid or expired password reset")
    else:
        raise ValueError("Reset token or email and recovery code are required")

    if not reset:
        raise ValueError("Invalid or expired password reset")

    user = await get_user_by_id(db, str(reset.user_id))
    if not _is_local_password_user(user):
        raise ValueError("Invalid or expired password reset")

    user.hashed_password = hash_password(password)
    user.is_verified = True
    await db.execute(
        update(PasswordResetToken)
        .where(
            PasswordResetToken.user_id == user.id,
            PasswordResetToken.used_at.is_(None),
        )
        .values(used_at=now)
    )
    await db.commit()
    return user
