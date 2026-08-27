from fastapi import APIRouter, Depends, HTTPException, Response, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from src.db.session import get_async_session
from src.modules.authentication.schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    LoginResponse,
    PasswordResetMessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
    TwoFactorDisableRequest,
    TwoFactorEnrollConfirmRequest,
    TwoFactorEnrollConfirmResponse,
    TwoFactorEnrollStartResponse,
    TwoFactorStatusResponse,
    TwoFactorVerifyLoginRequest,
    UserResponse,
)
from src.modules.authentication.service import (
    PASSWORD_RESET_PUBLIC_MESSAGE,
    create_access_token,
    change_user_password,
    confirm_totp_enrollment,
    create_pending_two_factor_login,
    disable_totp,
    get_totp_status,
    request_password_reset,
    reset_password_with_token_or_code,
    resolve_pending_two_factor_login,
    start_totp_enrollment,
)
from src.modules.authentication.cookies import clear_auth_token_cookie, set_auth_token_cookie
from src.core.production import is_production

router = APIRouter()
logger = logging.getLogger(__name__)

COOKIE_NAME = "auth_token"


def _set_auth_cookie(response: Response, token: str) -> None:
    set_auth_token_cookie(response, token)


async def _authenticate(db: AsyncSession, email: str, password: str):
    """Credential check via the active auth provider (CE by default, EE when registered)."""
    from src.modules.authentication.provider import get_auth_provider

    return await get_auth_provider().authenticate(db, email, password)


async def _register(db: AsyncSession, email: str, username: str, password: str):
    """Registration via the active auth provider (CE by default, EE when registered)."""
    from src.modules.authentication.provider import get_auth_provider

    return await get_auth_provider().register(db, email, username, password)


