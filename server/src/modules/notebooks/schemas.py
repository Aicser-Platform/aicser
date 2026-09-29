from __future__ import annotations

import re
from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field, field_validator

MAX_CELLS = 300
MAX_SOURCE = 100_000
MAX_OUTPUT_ROWS = 200
MAX_OUTPUT_TEXT = 20_000
MAX_IMAGE_CHARS = 2_000_000
MAX_NOTEBOOK_BYTES = 8 * 1024 * 1024
_NAME = re.compile(r"^[A-Za-z_][A-Za-z0-9_]{0,39}$")

CellType = Literal["markdown", "sql", "python", "chart", "pivot"]


class CellOutput(BaseModel):
    """A snapshot of a cell's last run, kept small so notebooks open instantly."""

    kind: Literal["table", "text", "error", "image", "chart"]
    columns: Optional[List[str]] = Field(None, max_length=500)
    rows: Optional[List[Any]] = None
    row_count: Optional[int] = None
    text: Optional[str] = None
    image: Optional[str] = None
    ran_at: Optional[str] = Field(None, max_length=40)
    duration_ms: Optional[int] = None

    @field_validator("rows")
    @classmethod
    def _rows(cls, v):
        return v[:MAX_OUTPUT_ROWS] if isinstance(v, list) else v

    @field_validator("text")
    @classmethod
    def _text(cls, v):
        return v[:MAX_OUTPUT_TEXT] if isinstance(v, str) else v

    @field_validator("image")
    @classmethod
    def _image(cls, v):
        if v is None:
            return v
        if not v.startswith("data:image/png;base64,") or len(v) > MAX_IMAGE_CHARS:
            return None  # only small PNG figures are kept
        return v


class Cell(BaseModel):
    id: str = Field(..., min_length=1, max_length=40)
    type: CellType
    source: str = Field("", max_length=MAX_SOURCE)
    name: Optional[str] = Field(None, max_length=40)
    data_source_id: Optional[str] = Field(None, max_length=64)
    chart: Optional[Dict[str, Any]] = None  # chart or pivot settings
    collapsed: bool = False
    output: Optional[CellOutput] = None

    @field_validator("name")
    @classmethod
    def _name(cls, v):
        if v in (None, ""):
            return None
        if not _NAME.match(v):
            raise ValueError("A result name uses letters, digits and underscores, and starts with a letter.")
        return v


class NotebookCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    cells: List[Cell] = Field(default_factory=list, max_length=MAX_CELLS)
    project_id: Optional[str] = Field(None, max_length=64)


class NotebookUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    cells: Optional[List[Cell]] = Field(None, max_length=MAX_CELLS)
    visibility: Optional[Literal["private", "project"]] = None
    version: int = Field(..., ge=1)


class NotebookImport(BaseModel):
    notebook: Dict[str, Any]
    title: Optional[str] = Field(None, max_length=200)
    project_id: Optional[str] = Field(None, max_length=64)


class SaveDatasetRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    columns: List[str] = Field(..., min_length=1, max_length=500)
    rows: List[List[Any]] = Field(..., min_length=1, max_length=200_000)
    project_id: Optional[str] = Field(None, max_length=64)
