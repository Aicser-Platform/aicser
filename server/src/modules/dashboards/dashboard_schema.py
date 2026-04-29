from pydantic import BaseModel
from typing import Optional, Dict, Any, List
from uuid import UUID
from datetime import datetime


class DashboardCreateRequest(BaseModel):
    title: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


class DashboardUpdateRequest(BaseModel):
    title: Optional[str] = None
    config: Optional[Dict[str, Any]] = None


class DashboardResponse(BaseModel):
    id: UUID
    project_id: UUID
    title: Optional[str]
    config: Optional[Dict[str, Any]]
    created_at: Optional[datetime] = None
    updated_at: Optional[datetime] = None

    class Config:
        from_attributes = True


class DashboardListResponse(BaseModel):
    dashboards: List[DashboardResponse]
