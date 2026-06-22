import pytest
from unittest.mock import AsyncMock, patch

from src.modules.nl2sql.byok import build_byok_model_entry


def test_byok_openai_entry():
    built = build_byok_model_entry("openai", {"api_key": "sk-test", "model": "gpt-4o-mini", "endpoint": ""})
    assert built is not None
    iid, cfg = built
    assert iid == "byok_openai"
    assert cfg["model"] == "gpt-4o-mini"
    assert cfg["api_key"] == "sk-test"


@pytest.mark.asyncio
async def test_generate_requires_schema():
    from src.modules.nl2sql.service import NL2SQLService

    svc = NL2SQLService()
    with patch.object(svc, "_fetch_schema", new=AsyncMock(return_value=(None, None))):
        result = await svc.generate_sql(query="show sales", data_source_id="missing")
    assert result["success"] is False
