from datetime import datetime, timedelta, timezone
import hashlib
import hmac
import html
import secrets
import time
import uuid as uuid_module
from typing import Optional
from uuid import UUID as PyUUID

from jose import jwt, JWTError
from passlib.context import CryptContext
from sqlalchemy import func, select, update
from sqlalchemy.exc import IntegrityError
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from src.core.cache import cache
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
TWO_FACTOR_LOGIN_EXPIRY_MINUTES = 5
TWO_FACTOR_LOGIN_ATTEMPT_LIMIT = 5
TWO_FACTOR_BACKUP_CODE_COUNT = 10


def hash_password(plain: str) -> str:
    return _pwd.hash(plain)


def verify_password(plain: str, hashed: str) -> bool:
    return _pwd.verify(plain, hashed)


_REVOKED_JTI_PREFIX = "auth:revoked_jti:"
_SESSION_FLOOR_PREFIX = "auth:session_floor:"


def create_access_token(user_id: str, email: str) -> str:
    now = datetime.now(timezone.utc)
    expire = now + timedelta(seconds=EXPIRY_SECONDS)
    payload = {
        "sub": str(user_id),
        "email": email,
        "exp": expire,
        "iat": now,
        # Per-token id so a single session can be revoked (logout) without
        # touching every other session for the same user — see
        # revoke_access_token/revoke_all_sessions_for_user.
        "jti": uuid_module.uuid4().hex,
    }
    return jwt.encode(payload, settings.SECRET_KEY, algorithm=ALGORITHM)


def decode_access_token(token: str) -> dict:
    """Raise JWTError if invalid, expired, or revoked."""
    payload = jwt.decode(token, settings.SECRET_KEY, algorithms=[ALGORITHM])
    if _is_revoked(payload):
        raise JWTError("Token has been revoked")
    return payload


def _is_revoked(payload: dict) -> bool:
    # Tokens minted before this claim existed have no jti/iat — fail open on
    # revocation for them (they simply can't be individually revoked) rather
    # than rejecting every already-logged-in session on deploy.
    if not cache:
        return False
    jti = payload.get("jti")
    if jti and cache.exists(f"{_REVOKED_JTI_PREFIX}{jti}"):
        return True
    user_id = payload.get("sub")
    iat = payload.get("iat")
    if user_id and iat is not None:
        floor = cache.get(f"{_SESSION_FLOOR_PREFIX}{user_id}")
        # JWT iat/exp round-trip as whole-second integers (JWT spec), so the
        # floor must be compared at the same second granularity — mixing a
        # sub-second float in here would reject a token minted a genuine
        # instant after the revoke just because it landed in the same
        # second. <= (not <) means a token issued in the very same second as
        # the revoke call is still treated as revoked, which is the standard,
        # accepted edge case for this pattern — anything a full second later
        # is unambiguously fine.
        if floor is not None and int(iat) <= int(floor):
            return True
    return False


def revoke_access_token(token: str) -> None:
    """Revoke a single session token (logout). Best-effort and safe to call
    on an already-expired/invalid/claim-less token — it just becomes a no-op."""
    if not cache:
        return
    try:
        payload = jwt.decode(
            token, settings.SECRET_KEY, algorithms=[ALGORITHM],
            options={"verify_exp": False},
        )
    except JWTError:
        return
    jti = payload.get("jti")
    exp = payload.get("exp")
    if not jti or exp is None:
        return
    remaining = int(exp - time.time())
    if remaining <= 0:
        return  # already expired naturally — nothing to revoke
    cache.set(f"{_REVOKED_JTI_PREFIX}{jti}", "1", ttl=remaining)


def revoke_all_sessions_for_user(user_id: str) -> None:
    """Invalidate every session token issued for this user up to now — e.g. on
    password change, or a user-initiated 'log out of all other sessions'.
    Tokens issued after this call (a fresh login) remain valid."""
    if not cache:
        return
    cache.set(f"{_SESSION_FLOOR_PREFIX}{user_id}", int(time.time()), ttl=EXPIRY_SECONDS)


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


