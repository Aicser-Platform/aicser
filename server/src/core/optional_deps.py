"""Guarded lazy import helpers for optional `[ml]` and `[ai]` extras."""

from __future__ import annotations

from fastapi import HTTPException


def require_ml_extra(feature_name: str = "Machine Learning") -> None:
    """Ensure `[ml]` extras (prophet, scikit-learn) are installed; raise HTTP 400 if missing."""
    try:
        import prophet  # noqa: F401
        import sklearn  # noqa: F401
    except ImportError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "message": (
                    f"{feature_name} requires the [ml] extras package, "
                    "which is not installed on this instance."
                ),
                "missing_extra": "ml",
                "install_command": "pip install aicser[ml]",
            },
        ) from exc


def require_ai_extra(feature_name: str = "Local AI Embeddings") -> None:
    """Ensure `[ai]` extras (torch, sentence-transformers) are installed; raise HTTP 400 if missing."""
    try:
        import sentence_transformers  # noqa: F401
        import torch  # noqa: F401
    except ImportError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "message": (
                    f"{feature_name} requires the [ai] extras package, "
                    "which is not installed on this instance."
                ),
                "missing_extra": "ai",
                "install_command": "pip install aicser[ai]",
            },
        ) from exc

