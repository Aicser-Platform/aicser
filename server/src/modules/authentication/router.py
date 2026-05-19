from fastapi import APIRouter, Depends, HTTPException, Response, Request, status
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import get_async_session
from src.modules.authentication.schemas import LoginRequest, RegisterRequest, UserResponse, ChangePasswordRequest
from src.modules.authentication.service import (
    authenticate_user,
    register_user,
    create_access_token,
    change_user_password,
)

router = APIRouter()

COOKIE_NAME = "auth_token"
COOKIE_MAX_AGE = 7 * 24 * 60 * 60  # 7 days in seconds


def _set_auth_cookie(response: Response, token: str) -> None:
    import os
    secure = os.getenv("ENVIRONMENT", "development") == "production"
    response.set_cookie(
        key=COOKIE_NAME,
        value=token,
        httponly=True,
        secure=secure,
        samesite="lax",
        max_age=COOKIE_MAX_AGE,
        path="/",
    )


@router.post("/auth/login", response_model=UserResponse)
async def login(body: LoginRequest, response: Response, db: AsyncSession = Depends(get_async_session)):
    user = await authenticate_user(db, body.email, body.password)
    if not user:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED,
                            detail="Invalid email or password")
    token = create_access_token(str(user.id), user.email)
    _set_auth_cookie(response, token)
    return UserResponse.model_validate(user, from_attributes=True).model_copy(update={"access_token": token})


@router.post("/auth/register", response_model=UserResponse, status_code=status.HTTP_201_CREATED)
async def register(body: RegisterRequest, response: Response, db: AsyncSession = Depends(get_async_session)):
    try:
        user = await register_user(db, body.email, body.username, body.password)
    except ValueError as e:
        raise HTTPException(status_code=status.HTTP_409_CONFLICT, detail=str(e))
    token = create_access_token(str(user.id), user.email)
    _set_auth_cookie(response, token)
    return UserResponse.model_validate(user, from_attributes=True).model_copy(update={"access_token": token})


@router.post("/auth/logout")
async def logout(response: Response):
    response.delete_cookie(key=COOKIE_NAME, path="/")
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
    return {"cookies": dict(request.cookies), "authorization": request.headers.get("authorization")}


@router.post("/auth/echo")
async def auth_echo(payload: dict | None = None):
    return {"received": payload}
