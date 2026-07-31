"""Tests for licensing-related Settings fields."""
import importlib

from src.core.config import Settings


def test_license_key_defaults_empty(monkeypatch):
    monkeypatch.delenv("AISER_EDITION_LICENSE_KEY", raising=False)
    assert Settings().AISER_EDITION_LICENSE_KEY == ""


def test_license_key_from_env(monkeypatch):
    monkeypatch.setenv("AISER_EDITION_LICENSE_KEY", "AICSER-ENT-AAAA-BBBB-CCCC-DDDD")
    assert Settings().AISER_EDITION_LICENSE_KEY == "AICSER-ENT-AAAA-BBBB-CCCC-DDDD"


def test_license_server_url_default(monkeypatch):
    monkeypatch.delenv("LICENSE_SERVER_URL", raising=False)
    assert Settings().LICENSE_SERVER_URL == "https://license.aicser.com"


def test_license_grace_period_default(monkeypatch):
    monkeypatch.delenv("LICENSE_GRACE_PERIOD_DAYS", raising=False)
    assert Settings().LICENSE_GRACE_PERIOD_DAYS == 3


def test_license_refresh_interval_default(monkeypatch):
    monkeypatch.delenv("LICENSE_REFRESH_INTERVAL_MINUTES", raising=False)
    assert Settings().LICENSE_REFRESH_INTERVAL_MINUTES == 15
