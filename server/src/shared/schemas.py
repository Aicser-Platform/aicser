from datetime import datetime
from typing import Generic, List, Optional, TypeVar
from uuid import UUID

from pydantic import BaseModel, Field

T = TypeVar("T")


class PaginationSchema(BaseModel):
    total: int = Field(0, description="Total number of records")
    offset: int = Field(0, description="Number of records to skip")
    limit: int = Field(10, description="Number of records per page")
    has_more: bool = Field(False, description="Whether there are more records")
    total_pages: int = Field(1, description="Total number of pages")
    current_page: int = Field(1, description="Current page number")


class ListResponseSchema(BaseModel, Generic[T]):
    items: List[T]
    pagination: PaginationSchema


class BaseSchema(BaseModel):
    id: UUID = Field(..., description="Unique identifier")
    created_at: Optional[datetime] = Field(
        None, description="Date and time of creation"
    )
    updated_at: Optional[datetime] = Field(
        None, description="Date and time of last update"
    )
    is_active: Optional[bool] = Field(
        True, description="Flag indicating if the record is active"
    )
    is_deleted: Optional[bool] = Field(
        False, description="Flag indicating if the record is deleted"
    )
