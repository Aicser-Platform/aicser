from __future__ import annotations

from typing import Literal, Optional

from pydantic import BaseModel, Field

Analysis = Literal["nearest", "coverage", "density", "hotspots", "regions"]
Travel = Literal["straight", "drive", "walk", "bike"]


class PointSet(BaseModel):
    """Where a set of places comes from: one table and the columns holding each position."""

    data_source_id: str = Field(..., min_length=1, max_length=64)
    table: str = Field(..., min_length=1, max_length=256)
    lat: str = Field(..., min_length=1, max_length=128)
    lon: str = Field(..., min_length=1, max_length=128)
    label: Optional[str] = Field(None, max_length=128)
    measure: Optional[str] = Field(None, max_length=128)


class AnalyzeRequest(BaseModel):
    analysis: Analysis
    points: PointSet
    sites: Optional[PointSet] = None
    travel: Travel = "straight"
    radius_km: Optional[float] = Field(None, gt=0, le=500)
    minutes: Optional[float] = Field(None, ge=1, le=120)
    resolution: Optional[int] = Field(None, ge=3, le=11)
    min_points: int = Field(5, ge=2, le=1000)
    country: Optional[str] = Field(None, min_length=3, max_length=3)
    level: Optional[str] = Field(None, max_length=8)
    project_id: Optional[str] = Field(None, max_length=64)


class SaveResultRequest(BaseModel):
    name: str = Field(..., min_length=1, max_length=120)
    project_id: Optional[str] = Field(None, max_length=64)
