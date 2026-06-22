import pytest
from unittest.mock import AsyncMock, patch

from src.modules.user.router import _is_secret_setting_key


def test_secret_setting_key_detection():
    assert _is_secret_setting_key("provider_key.openai")
    assert _is_secret_setting_key("platform_api_keys")
    assert not _is_secret_setting_key("language")
    assert not _is_secret_setting_key("theme")


@pytest.mark.asyncio
async def test_get_user_settings_excludes_provider_keys():
    from src.modules.user import router as user_router

    async def fake_get_all(_uid):
        return {
            "language": "en",
            "theme": "dark",
            "provider_key.openai": '{"api_key": "sk-secret"}',
            "platform_api_keys": "[]",
        }

    with patch.object(user_router._user_settings_repo, "get_all_settings", new=AsyncMock(side_effect=fake_get_all)):
        result = await user_router.get_user_settings({"id": "00000000-0000-0000-0000-000000000001"})

    assert result["settings"]["language"] == "en"
    assert result["settings"]["theme"] == "dark"
    assert "provider_key.openai" not in result["settings"]
    assert "platform_api_keys" not in result["settings"]