@router.post("/auth/login", response_model=LoginResponse)
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_async_session)):
    user = await _authenticate(db, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid email or password")

    # 2FA accounts: password alone isn't enough yet. Don't issue a session token
    # or set the auth cookie -- hand back a short-lived pending-login token the
    # client must redeem via /auth/2fa/verify-login with a TOTP/backup code.
    # Accounts without 2FA (the vast majority) fall straight through exactly as
    # before this existed.
    if getattr(user, "totp_enabled", False):
        login_token = await create_pending_two_factor_login(db, user)
        base = LoginResponse.model_validate(user, from_attributes=True)
        return base.model_copy(update={"two_factor_required": True, "login_token": login_token})

    token = create_access_token(str(user.id), user.email)
    _set_auth_cookie(response, token)
    return LoginResponse.model_validate(user, from_attributes=True).model_copy(update={"access_token": token})


@router.post("/auth/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, response: Response, db: AsyncSession = Depends(get_async_session)):
    try:
        user = await _register(db, body.email, body.username, body.password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    if not user:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Registration is not available. Contact your administrator.",
        )
    if not user.is_verified:
        return UserResponse.model_validate(user, from_attributes=True)

    token = create_access_token(str(user.id), user.email)
    _set_auth_cookie(response, token)
    return UserResponse.model_validate(user, from_attributes=True).model_copy(update={"access_token": token})


@router.post("/auth/logout")
async def logout(response: Response):
    clear_auth_token_cookie(response)
    return {"message": "Logged out"}


@router.post("/auth/forgot-password", response_model=PasswordResetMessageResponse)
async def forgot_password(
    body: ForgotPasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
):
    await request_password_reset(
        db,
        body.email,
        request_ip=request.client.host if request.client else None,
        user_agent=request.headers.get("user-agent"),
    )
    return {"message": PASSWORD_RESET_PUBLIC_MESSAGE}


@router.post("/auth/reset-password", response_model=PasswordResetMessageResponse)
async def reset_password(
    body: ResetPasswordRequest,
    db: AsyncSession = Depends(get_async_session),
):
    try:
        await reset_password_with_token_or_code(
            db,
            password=body.password,
            token=body.token,
            email=str(body.email) if body.email else None,
            code=body.code,
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return {"message": "Password updated. You can sign in with your new password."}


@router.post("/auth/change-password")
async def change_password(
    body: ChangePasswordRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
):
    from src.modules.authentication.deps.auth_bearer import get_current_user

    payload = await get_current_user(request)
    try:
        await change_user_password(db, str(payload["sub"]), body.password, body.current_password)
    except ValueError as e:
        detail = str(e)
        status_code = (
            status.HTTP_401_UNAUTHORIZED if detail == "Current password is incorrect" else status.HTTP_404_NOT_FOUND
        )
        raise HTTPException(status_code=status_code, detail=detail)
    return {"message": "Password updated"}


@router.post("/auth/2fa/verify-login", response_model=UserResponse)
async def two_factor_verify_login(
    body: TwoFactorVerifyLoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_async_session),
):
    """Second step of login for accounts with TOTP enabled: redeem the pending-login
    token from /auth/login with a 6-digit code or a backup code, and issue the real
    session token/cookie."""
    try:
        user = await resolve_pending_two_factor_login(
            db, body.login_token, code=body.code, backup_code=body.backup_code
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))
    token = create_access_token(str(user.id), user.email)
    _set_auth_cookie(response, token)
    return UserResponse.model_validate(user, from_attributes=True).model_copy(update={"access_token": token})


@router.get("/auth/2fa/status", response_model=TwoFactorStatusResponse)
async def two_factor_status(request: Request, db: AsyncSession = Depends(get_async_session)):
    from src.modules.authentication.deps.auth_bearer import get_current_user

    payload = await get_current_user(request)
    try:
        enabled = await get_totp_status(db, str(payload["sub"]))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return {"enabled": enabled}


@router.post("/auth/2fa/enroll/start", response_model=TwoFactorEnrollStartResponse)
async def two_factor_enroll_start(request: Request, db: AsyncSession = Depends(get_async_session)):
    """Generate a new TOTP secret and return its otpauth:// provisioning URI (for a QR
    code) plus the raw secret (manual-entry fallback). Does NOT enable 2FA yet -- the
    secret is stored pending until /auth/2fa/enroll/confirm verifies a code against it."""
    from src.modules.authentication.deps.auth_bearer import get_current_user

    payload = await get_current_user(request)
    try:
        data = await start_totp_enrollment(db, str(payload["sub"]))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return data


@router.post("/auth/2fa/enroll/confirm", response_model=TwoFactorEnrollConfirmResponse)
async def two_factor_enroll_confirm(
    body: TwoFactorEnrollConfirmRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
):
    """Verify a 6-digit code against the pending secret; on success, enables 2FA and
    returns a fresh set of backup codes. The backup codes are shown here once only --
    the server keeps only their hashes."""
    from src.modules.authentication.deps.auth_bearer import get_current_user

    payload = await get_current_user(request)
    try:
        backup_codes = await confirm_totp_enrollment(db, str(payload["sub"]), body.code)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return {"enabled": True, "backup_codes": backup_codes}


@router.post("/auth/2fa/disable")
async def two_factor_disable(
    body: TwoFactorDisableRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
):
    """Disable 2FA and clear the stored secret/backup codes. Requires the current
    password (same re-authentication rule as /auth/change-password) when the account
    has one, so a hijacked session alone can't strip 2FA off the account."""
    from src.modules.authentication.deps.auth_bearer import get_current_user

    payload = await get_current_user(request)
    try:
        await disable_totp(db, str(payload["sub"]), body.password)
    except ValueError as e:
        detail = str(e)
        status_code = (
            status.HTTP_401_UNAUTHORIZED if detail == "Current password is incorrect" else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=detail)
    return {"success": True}


@router.post("/auth/2fa/verify-login", response_model=UserResponse)
async def two_factor_verify_login(
    body: TwoFactorVerifyLoginRequest,
    response: Response,
    db: AsyncSession = Depends(get_async_session),
):
    """Second step of login for accounts with TOTP enabled: redeem the pending-login
    token from /auth/login with a 6-digit code or a backup code, and issue the real
    session token/cookie."""
    try:
        user = await resolve_pending_two_factor_login(
            db, body.login_token, code=body.code, backup_code=body.backup_code
        )
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail=str(e))
    token = create_access_token(str(user.id), user.email)
    _set_auth_cookie(response, token)
    return UserResponse.model_validate(user, from_attributes=True).model_copy(update={"access_token": token})


