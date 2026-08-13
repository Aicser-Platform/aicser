import json
import os
from dataclasses import dataclass

import pytest
from cryptography.fernet import Fernet

os.environ["DEBUG"] = "false"

from src.modules.data.utils.credentials import decrypt_credentials
from src.modules.data.utils.credentials import encrypt_credentials
from src.modules.user import router as user_router
from src.modules.user.router import ProviderKeyPayload


@dataclass
class _SettingEntry:
    key: str
    value: str


class _FakeSettingsRepo:
    def __init__(self):
        self.values: dict[tuple[str, str], str] = {}

    async def get_setting(self, user_id: str, key: str):
        value = self.values.get((user_id, key))
        return _SettingEntry(key=key, value=value) if value is not None else None

    async def set_setting(self, user_id: str, key: str, value: str):
        self.values[(user_id, key)] = value
        return _SettingEntry(key=key, value=value)

    async def get_all_settings(self, user_id: str):
        return {key: value for (uid, key), value in self.values.items() if uid == user_id}


class _FakeRequest:
    headers: dict[str, str] = {}
    query_params: dict[str, str] = {}


class _FakeOrgRequest:
    headers = {"X-Organization-Id": "org-1"}
    query_params: dict[str, str] = {}


@pytest.mark.asyncio
async def test_ai_provider_keys_mask_decrypted_value_and_preserve_existing_key(monkeypatch):
    user_id = "user-1"
    repo = _FakeSettingsRepo()
    monkeypatch.setattr(user_router, "_user_settings_repo", repo)
    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())

    await user_router.save_ai_provider_key(
        "openai",
        ProviderKeyPayload(api_key="sk-test-1234", model="gpt-4.1-mini"),
        request=_FakeRequest(),
        current_token={"sub": user_id},
    )

    raw_saved = json.loads(repo.values[(user_id, "provider_key.openai")])
    assert raw_saved["api_key"] != "sk-test-1234"
    assert raw_saved["__enc_api_key"] is True

    listed = await user_router.get_ai_provider_keys(request=_FakeRequest(), current_token={"sub": user_id})
    assert listed["openai"]["api_key"] == "••••••••••••1234"
    assert "__enc_api_key" not in listed["openai"]

    await user_router.save_ai_provider_key(
        "openai",
        ProviderKeyPayload(api_key=listed["openai"]["api_key"], model="gpt-4o"),
        request=_FakeRequest(),
        current_token={"sub": user_id},
    )

    updated = decrypt_credentials(json.loads(repo.values[(user_id, "provider_key.openai")]))
    assert updated["api_key"] == "sk-test-1234"
    assert updated["model"] == "gpt-4o"


@pytest.mark.asyncio
async def test_ollama_provider_key_allows_endpoint_without_api_key(monkeypatch):
    user_id = "user-1"
    repo = _FakeSettingsRepo()
    monkeypatch.setattr(user_router, "_user_settings_repo", repo)
    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())

    await user_router.save_ai_provider_key(
        "ollama",
        ProviderKeyPayload(endpoint="http://ollama:11434", model="llama3.2:1b"),
        request=_FakeRequest(),
        current_token={"sub": user_id},
    )

    saved = decrypt_credentials(json.loads(repo.values[(user_id, "provider_key.ollama")]))
    assert saved["endpoint"] == "http://ollama:11434"
    assert saved["model"] == "llama3.2:1b"
    assert "api_key" not in saved


@pytest.mark.asyncio
async def test_org_provider_key_save_uses_org_scope(monkeypatch):
    user_id = "user-1"
    repo = _FakeSettingsRepo()
    org_values: dict[str, str] = {}
    monkeypatch.setattr(user_router, "_user_settings_repo", repo)
    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())

    async def is_member(_user_id, _organization_id):
        return True

    async def require_manager(_user_id, _organization_id):
        return None

    async def get_org_settings(_user_id, _organization_id):
        return org_values

    async def save_org_setting(_organization_id, provider, value):
        org_values[provider] = value

    monkeypatch.setattr(user_router, "_user_is_org_member", is_member)
    monkeypatch.setattr(user_router, "_require_org_provider_key_manager", require_manager)
    monkeypatch.setattr(user_router, "_get_org_ai_provider_settings", get_org_settings)
    monkeypatch.setattr(user_router, "_save_org_ai_provider_setting", save_org_setting)

    result = await user_router.save_ai_provider_key(
        "openai",
        ProviderKeyPayload(api_key="sk-org-1234", model="gpt-5.6-luna"),
        request=_FakeOrgRequest(),
        current_token={"sub": user_id},
    )

    assert result["scope"] == "organization"
    assert repo.values == {}
    saved = decrypt_credentials(json.loads(org_values["openai"]))
    assert saved["api_key"] == "sk-org-1234"
    assert saved["model"] == "gpt-5.6-luna"


@pytest.mark.asyncio
async def test_org_provider_key_save_can_publish_existing_personal_masked_key(monkeypatch):
    user_id = "user-1"
    repo = _FakeSettingsRepo()
    org_values: dict[str, str] = {}
    monkeypatch.setattr(user_router, "_user_settings_repo", repo)
    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())

    personal_store = encrypt_credentials({"api_key": "sk-existing-9999", "model": "gpt-4.1-mini"})
    await repo.set_setting(user_id, "provider_key.openai", json.dumps(personal_store))

    async def is_member(_user_id, _organization_id):
        return True

    async def require_manager(_user_id, _organization_id):
        return None

    async def get_org_settings(_user_id, _organization_id):
        return org_values

    async def save_org_setting(_organization_id, provider, value):
        org_values[provider] = value

    monkeypatch.setattr(user_router, "_user_is_org_member", is_member)
    monkeypatch.setattr(user_router, "_require_org_provider_key_manager", require_manager)
    monkeypatch.setattr(user_router, "_get_org_ai_provider_settings", get_org_settings)
    monkeypatch.setattr(user_router, "_save_org_ai_provider_setting", save_org_setting)

    await user_router.save_ai_provider_key(
        "openai",
        ProviderKeyPayload(api_key="••••••••••••9999", model="gpt-5.6-luna"),
        request=_FakeOrgRequest(),
        current_token={"sub": user_id},
    )

    saved = decrypt_credentials(json.loads(org_values["openai"]))
    assert saved["api_key"] == "sk-existing-9999"
    assert saved["model"] == "gpt-5.6-luna"


@pytest.mark.asyncio
async def test_org_provider_keys_are_masked_for_members(monkeypatch):
    user_id = "user-1"
    repo = _FakeSettingsRepo()
    monkeypatch.setattr(user_router, "_user_settings_repo", repo)
    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())
    encrypted = json.dumps(encrypt_credentials({"api_key": "sk-org-5678", "model": "gpt-5.6-luna"}))

    async def get_org_settings(_user_id, _organization_id):
        return {"openai": encrypted}

    monkeypatch.setattr(user_router, "_get_org_ai_provider_settings", get_org_settings)

    listed = await user_router.get_ai_provider_keys(request=_FakeOrgRequest(), current_token={"sub": user_id})

    assert listed["openai"]["api_key"] == "••••••••••••5678"
    assert listed["openai"]["scope"] == "organization"
    assert "__enc_api_key" not in listed["openai"]
