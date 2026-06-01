"""Tests for unified API error responses."""
import pytest
from fastapi import HTTPException

from src.shared.api_errors import (
    _normalize_detail,
    error_body,
    http_exception_to_response,
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
