"""Embed links open sessions: a signed per-visitor link opens once, a link limited to certain
sites opens only inside one of them, the session (never in a URL) is what data requests carry,
and anonymous viewers get at most EMBED_MAX_ROWS rows per chart."""

from types import SimpleNamespace

import pytest
from jose import JWTError

from src.modules.embed import service as embed_service
from src.modules.embed.limits import cap_rows


class _FakeSettingRepo:
    def __init__(self):
        self._store = {}

    async def get_setting(self, user_id, key):
        value = self._store.get((user_id, key))
        return SimpleNamespace(value=value) if value is not None else None

    async def set_setting(self, user_id, key, value):
        self._store[(user_id, key)] = value
        return SimpleNamespace(value=value)


@pytest.fixture(autouse=True)
def isolated(monkeypatch):
    monkeypatch.setattr(embed_service, "_user_settings_repo", _FakeSettingRepo())
    embed_service._used_links.clear()
    # Single-use bookkeeping falls back to process memory when Redis isn't reachable.
    from src.core import cache as cache_module

    monkeypatch.setattr(cache_module, "cache", None, raising=False)


async def _signed(**kw):
    return await embed_service.create_embed_token(
        user_id="u1", org_id="org1", name="[signed] d", scopes=["dashboard"], resource_id="d1",
        expires_in_minutes=30, kind="signed", **kw,
    )


@pytest.mark.asyncio
async def test_signed_link_opens_once_and_only_its_session_reads_data():
    created = await _signed(locked_filters=[{"field": "tenant_id", "value": "acme"}])
    link = created["token"]

    with pytest.raises(JWTError):  # the link itself can't read data
        await embed_service.verify_embed_token(link, required_scope="dashboard")

    opened = await embed_service.open_embed_session(link, required_scope="dashboard")
    assert opened["single_use"] is True
    session = opened["token"]
    verified = await embed_service.verify_embed_token(session, required_scope="dashboard")
    assert verified["session"] is True and verified["resource_id"] == "d1"
    # The session keeps the link's locked filters.
    assert embed_service.decode_embed_token(session)["locked_filters"] == [{"field": "tenant_id", "value": ["acme"]}]

    with pytest.raises(JWTError, match="already opened"):
        await embed_service.open_embed_session(link, required_scope="dashboard")
    with pytest.raises(JWTError):  # a session can't be exchanged again either
        await embed_service.open_embed_session(session)


@pytest.mark.asyncio
async def test_revoking_the_link_ends_its_sessions():
    created = await _signed()
    session = (await embed_service.open_embed_session(created["token"]))["token"]
    await embed_service.revoke_embed_token("u1", created["id"])
    with pytest.raises(JWTError):
        await embed_service.verify_embed_token(session, required_scope="dashboard")


@pytest.mark.asyncio
async def test_site_limited_link_opens_only_inside_an_allowed_site():
    created = await embed_service.create_embed_token(
        user_id="u1", org_id="org1", name="site", scopes=["dashboard"], resource_id="d1",
        allowed_domains=["example.com"],
    )
    link = created["token"]
    with pytest.raises(embed_service.EmbedOriginError):
        await embed_service.open_embed_session(link, parent_origin="https://evil.test")
    with pytest.raises(embed_service.EmbedOriginError):  # opened on its own, outside any site
        await embed_service.open_embed_session(link, parent_origin="")
    opened = await embed_service.open_embed_session(link, parent_origin="https://app.example.com")
    assert opened["single_use"] is False and opened["allowed_domains"] == ["example.com"]
    # Not single-use: a reload of the same public page opens again.
    await embed_service.open_embed_session(link, parent_origin="https://example.com")
    with pytest.raises(JWTError):  # the raw link can't skip the site check
        await embed_service.verify_embed_token(link, required_scope="dashboard")


@pytest.mark.asyncio
async def test_unrestricted_public_link_still_reads_directly():
    created = await embed_service.create_embed_token(
        user_id="u1", org_id="org1", name="public", scopes=["dashboard"], resource_id="d1",
    )
    verified = await embed_service.verify_embed_token(created["token"], required_scope="dashboard")
    assert verified["session"] is False and verified["download"] == "none"


@pytest.mark.asyncio
async def test_download_setting_travels_with_the_link_and_session():
    created = await _signed(download="data")
    assert created["download"] == "data"
    opened = await embed_service.open_embed_session(created["token"])
    assert opened["download"] == "data"
    with pytest.raises(Exception):
        await _signed(download="everything")


@pytest.mark.asyncio
async def test_render_tokens_are_not_metered():
    created = await embed_service.create_embed_token(
        user_id="u1", org_id="org1", name="[export] d", scopes=["dashboard"], resource_id="d1",
        expires_in_hours=1, kind="export",
    )
    assert (await embed_service.open_embed_session(created["token"]))["metered"] is False
    public = await embed_service.create_embed_token(
        user_id="u1", org_id="org1", name="p", scopes=["dashboard"], resource_id="d1",
    )
    assert (await embed_service.open_embed_session(public["token"]))["metered"] is True


def test_origin_allowed_matches_site_and_subdomains_only():
    assert embed_service.origin_allowed("https://app.example.com", ["example.com"])
    assert embed_service.origin_allowed("https://example.com:8443", ["https://example.com"])
    assert not embed_service.origin_allowed("https://example.com.evil.test", ["example.com"])
    assert not embed_service.origin_allowed("https://notexample.com", ["example.com"])
    assert not embed_service.origin_allowed("", ["example.com"])


def test_cap_rows_trims_rows_and_series_and_says_so():
    data = {"x": list(range(5)), "y": list(range(5)), "series": [{"name": "a", "data": list(range(5))}], "columns": ["a"] * 9}
    capped = cap_rows(data, 3)
    assert capped["x"] == [0, 1, 2] and capped["series"][0]["data"] == [0, 1, 2]
    assert capped["columns"] == ["a"] * 9  # not rows
    assert capped["truncated"] is True and capped["row_cap"] == 3
    assert cap_rows(data, 10) == data
    assert cap_rows(data, None) is data
