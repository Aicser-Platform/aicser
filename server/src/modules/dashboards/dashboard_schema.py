from pydantic import BaseModel, Field
from typing import Optional, Dict, Any, List
from uuid import UUID
from datetime import datetime


class DashboardCreateRequest(BaseModel):
    title: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    collectionId: Optional[UUID] = None
    tags: Optional[List[str]] = None


class DashboardUpdateRequest(BaseModel):
    title: Optional[str] = None
    description: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    collectionId: Optional[UUID] = None
    isFavorite: Optional[bool] = None
    tags: Optional[List[str]] = None


class DashboardResponse(BaseModel):
    id: UUID
    project_id: Optional[UUID] = None
    title: Optional[str]
    name: Optional[str] = None
    description: Optional[str] = None
    config: Optional[Dict[str, Any]] = None
    collectionId: Optional[str] = None
    isFavorite: Optional[bool] = None
    lastOpenedAt: Optional[datetime] = None
    tags: Optional[List[str]] = None
    chartCount: Optional[int] = None
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True
        extra = "allow"


class DashboardListResponse(BaseModel):
    dashboards: List[DashboardResponse]
    total: Optional[int] = None
    limit: Optional[int] = None
    offset: Optional[int] = None
    hasMore: Optional[bool] = None
