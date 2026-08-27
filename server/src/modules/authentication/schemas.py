from pydantic import BaseModel, EmailStr, Field
from uuid import UUID
from typing import List, Optional, Literal


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8)


class ChangePasswordRequest(BaseModel):
    password: str = Field(min_length=8)
    # Required only when the account already has a password (verified in
    # change_user_password) -- optional here so first-time password setup
    # (invite acceptance, OAuth-only accounts) keeps working with no value.
    current_password: Optional[str] = None


class ForgotPasswordRequest(BaseModel):
    email: EmailStr


class ResetPasswordRequest(BaseModel):
    password: str = Field(min_length=8)
    token: Optional[str] = None
    email: Optional[EmailStr] = None
    code: Optional[str] = Field(default=None, min_length=6, max_length=12)


class PasswordResetMessageResponse(BaseModel):
    message: str


class UserResponse(BaseModel):
    id: UUID
    email: Optional[str]
    username: Optional[str]
    is_verified: Optional[bool]
    # Same JWT as httpOnly auth_token; CE clients may send Authorization: Bearer.
    access_token: Optional[str] = None

    model_config = {"from_attributes": True}


class TokenExchangeRequest(BaseModel):
    provider: Literal["supabase", "keycloak"]
    token: str


# ── Two-factor authentication (TOTP) ──────────────────────────────────────────

class LoginResponse(UserResponse):
    """/auth/login response. For accounts without 2FA this is identical to
    UserResponse (two_factor_required defaults to False, login_token to None) --
    unchanged from before 2FA existed. When the account has TOTP enabled, no
    access_token/cookie is issued yet; login_token must be redeemed via
    /auth/2fa/verify-login instead."""
    two_factor_required: bool = False
    login_token: Optional[str] = None


class TwoFactorStatusResponse(BaseModel):
    enabled: bool


class TwoFactorEnrollStartResponse(BaseModel):
    secret: str
    otpauth_uri: str
    account: str
    issuer: str


class TwoFactorEnrollConfirmRequest(BaseModel):
    code: str = Field(min_length=6, max_length=6)


class TwoFactorEnrollConfirmResponse(BaseModel):
    enabled: bool
    backup_codes: List[str]


class TwoFactorDisableRequest(BaseModel):
    # Required whenever the account has a password (verified in disable_totp);
    # optional only for the rare password-less/OAuth-only account.
    password: Optional[str] = None


class TwoFactorVerifyLoginRequest(BaseModel):
    login_token: str
    code: Optional[str] = Field(default=None, min_length=6, max_length=6)
    backup_code: Optional[str] = None
