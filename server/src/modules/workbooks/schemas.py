from typing import List, Literal, Optional

from pydantic import BaseModel, Field

MAX_RANGES = 100
MAX_DOC_B64 = 36 * 1024 * 1024  # 25 MB document, base64


class DataRange(BaseModel):
    """Data written into the sheet from a query: where it sits, what produced it and when.
    ``live`` ranges re-run their query as the viewer on refresh; ``snapshot`` ranges (a
    notebook's Python result, pasted data) keep their values."""

    id: str = Field(..., min_length=1, max_length=40)
    name: Optional[str] = Field(None, max_length=120)
    sheet: int = Field(0, ge=0, le=1000)
    row: int = Field(1, ge=1, le=1_048_576)
    column: int = Field(1, ge=1, le=16_384)
    width: int = Field(0, ge=0, le=16_384)
    height: int = Field(0, ge=0, le=1_048_576)
    mode: Literal["live", "snapshot"] = "live"
    data_source_id: Optional[str] = Field(None, max_length=64)
    source_name: Optional[str] = Field(None, max_length=200)
    sql: Optional[str] = Field(None, max_length=20000)
    refreshed_at: Optional[str] = Field(None, max_length=40)
    row_count: Optional[int] = Field(None, ge=0)
    truncated: bool = False
    pending: bool = False  # created elsewhere ("Open as workbook"); filled on first open


class WorkbookCreate(BaseModel):
    title: str = Field(..., min_length=1, max_length=200)
    project_id: Optional[str] = Field(None, max_length=64)
    locale: Optional[str] = Field(None, max_length=16)
    timezone: Optional[str] = Field(None, max_length=64)
    ranges: List[DataRange] = Field(default_factory=list, max_length=MAX_RANGES)


class WorkbookUpdate(BaseModel):
    title: Optional[str] = Field(None, min_length=1, max_length=200)
    description: Optional[str] = Field(None, max_length=2000)
    doc: Optional[str] = Field(None, max_length=MAX_DOC_B64)  # base64 of the IronCalc document
    ranges: Optional[List[DataRange]] = Field(None, max_length=MAX_RANGES)
    visibility: Optional[Literal["private", "project"]] = None
    version: int
