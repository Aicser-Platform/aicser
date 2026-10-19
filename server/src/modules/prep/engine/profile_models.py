"""Shapes produced by ingest profiling and consumed by the onboarding wizard."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from pydantic import BaseModel, Field


class TopValue(BaseModel):
    value: Optional[str] = None
    count: int


class ColumnProfile(BaseModel):
    name: str
    storage_type: str
    inferred_type: str
    inference_confidence: float = 0.0
    null_count: int = 0
    null_ratio: float = 0.0
    distinct_count: int = 0
    is_unique: bool = False
    min_value: Optional[str] = None
    max_value: Optional[str] = None
    top_values: List[TopValue] = Field(default_factory=list)
    blank_count: int = 0
    null_token_count: int = 0


class KeyCandidate(BaseModel):
    column: str
    distinct_ratio: float
    duplicate_count: int
    is_unique: bool


class AssetProfile(BaseModel):
    row_count: int = 0
    sampled: bool = False
    columns: List[ColumnProfile] = Field(default_factory=list)
    key_candidates: List[KeyCandidate] = Field(default_factory=list)
    duration_ms: int = 0


class Finding(BaseModel):
    """One data-quality observation.

    `message_key` is an i18n key, never English prose; the client renders it.
    `suggested_step` is a runnable single-key pipeline step payload.
    """

    code: str
    severity: str = "warning"
    column: Optional[str] = None
    message_key: str
    params: Dict[str, Any] = Field(default_factory=dict)
    suggested_step: Optional[Dict[str, Any]] = None
