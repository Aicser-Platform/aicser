import pytest

from src.modules.data.utils.masking import (
    MASKED_PLACEHOLDER,
    is_redacted_value,
    merge_incoming_connection_config,
    public_connection_config,
)
from src.modules.nl2sql.error_sanitize import sanitize_client_error


def test_public_connection_config_masks_secrets():
    raw = {
        "host": "db.example.com",
        "username": "app",
        "password": "super-secret",
        "api_key": "sk-test-key-1234567890",
        "__enc_password": True,
    }
    out = public_connection_config(raw)
    assert out["host"] == "db.example.com"
    assert out["username"] == "app"
    assert out["password"] == MASKED_PLACEHOLDER
    assert out["api_key"] == MASKED_PLACEHOLDER
    assert "__enc_password" not in out


def test_is_redacted_value():
    assert is_redacted_value(None)
    assert is_redacted_value("")
    assert is_redacted_value(MASKED_PLACEHOLDER)
    assert is_redacted_value("••••1234")
    assert is_redacted_value("abc...xyz")
    assert not is_redacted_value("real-password")


def test_merge_keeps_existing_on_masked_incoming():
    existing = {"host": "h", "password": "stored"}
    incoming = {"host": "h2", "password": MASKED_PLACEHOLDER}
    merged = merge_incoming_connection_config(existing, incoming)
    assert merged["host"] == "h2"
    assert merged["password"] == "stored"


def test_sanitize_client_error_redacts_keys():
    msg = "Auth failed for sk-abcdefghijklmnopqrstuvwxyz1234567890"
    out = sanitize_client_error(msg)
    assert "sk-***" in out
    assert "abcdefghijklmnopqrstuvwxyz" not in out
