"""Production environment helpers for security gating."""
import os

from src.core.config import settings

_PRODUCTION_ENVS = frozenset({"production", "prod", "staging"})


def get_environment() -> str:
    """Current deployment environment (reads live env var for testability)."""
    return str(os.getenv("ENVIRONMENT", getattr(settings, "ENVIRONMENT", "development"))).strip().lower()


def is_production() -> bool:
    return get_environment() in _PRODUCTION_ENVS


def require_encryption_key_in_production() -> None:
    """Fail fast when storing credentials without encryption in production."""
    if not is_production():
        return
    key = (os.getenv("ENCRYPTION_KEY") or "").strip()
    if not key:
        raise RuntimeError(
            "ENCRYPTION_KEY is required in production. "
            'Generate: python -c "from cryptography.fernet import Fernet; print(Fernet.generate_key().decode())"'
        )