async def change_user_password(
    db: AsyncSession, user_id: str, new_password: str, current_password: Optional[str] = None
) -> None:
    # SECURITY: this used to set an arbitrary new password given only a
    # valid session -- no proof the caller actually knows the current one.
    # An attacker with a stolen/hijacked session (XSS, a leaked cookie, a
    # shared device) could lock the real owner out permanently by changing
    # their password, with no re-authentication step in the way. When the
    # account already has a password, current_password is now required and
    # verified, matching how every mainstream account-settings "change
    # password" flow works. Accounts with no password yet (first-time setup
    # right after invite acceptance, or an OAuth-only account) have nothing
    # to verify against, so that case is left as a plain set -- requiring a
    # value there would just break onboarding for no security benefit.
    user = await get_user_by_id(db, user_id)
    if not user:
        raise ValueError("User not found")
    if user.hashed_password:
        if not current_password or not verify_password(current_password, user.hashed_password):
            raise ValueError("Current password is incorrect")
    user.hashed_password = hash_password(new_password)
    await db.commit()
    # A changed password is the classic "I think my session may be
    # compromised" moment — kill every other session so a stolen token
    # doesn't outlive the credential change that was meant to fix it.
    revoke_all_sessions_for_user(user_id)


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
        # SECURITY: the real path below does a DB write plus an awaited,
        # synchronous call to the email provider -- real network I/O that
        # took noticeably longer than this early return, letting a caller
        # enumerate which emails have a local-password account purely from
        # response timing even though the response body is identical either
        # way. A fixed delay here doesn't perfectly equalize timing (network
        # jitter still leaks some signal) but closes the trivially-reliable
        # gap without adding real work.
        import asyncio as _asyncio

        await _asyncio.sleep(0.25)
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
    # Same reasoning as change_user_password — a reset implies the old
    # credential/session may not be trustworthy.
    revoke_all_sessions_for_user(str(user.id))
    return user


# ── Two-factor authentication (TOTP) ─────────────────────────────────────────

async def create_pending_two_factor_login(db: AsyncSession, user: User) -> str:
    """After password verification for a totp_enabled account: mint a short-lived,
    single-use pending-login token (opaque, not a JWT -- see TwoFactorPendingLogin's
    docstring for why) and return the plaintext value for the login response.
    """
    from src.modules.authentication.models import TwoFactorPendingLogin

    now = datetime.now(timezone.utc)
    # Invalidate any earlier pending logins for this user (e.g. an abandoned attempt).
    await db.execute(
        update(TwoFactorPendingLogin)
        .where(
            TwoFactorPendingLogin.user_id == user.id,
            TwoFactorPendingLogin.used_at.is_(None),
        )
        .values(used_at=now)
    )

    token = secrets.token_urlsafe(32)
    pending = TwoFactorPendingLogin(
        user_id=user.id,
        token_hash=_hash_reset_value(token),
        expires_at=now + timedelta(minutes=TWO_FACTOR_LOGIN_EXPIRY_MINUTES),
    )
    db.add(pending)
    await db.commit()
    return token


