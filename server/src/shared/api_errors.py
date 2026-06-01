"""Unified API error response helpers (RFC 7807-inspired, flat JSON for clients)."""
from __future__ import annotations

from typing import Any, Optional

from fastapi import HTTPException
from fastapi.responses import JSONResponse


def _normalize_detail(detail: Any) -> tuple[str, str, Optional[Any]]:
    """Return (error_code, message, details)."""
    if detail is None:
        return "error", "An error occurred", None
    if isinstance(detail, str):
        return "error", detail, None
    if isinstance(detail, dict):
        code = str(detail.get("error") or detail.get("code") or "error")
        message = str(
            detail.get("message")
            or detail.get("detail")
            or detail.get("msg")
            or "An error occurred"
        )
        extra = detail.get("details")
        if extra is None and "message" not in detail and "error" not in detail:
            extra = {k: v for k, v in detail.items() if k not in ("error", "code", "message", "detail")}
            if not extra:
                extra = None
        return code, message, extra
    if isinstance(detail, list):
        return "validation_error", "Request validation failed", detail
    return "error", str(detail), None


def error_body(
    error: str,
    message: str,
    *,
    details: Any = None,
    **extra: Any,
) -> dict[str, Any]:
    body: dict[str, Any] = {"error": error, "message": message}
    if details is not None:
        body["details"] = details
    body.update(extra)
    return body


def http_error_response(
    status_code: int,
    detail: Any,
    *,
    headers: Optional[dict[str, str]] = None,
    **extra: Any,
) -> JSONResponse:
    code, message, details = _normalize_detail(detail)
    body = error_body(code, message, details=details, **extra)
    return JSONResponse(status_code=status_code, content=body, headers=headers)


def http_exception_to_response(exc: HTTPException) -> JSONResponse:
    extra: dict[str, Any] = {}
    if exc.headers:
        extra_headers = dict(exc.headers)
    else:
        extra_headers = None
    retry_after = (exc.headers or {}).get("Retry-After") if exc.headers else None
    if exc.status_code == 429:
        extra["retry_after"] = retry_after
    return http_error_response(
        exc.status_code,
        exc.detail,
        headers=extra_headers,
        **extra,
    )


def raise_http(status_code: int, error: str, message: str, **details: Any) -> None:
    """Raise HTTPException with unified detail shape."""
    payload: dict[str, Any] = {"error": error, "message": message}
    if details:
        payload["details"] = details
    raise HTTPException(status_code=status_code, detail=payload)
