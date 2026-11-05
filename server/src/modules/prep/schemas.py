from typing import Any, Dict, List, Literal, Optional

from pydantic import BaseModel, Field

MAX_STEPS = 200


class SourceRef(BaseModel):
    data_source_id: str = Field(..., min_length=1, max_length=64)
    # File sources expose one table named "data"; databases need schema.table.
    table: Optional[str] = Field(default=None, max_length=255)
    # Enterprise pipelines: preview the landed raw table instead of the live source.
    lake_object_id: Optional[str] = Field(default=None, max_length=64)


class Sampled(SourceRef):
    steps: List[Dict[str, Any]] = Field(default_factory=list, max_length=MAX_STEPS)
    # first: the first rows (fast, predictable); random: rows from anywhere; full: the whole table up to a cap.
    sample_mode: Literal["first", "random", "full"] = "first"
    sample_rows: int = Field(default=1000, ge=10, le=50000)


class PreviewRequest(Sampled):
    up_to_step: Optional[int] = Field(default=None, ge=0)
    limit: int = Field(default=200, ge=1, le=1000)


class ProfileRequest(Sampled):
    pass


class DetectRequest(Sampled):
    pass


class FailuresRequest(Sampled):
    step: int = Field(..., ge=0)
    column: str = Field(..., min_length=1, max_length=255)


class FormulaRequest(BaseModel):
    expression: str = Field(..., min_length=1, max_length=4000)
    language: Literal["excel", "sql"] = "excel"
    columns: List[str] = Field(default_factory=list, max_length=2000)


class DatePatternRequest(BaseModel):
    example: str = Field(..., min_length=1, max_length=80)


class RecipeCreate(SourceRef):
    name: str = Field(..., min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    steps: List[Dict[str, Any]] = Field(default_factory=list, max_length=MAX_STEPS)
    project_id: Optional[str] = None


class ColumnMeaning(BaseModel):
    description: Optional[str] = Field(default=None, max_length=500)
    role: Optional[Literal["amount", "count", "category", "date", "id", "text"]] = None
    personal: bool = False


class CleaningDecision(BaseModel):
    """What someone decided about one review item: keep the values, exclude the rows, or just note it."""

    action: Literal["keep", "exclude", "note"]
    reason: Optional[str] = Field(default=None, max_length=500)


class CleaningLog(BaseModel):
    decisions: Dict[str, CleaningDecision] = Field(default_factory=dict, max_length=500)
    note: Optional[str] = Field(default=None, max_length=5000)


class RecipeUpdate(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
    description: Optional[str] = Field(default=None, max_length=2000)
    table: Optional[str] = Field(default=None, max_length=255)
    steps: Optional[List[Dict[str, Any]]] = Field(default=None, max_length=MAX_STEPS)
    column_meta: Optional[Dict[str, ColumnMeaning]] = Field(default=None, max_length=500)
    cleaning: Optional[CleaningLog] = None


class PublishRequest(BaseModel):
    note: Optional[str] = Field(default=None, max_length=1000)


class SaveAsTableRequest(BaseModel):
    name: Optional[str] = Field(default=None, min_length=1, max_length=200)
