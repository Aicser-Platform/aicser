from pydantic import BaseModel, EmailStr, Field
from typing import Optional, List, Any


# ── Auth schemas (kept for backward-compat with auth module) ─────────────────

class UserBase(BaseModel):
    username: Optional[str] = None
    email: Optional[EmailStr] = None


class UserCreate(UserBase):
    email: EmailStr = Field(...)
    password: str = Field(..., min_length=8, max_length=128)


class SignInRequest(BaseModel):
    account: Optional[str] = None
    email: Optional[EmailStr] = None
    password: str = Field(..., min_length=1)

    @classmethod
    def __get_validators__(cls):
        yield cls._normalize_account

    @classmethod
    def _normalize_account(cls, values):
        if isinstance(values, dict):
            if not values.get('account') and values.get('email'):
                values['account'] = values.get('email')
        return values


class SignInResponse(BaseModel):
    access_token: str
    token_type: str = Field(default="bearer")


# ── Profile schemas (backed by the `users` table) ────────────────────────────

class UserProfileUpdate(BaseModel):
    """Fields the user can update. All optional — only provided fields are written."""
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    username: Optional[str] = None
    phone_number: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    timezone: Optional[str] = None
    bio: Optional[str] = None
    job_role: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    data_experience: Optional[str] = None
    primary_use_case: Optional[str] = None
    data_frequency: Optional[str] = None
    goals: Optional[List[Any]] = None


class UserProfileResponse(BaseModel):
    """Profile data returned from the `users` table."""
    id: Optional[str] = None
    user_id: Optional[str] = None
    is_pro: Optional[bool] = None
    email: Optional[str] = None
    username: Optional[str] = None
    first_name: Optional[str] = None
    last_name: Optional[str] = None
    phone_number: Optional[str] = None
    company: Optional[str] = None
    location: Optional[str] = None
    timezone: Optional[str] = None
    bio: Optional[str] = None
    job_role: Optional[str] = None
    industry: Optional[str] = None
    company_size: Optional[str] = None
    data_experience: Optional[str] = None
    primary_use_case: Optional[str] = None
    data_frequency: Optional[str] = None
    goals: Optional[List[Any]] = None
    onboarding_completed_at: Optional[str] = None
    avatar_url: Optional[str] = None
    telegram_chat_id: Optional[str] = None
    telegram_username: Optional[str] = None
    telegram_status: Optional[str] = None

    class Config:
        from_attributes = True
