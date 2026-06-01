from fastapi import APIRouter, Depends, HTTPException, Response, Request, status
from sqlalchemy.ext.asyncio import AsyncSession
import logging

from src.db.session import get_async_session
from src.modules.authentication.schemas import LoginRequest, RegisterRequest, UserResponse, ChangePasswordRequest
from src.modules.authentication.service import (
    authenticate_user,
    register_user,
    create_access_token,
    change_user_password,
)
from src.modules.user.models import User

from src.modules.authentication.cookies import clear_auth_token_cookie, set_auth_token_cookie
from src.core.production import is_production

router = APIRouter()
logger = logging.getLogger(__name__)

COOKIE_NAME = "auth_token"


def _set_auth_cookie(response: Response, token: str) -> None:
    set_auth_token_cookie(response, token)


async def _ensure_ee_workspace(user: User) -> None:
    """Join deployment org / create personal org after CE email-password auth (EE only)."""
    from src.core.edition import is_ee_enabled

    if not is_ee_enabled():
        return
    try:
        from src.modules.organizations.user_workspace import ensure_user_workspace

        await ensure_user_workspace(str(user.id), user.email or "")
    except ImportError:
        pass
    except Exception as exc:
        logger.warning("Workspace provisioning after auth failed (non-fatal): %s", exc)


@router.post("/auth/login", response_model=UserResponse)
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_async_session)):
    user = await authenticate_user(db, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid email or password")
    await _ensure_ee_workspace(user)
    token = create_access_token(str(user.id), user.email)
    _set_auth_cookie(response, token)
    return UserResponse.model_validate(user, from_attributes=True).model_copy(update={"access_token": token})


@router.post("/auth/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, response: Response, db: AsyncSession = Depends(get_async_session)):
    try:
        user = await register_user(db, body.email, body.username, body.password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    await _ensure_ee_workspace(user)
    token = create_access_token(str(user.id), user.email)
    _set_auth_cookie(response, token)
    return UserResponse.model_validate(user, from_attributes=True).model_copy(update={"access_token": token})


@router.post("/auth/logout")
async def logout(response: Response):
    clear_auth_token_cookie(response)
    return {"message": "Logged out"}




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
