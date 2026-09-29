from __future__ import annotations

from datetime import datetime
from typing import List, Literal, Optional

from pydantic import BaseModel, Field

EmbedScope = Literal["dashboard", "chart", "chat", "report"]
EmbedThemeMode = Literal["light", "dark", "auto"]
# What visitors may save from an embed: nothing (default), a picture/PDF, or the data behind
# each chart (capped, and only the rows the embed's locked filters allow).
EmbedDownload = Literal["none", "image", "data"]


class EmbedTheme(BaseModel):
    """Per-call white-label theming for an embed — applied by the embed viewer
    pages via CSS custom properties, so an embedder's own brand shows through
    instead of Aicser's defaults. All fields optional: unset ones fall back to
    the host app's normal theme."""

    primary_color: Optional[str] = Field(default=None, pattern=r"^#[0-9a-fA-F]{6}$")
    logo_url: Optional[str] = None
    font_family: Optional[str] = Field(default=None, max_length=200)
    mode: Optional[EmbedThemeMode] = None
    hide_aicser_branding: bool = False


class EmbedTokenCreateRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    scopes: List[EmbedScope] = Field(..., min_length=1)
    resource_id: Optional[str] = None
    allowed_domains: List[str] = Field(default_factory=list)
    expires_in_hours: int = Field(default=720, ge=1, le=8760)
    theme: Optional[EmbedTheme] = None
    download: EmbedDownload = "none"


class EmbedTokenUpdateRequest(BaseModel):
    """Theme-only edits reuse the existing token/URLs already handed to the
    embedder — there's no reason to invalidate a distributed embed link just to
    change its brand color."""

    theme: Optional[EmbedTheme] = None


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
    theme: Optional[EmbedTheme] = None
    download: EmbedDownload = "none"
    kind: Optional[str] = None


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
    theme: Optional[EmbedTheme] = None
    download: EmbedDownload = "none"


class EmbedSessionRequest(BaseModel):
    """Sent by an embed page when it opens: the link token and the site showing the page."""

    token: str = Field(..., min_length=10, max_length=8192)
    parent_origin: Optional[str] = Field(default=None, max_length=300)
    scope: Optional[EmbedScope] = None


class EmbedSessionResponse(BaseModel):
    token: str
    expires_at: Optional[str] = None
    download: EmbedDownload = "none"
    theme: Optional[EmbedTheme] = None
    single_use: bool = False
    allowed_origins: List[str] = Field(default_factory=list)
