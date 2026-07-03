import os
import pytest
from unittest.mock import AsyncMock, patch

if os.getenv("AISER_EDITION", "community").lower() in ("enterprise", "ee") or os.getenv("AISER_EDITION_LICENSE_KEY"):
    pytest.skip("CE-only text-to-sql", allow_module_level=True)

from fastapi import HTTPException
from src.modules.ai import router as ai_router
from src.modules.ai.services.text_to_sql_service import NoProviderKeyError


async def test_route_returns_service_result():
    fake = AsyncMock(return_value={"success": True, "sql": "SELECT 1", "model": "gpt-4o",
                                   "provider": "openai", "dialect": "postgres", "warning": None})
    with patch.object(ai_router.TextToSqlService, "generate", fake):
        out = await ai_router.generate_text_to_sql(
            payload={"question": "q", "data_source_id": "d1", "model": "gpt-4o"},
            current_token={"sub": "u1"},
            db=None,
        )
    assert out["sql"] == "SELECT 1"


async def test_route_no_key_maps_to_400():
    async def _raise(*a, **k):
        raise NoProviderKeyError("openai")
    with patch.object(ai_router.TextToSqlService, "generate", _raise):
        with pytest.raises(HTTPException) as exc:
            await ai_router.generate_text_to_sql(
                payload={"question": "q", "data_source_id": "d1"},
                current_token={"sub": "u1"},
                db=None,
            )
    assert exc.value.status_code == 400
    assert exc.value.detail["code"] == "no_provider_key"
