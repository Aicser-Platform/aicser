"""Authentication persistence models."""

from sqlalchemy import Column, DateTime, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID

from src.db.base import BaseModel


class PasswordResetToken(BaseModel):
    """One-time password reset link token plus short manual recovery code."""

    __tablename__ = "password_reset_tokens"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    email = Column(String(255), nullable=False, index=True)
    token_hash = Column(String(128), nullable=False, unique=True, index=True)
    code_hash = Column(String(128), nullable=False, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    used_at = Column(DateTime(timezone=True), nullable=True, index=True)
    attempts = Column(Integer, nullable=False, default=0, server_default="0")
    request_ip = Column(String(64), nullable=True)
    user_agent = Column(Text, nullable=True)


class TwoFactorPendingLogin(BaseModel):
    """Short-lived pending-login marker issued after password verification when
    the account has TOTP enabled, and redeemed by /auth/2fa/verify-login for the
    real session token. Deliberately an opaque random token (like
    PasswordResetToken), not a JWT -- a JWT signed with the same SECRET_KEY would
    be accepted as a full session by get_current_user()/JWTCookieBearer, which
    would let password-only knowledge bypass the second factor entirely.
    """

    __tablename__ = "two_factor_pending_logins"

    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id", ondelete="CASCADE"), nullable=False, index=True)
    token_hash = Column(String(128), nullable=False, unique=True, index=True)
    expires_at = Column(DateTime(timezone=True), nullable=False, index=True)
    used_at = Column(DateTime(timezone=True), nullable=True, index=True)
    attempts = Column(Integer, nullable=False, default=0, server_default="0")
