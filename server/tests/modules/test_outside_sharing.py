"""Public sharing Off reaches everything that leaves the organization."""

import pytest
from fastapi import HTTPException

from src.modules.feed import publish_policy as policy


@pytest.mark.parametrize("mode,blocked", [("off", True), ("approval", False), ("members", False)])
@pytest.mark.asyncio
async def test_off_is_the_only_mode_that_stops_outside_sharing(monkeypatch, mode, blocked):
    async def get_policy(_db, _org):
        return {"public": mode}

    monkeypatch.setattr(policy, "get_policy", get_policy)
    assert await policy.outside_sharing_off(None, "org") is blocked
    if blocked:
        with pytest.raises(HTTPException) as refused:
            await policy.require_outside_sharing(None, "org")
        assert refused.value.status_code == 403
    else:
        await policy.require_outside_sharing(None, "org")


@pytest.mark.asyncio
async def test_no_organization_has_no_switch():
    assert await policy.outside_sharing_off(None, None) is False


@pytest.mark.asyncio
async def test_existing_embed_links_stop_opening(monkeypatch):
    from src.modules.embed import router as embed

    async def get_policy(_db, _org):
        return {"public": "off"}

    monkeypatch.setattr(policy, "get_policy", get_policy)
    with pytest.raises(HTTPException) as refused:
        await embed._require_embed_plan("org", None)
    assert refused.value.status_code == 403
