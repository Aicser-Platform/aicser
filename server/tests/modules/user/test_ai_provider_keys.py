import json
import os
from dataclasses import dataclass

import pytest
from cryptography.fernet import Fernet

os.environ["DEBUG"] = "false"

from src.modules.data.utils.credentials import decrypt_credentials
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


@pytest.mark.asyncio
async def test_ai_provider_keys_mask_decrypted_value_and_preserve_existing_key(monkeypatch):
    user_id = "user-1"
    repo = _FakeSettingsRepo()
    monkeypatch.setattr(user_router, "_user_settings_repo", repo)
    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())

    await user_router.save_ai_provider_key(
        "openai",
        ProviderKeyPayload(api_key="sk-test-1234", model="gpt-4.1-mini"),
        current_token={"sub": user_id},
    )

    raw_saved = json.loads(repo.values[(user_id, "provider_key.openai")])
    assert raw_saved["api_key"] != "sk-test-1234"
    assert raw_saved["__enc_api_key"] is True

    listed = await user_router.get_ai_provider_keys(current_token={"sub": user_id})
    assert listed["openai"]["api_key"] == "••••••••••••1234"
    assert "__enc_api_key" not in listed["openai"]

    await user_router.save_ai_provider_key(
        "openai",
        ProviderKeyPayload(api_key=listed["openai"]["api_key"], model="gpt-4o"),
        current_token={"sub": user_id},
    )

    updated = decrypt_credentials(json.loads(repo.values[(user_id, "provider_key.openai")]))
    assert updated["api_key"] == "sk-test-1234"
    assert updated["model"] == "gpt-4o"
