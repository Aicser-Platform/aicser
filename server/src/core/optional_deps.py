"""Guarded spec-check helpers for optional `[ml]` and `[ai]` extras."""

from __future__ import annotations

import importlib.util
from typing import Iterable

from fastapi import HTTPException

PACKAGE_NAME = "aiser-world-chat2chart"


def _missing_modules(modules: Iterable[str]) -> list[str]:
    missing: list[str] = []
    for mod in modules:
        try:
            spec = importlib.util.find_spec(mod)
        except (ImportError, ValueError):
            spec = None
        if spec is None:
            missing.append(mod)
    return missing


def has_ml_extra() -> bool:
    """Return True when `[ml]` forecasting libraries (prophet, statsmodels, sklearn) are importable."""
    return not _missing_modules(("prophet", "statsmodels", "sklearn"))


def has_presidio_ml() -> bool:
    """Return True when Presidio + spaCy NER libraries are importable."""
    return not _missing_modules(("presidio_analyzer", "spacy"))


def has_ai_extra() -> bool:
    """Return True when `[ai]` orchestration libraries (langgraph) are importable."""
    return not _missing_modules(("langgraph",))


def require_ml_extra(feature_name: str = "Machine Learning") -> None:
    """Ensure `[ml]` extras (prophet, statsmodels, scikit-learn) are installed; raise HTTP 400 if missing."""
    missing = _missing_modules(("prophet", "statsmodels", "sklearn"))
    if missing:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "requires_full_image",
                "message": (
                    f"{feature_name} requires the full server image ([ml] extras: "
                    f"{', '.join(missing)}), which is not installed on this slim instance."
                ),
                "missing_extra": "ml",
                "missing_modules": missing,
                "install_command": f"pip install {PACKAGE_NAME}[ml]",
            },
        )


def require_presidio_extra(feature_name: str = "PII NER Scrubbing") -> None:
    """Ensure Presidio + spaCy NER extras are installed; raise HTTP 400 with requires_full_image if missing."""
    missing = _missing_modules(("presidio_analyzer", "spacy"))
    if missing:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "requires_full_image",
                "message": (
                    f"{feature_name} requires the full server image (Presidio/spaCy NER: "
                    f"{', '.join(missing)}), which is not installed on this slim instance."
                ),
                "missing_extra": "ml",
                "missing_modules": missing,
                "install_command": f"pip install {PACKAGE_NAME}[ml]",
            },
        )


def require_ai_extra(feature_name: str = "AI Orchestration") -> None:
    """Ensure `[ai]` extras (langgraph) are installed; raise HTTP 400 if missing."""
    missing = _missing_modules(("langgraph",))
    if missing:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "requires_full_image",
                "message": (
                    f"{feature_name} requires the full server image ([ai] extras: "
                    f"{', '.join(missing)}), which is not installed on this slim instance."
                ),
                "missing_extra": "ai",
                "missing_modules": missing,
                "install_command": f"pip install {PACKAGE_NAME}[ai]",
            },
        )
