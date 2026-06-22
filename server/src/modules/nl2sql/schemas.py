"""Pydantic schemas for CE NL2SQL API."""

from typing import Any, Dict, Optional

from pydantic import BaseModel, Field


class GenerateRequest(BaseModel):
    query: str = Field(..., min_length=1)
    data_source_id: str = Field(..., min_length=1)
    current_sql: Optional[str] = None
    model: Optional[str] = None


class ExplainRequest(BaseModel):
    sql: str = Field(..., min_length=1)
    data_source_id: Optional[str] = None
    schema_context: Optional[str] = None
    model: Optional[str] = None


class OptimizeRequest(BaseModel):
    sql: str = Field(..., min_length=1)
    data_source_id: Optional[str] = None
    schema_context: Optional[str] = None
    model: Optional[str] = None


class StorePatternRequest(BaseModel):
    nl_query: str = Field(..., min_length=1)
    sql: str = Field(..., min_length=1)
    data_source_id: str = Field(..., min_length=1)


class GenerateResponse(BaseModel):
    success: bool
    code: Optional[str] = None
    language: str = "sql"
    explanation: Optional[str] = None
    validation_warning: Optional[str] = None
    model_id: Optional[str] = None
    model_name: Optional[str] = None
    error: Optional[str] = None


class ExplainResponse(BaseModel):
    success: bool
    explanation: Optional[str] = None
    error: Optional[str] = None


class OptimizeResponse(BaseModel):
    success: bool
    optimized_sql: Optional[str] = None
    improvements: Optional[str] = None
    error: Optional[str] = None


class ModelsResponse(BaseModel):
    success: bool = True
    models: list = Field(default_factory=list)
    default_model: str = ""


class ModelStatusResponse(BaseModel):
    success: bool = True
    model_id: Optional[str] = None
    available: bool = False
    error: Optional[str] = None
