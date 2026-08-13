from fastapi import APIRouter, Depends, HTTPException, Response, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from src.db.session import get_async_session
from src.modules.authentication.schemas import (
    ChangePasswordRequest,
    ForgotPasswordRequest,
    LoginRequest,
    PasswordResetMessageResponse,
    RegisterRequest,
    ResetPasswordRequest,
    UserResponse,
)
from src.modules.authentication.service import (
    PASSWORD_RESET_PUBLIC_MESSAGE,
    create_access_token,
    change_user_password,
    request_password_reset,
    reset_password_with_token_or_code,
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


@router.post("/auth/login", response_model=UserResponse)
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_async_session)):
    user = await _authenticate(db, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid email or password")
    token = create_access_token(str(user.id), user.email)
    _set_auth_cookie(response, token)
    return UserResponse.model_validate(user, from_attributes=True).model_copy(update={"access_token": token})


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
        await change_user_password(db, str(payload["sub"]), body.password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail=str(e))
    return {"message": "Password updated"}


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
