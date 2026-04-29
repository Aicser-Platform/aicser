"""
Query parameter utilities for API endpoints
"""

from typing import Optional
from pydantic import BaseModel, Field

class BaseFilterParams(BaseModel):
    """Base class for filter parameters"""
    page: Optional[int] = Field(default=1, ge=1, description="Page number")
    page_size: Optional[int] = Field(default=10, ge=1, le=100, description="Items per page")
    search: Optional[str] = Field(default=None, description="Search query")
    sort_by: Optional[str] = Field(default=None, description="Field to sort by")
    sort_order: Optional[str] = Field(default="asc", description="Sort order (asc/desc)")
    
    @property
    def offset(self) -> int:
        """Calculate offset for pagination"""
        page = self.page or 1
        page_size = self.page_size or 10
        return (page - 1) * page_size
    
    @property
    def limit(self) -> int:
        """Get limit for pagination"""
        return (self.page_size or 10)

class UserFilterParams(BaseFilterParams):
    """Filter parameters for user endpoints"""
    email: Optional[str] = Field(default=None, description="Filter by email")
    is_active: Optional[bool] = Field(default=None, description="Filter by active status")
    role: Optional[str] = Field(default=None, description="Filter by role")

class OrganizationFilterParams(BaseFilterParams):
    """Filter parameters for organization endpoints"""
    name: Optional[str] = Field(default=None, description="Filter by organization name")
    plan_type: Optional[str] = Field(default=None, description="Filter by plan type")
    is_active: Optional[bool] = Field(default=None, description="Filter by active status")

class ProjectFilterParams(BaseFilterParams):
    """Filter parameters for project endpoints"""
    name: Optional[str] = Field(default=None, description="Filter by project name")
    organization_id: Optional[int] = Field(default=None, description="Filter by organization ID")
    status: Optional[str] = Field(default=None, description="Filter by project status")

class DataSourceFilterParams(BaseFilterParams):
    """Filter parameters for data source endpoints"""
    name: Optional[str] = Field(default=None, description="Filter by data source name")
    type: Optional[str] = Field(default=None, description="Filter by data source type")
    is_active: Optional[bool] = Field(default=None, description="Filter by active status")

class ChatFilterParams(BaseFilterParams):
    """Filter parameters for chat endpoints"""
    title: Optional[str] = Field(default=None, description="Filter by chat title")
    user_id: Optional[int] = Field(default=None, description="Filter by user ID")
    is_active: Optional[bool] = Field(default=None, description="Filter by active status")
