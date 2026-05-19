from pydantic import BaseModel, EmailStr, Field
from uuid import UUID
from typing import Optional, Literal


class LoginRequest(BaseModel):
    email: EmailStr
    password: str


class RegisterRequest(BaseModel):
    email: EmailStr
    username: str = Field(min_length=1, max_length=100)
    password: str = Field(min_length=8)




class ChangePasswordRequest(BaseModel):
    password: str = Field(min_length=8)

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
