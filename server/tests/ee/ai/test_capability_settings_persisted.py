"""Capability settings live in Postgres; a cache problem never switches capabilities back on."""

import pytest

from ee.modules.ai.services import capability_governance_service as cg
from ee.modules.ai.services import org_ai_settings


@pytest.mark.asyncio
async def test_saved_capabilities_are_read_back(monkeypatch):
    store = {}

    async def write(org, section, value, user_id):
        store[(str(org), section)] = {**value, "updated_by": user_id}
        return store[(str(org), section)]

    async def read(org, section, legacy_cache_key=None):
        return store.get((str(org), section))

    monkeypatch.setattr(org_ai_settings, "write_section", write)
    monkeypatch.setattr(org_ai_settings, "read_section", read)
    out = await cg.set_disabled_capabilities("org-1", ["run_sql", "execute_analysis", "run_sql"], "u1")
    assert out["disabled_capabilities"] == ["execute_analysis", "run_sql"] and out["updated_by"] == "u1"
    assert await cg.get_disabled_capabilities("org-1") == {"run_sql", "execute_analysis"}
    assert await cg.get_disabled_capabilities(None) == set()


@pytest.mark.asyncio
async def test_unreadable_settings_keep_the_last_known_value(monkeypatch):
    cg._LAST_KNOWN["org-2"] = {"generate_docx"}

    async def broken(org, section, legacy_cache_key=None):
        raise RuntimeError("database down")

    monkeypatch.setattr(org_ai_settings, "read_section", broken)
    assert await cg.get_disabled_capabilities("org-2") == {"generate_docx"}
