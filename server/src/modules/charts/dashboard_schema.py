from pydantic import BaseModel
from uuid import UUID
from typing import List

class DashboardCreateSchema(BaseModel):
    layout: str
    chart_ids: List[UUID]
