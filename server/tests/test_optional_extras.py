"""Unit tests for optional `[ml]` and `[ai]` extras guards."""

from __future__ import annotations

import sys
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from src.core.optional_deps import (
    has_ai_extra,
    has_ml_extra,
    has_presidio_ml,
    require_ai_extra,
    require_ml_extra,
    require_presidio_extra,
)


def _fake_find_spec(missing: set[str]):
    def _finder(name: str, package=None):
        if name in missing:
            return None
        return object()

    return _finder


def test_require_ml_extra_raises_400_requires_full_image_when_prophet_missing():
    with patch("importlib.util.find_spec", side_effect=_fake_find_spec({"prophet"})):
        assert not has_ml_extra()
        with pytest.raises(HTTPException) as exc_info:
            require_ml_extra("Forecasting")
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] == "requires_full_image"
        assert exc_info.value.detail["missing_extra"] == "ml"
        assert exc_info.value.detail["install_command"] == "pip install aiser-world-chat2chart[ml]"


def test_require_ml_extra_raises_400_when_statsmodels_missing():
    with patch("importlib.util.find_spec", side_effect=_fake_find_spec({"statsmodels"})):
        with pytest.raises(HTTPException) as exc_info:
            require_ml_extra("Forecasting")
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] == "requires_full_image"
        assert "statsmodels" in exc_info.value.detail["missing_modules"]


def test_require_presidio_extra_raises_400_requires_full_image_when_missing():
    with patch("importlib.util.find_spec", side_effect=_fake_find_spec({"presidio_analyzer", "spacy"})):
        assert not has_presidio_ml()
        with pytest.raises(HTTPException) as exc_info:
            require_presidio_extra("PII Scrubbing")
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] == "requires_full_image"
        assert exc_info.value.detail["missing_extra"] == "ml"


def test_require_ai_extra_raises_400_when_langgraph_missing():
    with patch("importlib.util.find_spec", side_effect=_fake_find_spec({"langgraph"})):
        assert not has_ai_extra()
        with pytest.raises(HTTPException) as exc_info:
            require_ai_extra("AI Agent")
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["code"] == "requires_full_image"
        assert exc_info.value.detail["missing_extra"] == "ai"
        assert exc_info.value.detail["install_command"] == "pip install aiser-world-chat2chart[ai]"


def test_guards_do_not_import_heavy_modules():
    before = set(sys.modules)
    with patch("importlib.util.find_spec", side_effect=_fake_find_spec(set())):
        assert has_ml_extra()
        assert has_presidio_ml()
        assert has_ai_extra()
        require_ml_extra("Forecasting")
        require_presidio_extra("PII Scrubbing")
        require_ai_extra("AI Agent")
    newly_imported = set(sys.modules) - before
    assert not (newly_imported & {"prophet", "statsmodels", "sklearn", "presidio_analyzer", "spacy", "langgraph", "torch"})
