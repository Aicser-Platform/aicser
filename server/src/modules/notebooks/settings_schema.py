"""Notebook enterprise settings stored in notebooks.settings (JSONB)."""
from __future__ import annotations

from typing import Any, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

_PARAM_NAME = __import__("re").compile(r"^[A-Za-z_][A-Za-z0-9_]{0,39}$")


class NotebookParameterDef(BaseModel):
    name: str = Field(..., min_length=1, max_length=40)
    label: Optional[str] = Field(None, max_length=120)
    type: Literal["string", "number", "boolean", "date"] = "string"
    default: Optional[Any] = None
    required: bool = False

    @field_validator("name")
    @classmethod
    def _name(cls, v: str) -> str:
        if not _PARAM_NAME.match(v):
            raise ValueError("Parameter names use letters, digits, underscores; start with a letter.")
        return v


class NotebookGitSync(BaseModel):
    remote_url: Optional[str] = Field(None, max_length=500)
    branch: str = Field("main", max_length=120)
    last_export_at: Optional[str] = Field(None, max_length=40)
    last_commit_message: Optional[str] = Field(None, max_length=500)
    auto_export_on_save: bool = False


class NotebookCertification(BaseModel):
    status: Literal["draft", "in_review", "approved", "rejected"] = "draft"
    submitted_by: Optional[str] = None
    certified_by: Optional[str] = None
    certified_at: Optional[str] = None
    note: Optional[str] = Field(None, max_length=2000)
    locks_edits: bool = False


class AnalyzeBinding(BaseModel):
    """Grid-anchored pivot output linked back to the Analyze panel (workbooks)."""

    id: str = Field(..., min_length=1, max_length=64)
    kind: Literal["pivot"] = "pivot"
    sheet_index: int = Field(0, ge=0)
    row: int = Field(1, ge=1)
    column: int = Field(1, ge=1)
    width: int = Field(1, ge=1, le=512)
    height: int = Field(1, ge=1, le=4096)
    analyze_binding: dict = Field(default_factory=dict)


class VisualEmbed(BaseModel):
    """Floating chart or image anchored to a sheet cell (workbooks; optional on notebooks)."""

    id: str = Field(..., min_length=1, max_length=64)
    kind: Literal["chart", "image"] = "chart"
    sheet_index: int = Field(0, ge=0)
    row: int = Field(1, ge=1)
    column: int = Field(1, ge=1)
    width: int = Field(420, ge=120, le=1200)
    height: int = Field(260, ge=80, le=800)
    payload: dict = Field(default_factory=dict)


class NotebookSettings(BaseModel):
    parameters: List[NotebookParameterDef] = Field(default_factory=list, max_length=50)
    compute_profile: Literal["browser", "server"] = "browser"
    git: NotebookGitSync = Field(default_factory=NotebookGitSync)
    certification: NotebookCertification = Field(default_factory=NotebookCertification)
    visual_embeds: List[VisualEmbed] = Field(default_factory=list, max_length=32)
    analyze_bindings: List[AnalyzeBinding] = Field(default_factory=list, max_length=48)


def parse_settings(raw: Optional[dict]) -> NotebookSettings:
    if not raw:
        return NotebookSettings()
    try:
        return NotebookSettings.model_validate(raw)
    except Exception:
        return NotebookSettings()
