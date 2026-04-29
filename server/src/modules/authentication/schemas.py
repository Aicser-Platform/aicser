from pydantic import BaseModel, Field


class SignInRequest(BaseModel):
    # Backwards-compatible: accept either `account` or `email` as identifier
    account: str | None = None
    email: str | None = None
    password: str = Field(..., min_length=1)


class SignInResponse(BaseModel):
    # Compatibility: some callers expect access_token + token_type
    access_token: str | None = None
    token_type: str | None = "bearer"
    # Legacy fields
    expires_in: int | None = None
    refresh_token: str | None = None


class RefreshTokenRequest(BaseModel):
    refresh_token: str


class RefreshTokenResponse(BaseModel):
    access_token: str
    expires_in: int
