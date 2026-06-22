"""CE NL2SQL HTTP router."""

from __future__ import annotations

import logging
import os
from typing import Any, Dict, Union

from fastapi import APIRouter, Depends, HTTPException, Query

from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.helpers import extract_user_payload
from src.modules.nl2sql.schemas import (
    ExplainRequest,
    ExplainResponse,
    GenerateRequest,
    GenerateResponse,
    ModelStatusResponse,
    ModelsResponse,
    OptimizeRequest,
    OptimizeResponse,
    StorePatternRequest,
)
from src.modules.nl2sql.service import NL2SQLService
from src.shared.middleware.rate_limiter import RateLimiter

logger = logging.getLogger(__name__)

router = APIRouter(tags=["nl2sql"])

_service = NL2SQLService()

_generate_rpm = int(os.getenv("AISER_CE_NL2SQL_RPM", "20"))
_aux_rpm = int(os.getenv("AISER_CE_NL2SQL_AUX_RPM", "40"))
_generate_limiter = RateLimiter(requests_per_minute=_generate_rpm, cost_weight=5.0)
_aux_limiter = RateLimiter(requests_per_minute=_aux_rpm, cost_weight=2.0)
_models_limiter = RateLimiter(requests_per_minute=60, cost_weight=1.0)


def _user_id_from_token(token_or_dict: Union[str, dict]) -> str:
    if isinstance(token_or_dict, dict):
        payload = token_or_dict
    else:
        try:
            payload = extract_user_payload(token_or_dict)
        except Exception:
            payload = {}
    return str(payload.get("id") or payload.get("user_id") or payload.get("sub") or "")


def _org_id_from_token(token_or_dict: Union[str, dict]) -> str:
    if isinstance(token_or_dict, dict):
        payload = token_or_dict
    else:
        try:
            payload = extract_user_payload(token_or_dict)
        except Exception:
            payload = {}
    return str(payload.get("organization_id") or "default")


async def _enforce_rate_limit(limiter: RateLimiter, token: Union[str, dict]) -> None:
    user_id = _user_id_from_token(token) or "anonymous"
    org_id = _org_id_from_token(token)
    allowed, reason = await limiter.check_rate_limit(user_id, org_id, cost=1.0)
    if not allowed:
        raise HTTPException(status_code=429, detail=reason or "Rate limit exceeded", headers={"Retry-After": "60"})


@router.post("/generate", response_model=GenerateResponse)
async def generate_sql(
    body: GenerateRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
) -> Dict[str, Any]:
    await _enforce_rate_limit(_generate_limiter, current_token)
    user_id = _user_id_from_token(current_token)
    result = await _service.generate_sql(
        query=body.query.strip(),
        data_source_id=body.data_source_id.strip(),
        user_id=user_id or None,
        model=body.model,
        current_sql=body.current_sql,
    )
    return result


@router.post("/explain", response_model=ExplainResponse)
async def explain_sql(
    body: ExplainRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
) -> Dict[str, Any]:
    await _enforce_rate_limit(_aux_limiter, current_token)
    user_id = _user_id_from_token(current_token)
    if not body.sql.strip():
        raise HTTPException(status_code=400, detail="sql is required")
    return await _service.explain_sql(
        sql=body.sql.strip(),
        schema_context=body.schema_context,
        data_source_id=body.data_source_id,
        user_id=user_id or None,
        model=body.model,
    )


@router.post("/optimize", response_model=OptimizeResponse)
async def optimize_sql(
    body: OptimizeRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
) -> Dict[str, Any]:
    await _enforce_rate_limit(_aux_limiter, current_token)
    user_id = _user_id_from_token(current_token)
    if not body.sql.strip():
        raise HTTPException(status_code=400, detail="sql is required")
    return await _service.optimize_sql(
        sql=body.sql.strip(),
        schema_context=body.schema_context,
        data_source_id=body.data_source_id,
        user_id=user_id or None,
        model=body.model,
    )


@router.get("/models", response_model=ModelsResponse)
async def list_models(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
) -> Dict[str, Any]:
    await _enforce_rate_limit(_models_limiter, current_token)
    user_id = _user_id_from_token(current_token)
    return await _service.list_models(user_id or None)


@router.get("/model-status", response_model=ModelStatusResponse)
async def model_status(
    model_id: str = Query(...),
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
) -> Dict[str, Any]:
    user_id = _user_id_from_token(current_token)
    return await _service.model_status(user_id or None, model_id)


@router.post("/patterns")
async def store_pattern(
    body: StorePatternRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
) -> Dict[str, Any]:
    user_id = _user_id_from_token(current_token)
    return await _service.store_pattern_from_execution(
        nl_query=body.nl_query.strip(),
        sql=body.sql.strip(),
        data_source_id=body.data_source_id.strip(),
        user_id=user_id or None,
    )
