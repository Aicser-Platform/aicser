from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

EmbedScope = Literal["dashboard", "chart", "chat"]


class EmbedTokenCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    scopes: List[EmbedScope] = Field(..., min_length=1)
    resource_id: Optional[str] = None
    allowed_domains: List[str] = Field(default_factory=list)
    expires_in_hours: int = Field(default=720, ge=1, le=8760)


class EmbedTokenResponse(BaseModel):
    id: str
    name: str
    scopes: List[str]
    resource_id: Optional[str] = None
    allowed_domains: List[str] = Field(default_factory=list)
    created_at: str
    expires_at: str
    status: str = "active"
    token_preview: Optional[str] = None


class EmbedTokenCreatedResponse(EmbedTokenResponse):
    token: str
    embed_urls: dict[str, str] = Field(default_factory=dict)


class EmbedTokenListResponse(BaseModel):
    tokens: List[EmbedTokenResponse]


class EmbedTokenRevokeResponse(BaseModel):
    success: bool = True
    id: str


class EmbedTokenVerifyResponse(BaseModel):
    valid: bool
    scopes: List[str] = Field(default_factory=list)
    resource_id: Optional[str] = None
    user_id: Optional[str] = None
    org_id: Optional[str] = None
    expires_at: Optional[datetime] = None