@router.get("/auth/2fa/status", response_model=TwoFactorStatusResponse)
async def two_factor_status(request: Request, db: AsyncSession = Depends(get_async_session)):
    from src.modules.authentication.deps.auth_bearer import get_current_user

    payload = await get_current_user(request)
    try:
        enabled = await get_totp_status(db, str(payload["sub"]))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return {"enabled": enabled}


@router.post("/auth/2fa/enroll/start", response_model=TwoFactorEnrollStartResponse)
async def two_factor_enroll_start(request: Request, db: AsyncSession = Depends(get_async_session)):
    """Generate a new TOTP secret and return its otpauth:// provisioning URI (for a QR
    code) plus the raw secret (manual-entry fallback). Does NOT enable 2FA yet -- the
    secret is stored pending until /auth/2fa/enroll/confirm verifies a code against it."""
    from src.modules.authentication.deps.auth_bearer import get_current_user

    payload = await get_current_user(request)
    try:
        data = await start_totp_enrollment(db, str(payload["sub"]))
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return data


@router.post("/auth/2fa/enroll/confirm", response_model=TwoFactorEnrollConfirmResponse)
async def two_factor_enroll_confirm(
    body: TwoFactorEnrollConfirmRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
):
    """Verify a 6-digit code against the pending secret; on success, enables 2FA and
    returns a fresh set of backup codes. The backup codes are shown here once only --
    the server keeps only their hashes."""
    from src.modules.authentication.deps.auth_bearer import get_current_user

    payload = await get_current_user(request)
    try:
        backup_codes = await confirm_totp_enrollment(db, str(payload["sub"]), body.code)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(e))
    return {"enabled": True, "backup_codes": backup_codes}


@router.post("/auth/2fa/disable")
async def two_factor_disable(
    body: TwoFactorDisableRequest,
    request: Request,
    db: AsyncSession = Depends(get_async_session),
):
    """Disable 2FA and clear the stored secret/backup codes. Requires the current
    password (same re-authentication rule as /auth/change-password) when the account
    has one, so a hijacked session alone can't strip 2FA off the account."""
    from src.modules.authentication.deps.auth_bearer import get_current_user

    payload = await get_current_user(request)
    try:
        await disable_totp(db, str(payload["sub"]), body.password)
    except ValueError as e:
        detail = str(e)
        status_code = (
            status.HTTP_401_UNAUTHORIZED if detail == "Current password is incorrect" else status.HTTP_400_BAD_REQUEST
        )
        raise HTTPException(status_code=status_code, detail=detail)
    return {"success": True}


@router.get("/auth/me", response_model=UserResponse)
async def me(request: Request, db: AsyncSession = Depends(get_async_session)):
    from src.modules.authentication.deps.auth_bearer import get_current_user
    user_payload = await get_current_user(request)
    from src.modules.authentication.service import get_user_by_id
    user = await get_user_by_id(db, user_payload["sub"])
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="User not found")
    raw = request.cookies.get(COOKIE_NAME)
    base = UserResponse.model_validate(user, from_attributes=True)
    if raw:
        return base.model_copy(update={"access_token": raw})
    return base


@router.get("/auth/whoami")
async def whoami(request: Request):
    token = request.cookies.get("auth_token")
    return {"has_token": bool(token)}


@router.get("/auth/whoami-raw")
async def whoami_raw(request: Request):
    if is_production():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return {"cookies": dict(request.cookies), "authorization": request.headers.get("authorization")}


@router.post("/auth/echo")
async def auth_echo(payload: dict | None = None):
    if is_production():
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Not found")
    return {"received": payload}
