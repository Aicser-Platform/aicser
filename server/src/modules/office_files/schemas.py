from __future__ import annotations

from typing import Any, Dict, Literal, Optional

from pydantic import BaseModel, Field, field_validator

# Pictures are kept inline (data: URLs) in the body, so a file can be large; .docx/.pptx imports are
# capped at 25 MB in the browser too.
MAX_BODY_BYTES = 25 * 1024 * 1024
MAX_META_KEYS = 10

OfficeKind = Literal["document", "presentation"]
ShareRole = Literal["view", "edit"]
LinkAccess = Literal["organization", "public"]


class PersonShareIn(BaseModel):
    person_id: str = Field(..., min_length=1, max_length=64)
    role: ShareRole = "view"


class LinkShareIn(BaseModel):
    access: LinkAccess = "organization"


class DecisionIn(BaseModel):
    note: str = Field(default="", max_length=300)


class RemoteStateIn(BaseModel):
    index: int = Field(0, ge=0, le=10_000)
    total: int = Field(0, ge=0, le=10_000)
    title: str = Field("", max_length=300)
    notes: str = Field("", max_length=20_000)


def _small_meta(value: Optional[Dict[str, Any]]) -> Optional[Dict[str, Any]]:
    """List details only: a few scalar values (e.g. {"words": 120} or {"slides": 8})."""
    if value is None:
        return value
    if len(value) > MAX_META_KEYS:
        raise ValueError("Too many details.")
    for key, item in value.items():
        if len(key) > 40 or not (item is None or isinstance(item, (bool, int, float, str))):
            raise ValueError("Details must be short values.")
        if isinstance(item, str) and len(item) > 200:
            raise ValueError("Details must be short values.")
    return value


class OfficeFileCreate(BaseModel):
    kind: OfficeKind
    title: str = Field(..., min_length=1, max_length=200)
    body: Dict[str, Any] = Field(default_factory=dict)
    meta: Dict[str, Any] = Field(default_factory=dict)
    project_id: Optional[str] = Field(None, max_length=64)

    @field_validator("meta")
    @classmethod
    def _meta(cls, v):
        return _small_meta(v)


class OfficeFileUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    body: Optional[Dict[str, Any]] = None
    meta: Optional[Dict[str, Any]] = None
    # The version the change was made on: a stale one gets a 409 instead of overwriting.
    version: int = Field(..., ge=1)

    @field_validator("meta")
    @classmethod
    def _meta(cls, v):
        return _small_meta(v)