async def resolve_pending_two_factor_login(
    db: AsyncSession,
    login_token: str,
    *,
    code: Optional[str] = None,
    backup_code: Optional[str] = None,
) -> User:
    """Redeem a pending-login token with a TOTP code or backup code.

    Raises ValueError (safe to surface to the client) on any failure: expired/
    unknown/already-used token, too many attempts, or a wrong code. Returns the
    authenticated User on success -- caller is responsible for issuing the real
    session token.
    """
    from src.modules.authentication.models import TwoFactorPendingLogin
    from src.modules.authentication import totp_service

    if not login_token or not (code or backup_code):
        raise ValueError("A verification code is required")

    now = datetime.now(timezone.utc)
    result = await db.execute(
        select(TwoFactorPendingLogin).where(
            TwoFactorPendingLogin.token_hash == _hash_reset_value(login_token),
            TwoFactorPendingLogin.used_at.is_(None),
            TwoFactorPendingLogin.expires_at > now,
        )
    )
    pending = result.scalar_one_or_none()
    if not pending:
        raise ValueError("This login has expired. Please sign in again.")
    if pending.attempts >= TWO_FACTOR_LOGIN_ATTEMPT_LIMIT:
        pending.used_at = now
        await db.commit()
        raise ValueError("Too many attempts. Please sign in again.")

    user = await get_user_by_id(db, str(pending.user_id))
    if not user or not user.totp_enabled or not user.totp_secret:
        pending.used_at = now
        await db.commit()
        raise ValueError("Two-factor authentication is not enabled for this account.")

    verified = False
    if code:
        secret = totp_service.decrypt_secret(user.totp_secret)
        verified = bool(secret) and totp_service.verify_totp_code(secret, code)
    if not verified and backup_code:
        ok, remaining = totp_service.verify_and_consume_backup_code(
            list(user.totp_backup_codes or []), backup_code
        )
        if ok:
            verified = True
            user.totp_backup_codes = remaining

    if not verified:
        pending.attempts += 1
        await db.commit()
        raise ValueError("Invalid verification code")

    pending.used_at = now
    await db.commit()
    return user


async def get_totp_status(db: AsyncSession, user_id: str) -> bool:
    user = await get_user_by_id(db, user_id)
    if not user:
        raise ValueError("User not found")
    return bool(user.totp_enabled)


async def start_totp_enrollment(db: AsyncSession, user_id: str) -> dict:
    """Generate a new secret and store it as *pending* (totp_enabled stays false
    until enroll/confirm verifies a code against it)."""
    from src.modules.authentication import totp_service

    user = await get_user_by_id(db, user_id)
    if not user:
        raise ValueError("User not found")
    if user.totp_enabled:
        raise ValueError("Two-factor authentication is already enabled. Disable it before re-enrolling.")

    secret = totp_service.generate_secret()
    user.totp_secret = totp_service.encrypt_secret(secret)
    await db.commit()

    account_label = user.email or user.username or str(user.id)
    return {
        "secret": secret,
        "otpauth_uri": totp_service.build_provisioning_uri(secret, account_label),
        "account": account_label,
        "issuer": totp_service.ISSUER,
    }


async def confirm_totp_enrollment(db: AsyncSession, user_id: str, code: str) -> list[str]:
    """Verify *code* against the pending secret from start_totp_enrollment; on success,
    enable 2FA and return a fresh set of plaintext backup codes (shown once)."""
    from src.modules.authentication import totp_service

    user = await get_user_by_id(db, user_id)
    if not user:
        raise ValueError("User not found")
    if user.totp_enabled:
        raise ValueError("Two-factor authentication is already enabled.")
    if not user.totp_secret:
        raise ValueError("Start enrollment before confirming a code.")

    secret = totp_service.decrypt_secret(user.totp_secret)
    if not secret or not totp_service.verify_totp_code(secret, code or ""):
        raise ValueError("Invalid code. Please try again.")

    backup_codes = totp_service.generate_backup_codes(TWO_FACTOR_BACKUP_CODE_COUNT)
    user.totp_backup_codes = [hash_password(totp_service.normalize_backup_code(c)) for c in backup_codes]
    user.totp_enabled = True
    await db.commit()
    return backup_codes


async def disable_totp(db: AsyncSession, user_id: str, password: Optional[str] = None) -> None:
    """Clear TOTP enrollment. Requires the current password when the account has one --
    same re-authentication requirement as change_user_password, for the same reason: an
    attacker with just a hijacked session shouldn't be able to strip 2FA off the account."""
    user = await get_user_by_id(db, user_id)
    if not user:
        raise ValueError("User not found")
    if user.hashed_password:
        if not password or not verify_password(password, user.hashed_password):
            raise ValueError("Current password is incorrect")
    user.totp_enabled = False
    user.totp_secret = None
    user.totp_backup_codes = None
    await db.commit()
