"""Embed per-call theming: a theme (brand color, logo, font, light/dark mode)
travels with an embed token record and is returned by both list and verify, so
the embed viewer pages can apply it. Theme edits reuse the existing signed
token — no reason to invalidate a distributed embed link just to change a color.
"""

from types import SimpleNamespace

import pytest

from src.modules.embed import service as embed_service


class _FakeSettingRepo:
    """In-memory stand-in for UserSettingRepository — real enough to exercise
    the JSON round-trip _load_records/_save_records do, without a DB."""

    def __init__(self):
        self._store: dict[tuple[str, str], str] = {}

    async def get_setting(self, user_id: str, key: str):
        value = self._store.get((user_id, key))
        return SimpleNamespace(value=value) if value is not None else None

    async def set_setting(self, user_id: str, key: str, value: str):
        self._store[(user_id, key)] = value
        return SimpleNamespace(value=value)


@pytest.fixture(autouse=True)
def fake_repo(monkeypatch):
    repo = _FakeSettingRepo()
    monkeypatch.setattr(embed_service, "_user_settings_repo", repo)
    return repo


@pytest.mark.asyncio
async def test_create_embed_token_persists_and_returns_theme():
    theme = {"primary_color": "#ff6600", "logo_url": "https://example.com/logo.png", "mode": "dark"}
    created = await embed_service.create_embed_token(
        user_id="u1", org_id="org1", name="My Dashboard",
        scopes=["dashboard"], resource_id="dash-1", theme=theme,
    )
    assert created["theme"] == theme

    listed = await embed_service.list_embed_tokens("u1")
    assert listed[0]["theme"] == theme


@pytest.mark.asyncio
async def test_create_embed_token_without_theme_defaults_to_none():
    created = await embed_service.create_embed_token(
        user_id="u1", org_id="org1", name="Untitled", scopes=["chat"],
    )
    assert created["theme"] is None


@pytest.mark.asyncio
async def test_verify_embed_token_returns_the_stored_theme():
    theme = {"primary_color": "#00c2cb", "mode": "auto"}
    created = await embed_service.create_embed_token(
        user_id="u1", org_id="org1", name="Chat widget", scopes=["chat"], theme=theme,
    )
    verified = await embed_service.verify_embed_token(created["token"])
    assert verified["theme"] == theme


@pytest.mark.asyncio
async def test_report_scope_builds_a_singular_embed_report_url():
    """Reports reuse this same JWT embed-token system rather than a
    report-specific auth mechanism - the URL it builds must match the real
    frontend route (client/src/app/embed/report/[id]/page.tsx), not a typo'd
    plural the way the old dashboard export endpoint's hand-built URL did."""
    created = await embed_service.create_embed_token(
        user_id="u1", org_id="org1", name="[export] report", scopes=["report"],
        resource_id="conv-1:msg-1",
    )
    assert created["embed_urls"]["report"].endswith("/embed/report/conv-1:msg-1?token=" + created["token"])


@pytest.mark.asyncio
async def test_verify_embed_token_accepts_report_scope():
    created = await embed_service.create_embed_token(
        user_id="u1", org_id="org1", name="[export] report", scopes=["report"],
        resource_id="conv-1:msg-1",
    )
    verified = await embed_service.verify_embed_token(created["token"], required_scope="report")
    assert verified["resource_id"] == "conv-1:msg-1"


@pytest.mark.asyncio
async def test_update_embed_token_theme_changes_branding_without_new_token():
    created = await embed_service.create_embed_token(
        user_id="u1", org_id="org1", name="Dash", scopes=["dashboard"], resource_id="d1",
    )
    original_token = created["token"]
    new_theme = {"primary_color": "#123456"}

    updated = await embed_service.update_embed_token_theme("u1", created["id"], new_theme)

    assert updated["theme"] == new_theme
    # The original signed token is still valid and now reflects the new theme —
    # no need to redistribute a new embed URL just for a color change.
    verified = await embed_service.verify_embed_token(original_token)
    assert verified["theme"] == new_theme


@pytest.mark.asyncio
async def test_update_embed_token_theme_returns_none_for_unknown_token():
    result = await embed_service.update_embed_token_theme("u1", "does-not-exist", {"primary_color": "#000"})
    assert result is None


@pytest.mark.asyncio
async def test_update_embed_token_theme_can_clear_theme_to_none():
    created = await embed_service.create_embed_token(
        user_id="u1", org_id="org1", name="Dash", scopes=["dashboard"],
        theme={"primary_color": "#ff0000"},
    )
    updated = await embed_service.update_embed_token_theme("u1", created["id"], None)
    assert updated["theme"] is None
