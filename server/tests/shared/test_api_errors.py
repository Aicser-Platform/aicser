"""Tests for unified API error responses."""
import json

import pytest
from fastapi import HTTPException

from src.shared.api_errors import (
    _normalize_detail,
    error_body,
    http_exception_to_response,
    raise_http,
)


def test_normalize_string_detail():
    code, msg, details = _normalize_detail("Not found")
    assert code == "error"
    assert msg == "Not found"
    assert details is None


def test_normalize_dict_detail():
    code, msg, details = _normalize_detail(
        {"error": "not_found", "message": "Dashboard missing", "id": "x"}
    )
    assert code == "not_found"
    assert msg == "Dashboard missing"


def test_http_exception_response_shape():
    import json

    exc = HTTPException(status_code=404, detail={"error": "not_found", "message": "Gone"})
    resp = http_exception_to_response(exc)
    assert resp.status_code == 404
    body = json.loads(resp.body.decode())
    assert body["error"] == "not_found"
    assert body["message"] == "Gone"


def test_error_body_validation():
    body = error_body("validation_error", "Failed", details=[{"loc": ["x"]}])
    assert body["error"] == "validation_error"
    assert body["details"]


def test_raw_http_exception_sibling_extras_are_preserved_under_details():
    """Extra fields raised as siblings of error/message used to be dropped by the global
    handler — a gotcha hit three times (ai_credits_exhausted, data_source_limit_reached, the
    upgrade prompt). They now survive under "details", same as raise_http()."""
    exc = HTTPException(
        status_code=429,
        detail={"error": "ai_credits_exhausted", "message": "Out of credits", "current_used": 100, "limit": 100},
    )
    resp = http_exception_to_response(exc)
    body = json.loads(resp.body.decode())
    assert body["error"] == "ai_credits_exhausted"
    assert body["message"] == "Out of credits"
    assert body["details"] == {"current_used": 100, "limit": 100}


def test_raise_http_preserves_extra_fields_under_details():
    """raise_http is the correct way to attach extra fields - they must
    survive the same global-exception-handler round trip intact, since the
    frontend reads them from response.details (e.g. errorData.details.limit)."""
    try:
        raise_http(429, "ai_credits_exhausted", "Out of credits", current_used=100, limit=100, cost=5)
    except HTTPException as exc:
        resp = http_exception_to_response(exc)
    else:
        pytest.fail("raise_http should raise")

    body = json.loads(resp.body.decode())
    assert body["error"] == "ai_credits_exhausted"
    assert body["message"] == "Out of credits"
    assert body["details"] == {"current_used": 100, "limit": 100, "cost": 5}


def test_structured_fields_survive_alongside_message():
    code, msg, details = _normalize_detail({
        "error": "upgrade_required", "message": "Needs Pro", "upgrade_required": True, "required_plan": "pro",
    })
    assert code == "upgrade_required" and msg == "Needs Pro"
    assert details == {"upgrade_required": True, "required_plan": "pro"}
