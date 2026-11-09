"""On SaaS the outbound email setup is the platform's env; a saved admin override must not apply."""

import pytest

from src.core.system_settings import runtime_config

SAVED_OVERRIDE = {"enabled": True, "provider": "smtp", "host": "override.example", "port": 465, "from": "x@override.example",
                  "use_ssl": False}


@pytest.fixture
def env_smtp(monkeypatch):
    monkeypatch.setenv("SMTP_HOST", "smtp.platform.example")
    monkeypatch.setenv("SMTP_FROM", "support@platform.example")
    monkeypatch.setenv("SMTP_PORT", "465")
    monkeypatch.delenv("EMAIL_PROVIDER", raising=False)


@pytest.fixture
def saved_override(monkeypatch):
    async def fake_get(key):
        return dict(SAVED_OVERRIDE) if key == runtime_config.EMAIL_SETTING_KEY else None

    monkeypatch.setattr(runtime_config, "_get_admin_setting", fake_get)


@pytest.mark.asyncio
async def test_saas_ignores_saved_override(monkeypatch, env_smtp, saved_override):
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "saas")
    config = await runtime_config.get_effective_email_config()
    assert config["source"] == "env"
    assert config["host"] == "smtp.platform.example"


@pytest.mark.asyncio
async def test_saas_status_hides_platform_mail_details(monkeypatch, env_smtp, saved_override):
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "saas")
    status = (await runtime_config.get_runtime_config_status())["email"]
    assert status == {"managed": True, "enabled": True, "configured": True}


@pytest.mark.asyncio
async def test_self_host_uses_saved_override(monkeypatch, env_smtp, saved_override):
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "self_host")
    config = await runtime_config.get_effective_email_config()
    assert config["source"] == "admin"
    assert config["host"] == "override.example"
