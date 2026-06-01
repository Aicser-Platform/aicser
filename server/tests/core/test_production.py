"""Tests for production environment helpers."""
import os

import pytest

from src.core import production


def test_is_production_false_in_development(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "development")
    assert production.is_production() is False


def test_is_production_true_when_prod(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    assert production.is_production() is True


def test_require_encryption_key_raises_in_production(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.delenv("ENCRYPTION_KEY", raising=False)
    with pytest.raises(RuntimeError, match="ENCRYPTION_KEY"):
        production.require_encryption_key_in_production()


def test_require_encryption_key_ok_when_set(monkeypatch):
    monkeypatch.setenv("ENVIRONMENT", "production")
    monkeypatch.setenv("ENCRYPTION_KEY", os.environ.get("ENCRYPTION_KEY", "dGVzdC1rZXktdGVzdC1rZXktdGVzdC1rZXk="))
    production.require_encryption_key_in_production()
