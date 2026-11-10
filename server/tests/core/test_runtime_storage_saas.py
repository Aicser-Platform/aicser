"""On SaaS the lake/object storage is the platform's env; a saved admin override must not apply,
tenants see no bucket details, and they cannot save or test storage settings."""

import os

import pytest
from fastapi import HTTPException

os.environ.setdefault("AISER_EDITION", "enterprise")  # the admin/schedule-email routers are EE

import src.core.edition  # noqa: E402,F401  installs the src.enterprise.* alias
from src.core.system_settings import runtime_config  # noqa: E402

SAVED_OVERRIDE = {"enabled": True, "backend": "s3", "provider": "aws", "endpoint_url": "https://attacker.example",
                  "access_key_id": "AKIAOVERRIDE", "secret_access_key": "override-secret",
                  "bucket_name": "someone-elses-bucket", "region": "us-east-1"}


@pytest.fixture
def env_s3(monkeypatch):
    monkeypatch.setenv("STORAGE_BACKEND", "s3")
    monkeypatch.setenv("S3_ENDPOINT_URL", "https://s3.platform.example")
    monkeypatch.setenv("S3_ACCESS_KEY_ID", "AKIAPLATFORM")
    monkeypatch.setenv("S3_SECRET_ACCESS_KEY", "platform-secret")
    monkeypatch.setenv("S3_BUCKET_NAME", "platform-lake")
    monkeypatch.setenv("S3_REGION", "ap-southeast-1")


@pytest.fixture
def saved_override(monkeypatch):
    async def fake_get(key):
        return dict(SAVED_OVERRIDE) if key == runtime_config.STORAGE_SETTING_KEY else None

    monkeypatch.setattr(runtime_config, "_get_admin_setting", fake_get)


async def test_saas_ignores_saved_storage_override(monkeypatch, env_s3, saved_override):
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "saas")
    config = await runtime_config.get_effective_storage_config()
    assert config["source"] == "env"
    assert config["bucket_name"] == "platform-lake"
    assert config["endpoint_url"] == "https://s3.platform.example"


async def test_saas_status_hides_platform_bucket(monkeypatch, env_s3, saved_override):
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "saas")
    status = (await runtime_config.get_runtime_config_status())["storage"]
    assert status == {"managed": True, "enabled": True, "configured": True}


async def test_self_host_uses_saved_storage_override(monkeypatch, env_s3, saved_override):
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "self_host")
    config = await runtime_config.get_effective_storage_config()
    assert config["source"] == "admin"
    assert config["bucket_name"] == "someone-elses-bucket"
    status = (await runtime_config.get_runtime_config_status())["storage"]
    assert status["managed"] is False and status["bucket_name"] == "someone-elses-bucket"


@pytest.mark.parametrize("handler", ["update_storage_runtime_config", "test_current_storage_runtime_config"])
async def test_saas_refuses_storage_save_and_test_before_auth(monkeypatch, handler):
    """Refused for everyone on SaaS, including an org owner, before any setting is touched."""
    pytest.importorskip("src.enterprise.modules.admin_config.router")
    from src.enterprise.modules.admin_config import router as admin_router

    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "saas")

    async def owner_ok(*_args, **_kwargs):
        return "owner-user-id"

    async def must_not_save(*_args, **_kwargs):
        raise AssertionError("storage must not be saved or tested on SaaS")

    monkeypatch.setattr(admin_router, "_require_admin", owner_ok)
    monkeypatch.setattr(admin_router, "save_storage_config", must_not_save)
    monkeypatch.setattr(admin_router, "test_storage_config", must_not_save)

    fn = getattr(admin_router, handler)
    with pytest.raises(HTTPException) as caught:
        if handler == "update_storage_runtime_config":
            await fn(admin_router.StorageRuntimeConfigPayload(**SAVED_OVERRIDE), None, {})
        else:
            await fn(None, {})
    assert caught.value.status_code == 403


async def test_test_email_endpoint_removed():
    pytest.importorskip("src.modules.schedule_email.router")
    from src.modules.schedule_email.router import router

    assert not any(getattr(r, "path", "").endswith("/send-test-email") for r in router.routes)
