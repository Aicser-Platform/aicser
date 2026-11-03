"""Unit tests for optional `[ml]` and `[ai]` extras guards (Issue 15)."""

from __future__ import annotations

import sys
from unittest.mock import patch

import pytest
from fastapi import HTTPException

from src.core.optional_deps import require_ai_extra, require_ml_extra


def test_require_ml_extra_raises_400_when_prophet_missing():
    with patch.dict(sys.modules, {"prophet": None}):
        with pytest.raises(HTTPException) as exc_info:
            require_ml_extra("Forecasting")
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["missing_extra"] == "ml"
        assert exc_info.value.detail["install_command"] == "pip install aicser[ml]"


def test_require_ai_extra_raises_400_when_torch_missing():
    with patch.dict(sys.modules, {"torch": None}):
        with pytest.raises(HTTPException) as exc_info:
            require_ai_extra("Local Embeddings")
        assert exc_info.value.status_code == 400
        assert exc_info.value.detail["missing_extra"] == "ai"
        assert exc_info.value.detail["install_command"] == "pip install aicser[ai]"

