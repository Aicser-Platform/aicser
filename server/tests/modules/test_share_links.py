"""What a short link gives away, and what it refuses."""

from datetime import timedelta
from types import SimpleNamespace

import pytest
from fastapi import HTTPException

from src.modules.share_links import service as S


def test_a_slug_is_short_and_random():
    slugs = {S.new_slug() for _ in range(200)}
    assert len(slugs) == 200 and all(len(s) == 10 and s.isalnum() for s in slugs)


def test_a_public_snapshot_keeps_the_numbers_and_drops_how_they_were_fetched():
    out = S.public_snapshot({
        "provenance": {"dashboardId": "d"},
        "visuals": {"widgets": [{"id": "w", "chartData": {"x": [1]}, "chartQuery": {"sql": "SELECT secret"}, "dataSourceId": "ds"}]},
    })
    assert out["provenance"] == {}
    assert out["visuals"]["widgets"] == [{"id": "w", "chartData": {"x": [1]}}]


def test_a_widget_with_no_data_stays_out_and_empty_rows_close():
    out = S.public_snapshot({"visuals": {
        "widgets": [{"id": "a", "chartData": {"x": [1]}, "layout": {"y": 20, "h": 4}},
                    {"id": "gone", "chartType": "stat"},
                    {"id": "b", "chartData": {"x": [2]}, "layout": {"y": 30, "h": 4}},
                    {"id": "note", "chartType": "text"}],
        "layout": [{"i": "a", "y": 20, "h": 4}, {"i": "gone", "y": 24, "h": 6}, {"i": "b", "y": 30, "h": 4},
                   {"i": "note", "y": 22, "h": 2}],
    }})
    assert [w["id"] for w in out["visuals"]["widgets"]] == ["a", "b", "note"]
    assert {i["i"]: i["y"] for i in out["visuals"]["layout"]} == {"a": 0, "b": 4, "note": 2}
    assert out["visuals"]["widgets"][1]["layout"]["y"] == 4


def test_a_live_link_has_no_host_to_get_wrong():
    assert S.same_site_path("http://localhost:3000/embed/chart/1?token=t") == "/embed/chart/1?token=t"
    assert S.same_site_path(None) is None


class Db:
    def __init__(self, link):
        self.link = link

    async def execute(self, *_a, **_k):
        link = self.link

        class R:
            def scalars(self):
                return self

            def first(self):
                return link

        return R()

    async def commit(self):
        return None

    async def refresh(self, _):
        return None


def link(**extra):
    base = dict(id="l", status="active", access="public", organization_id=None, expires_at=None, allowed_domains=[],
                password_hash=None, live_data=False, kind="chart", title="T", snapshot={"visuals": {"widgets": []}},
                snapshot_at=S._now(), view_count=0)
    return SimpleNamespace(**{**base, **extra})


async def open_(row, **kwargs):
    return await S.open_link(Db(row), "abc", password=kwargs.get("password"), parent_origin=kwargs.get("origin", ""),
                             viewer=kwargs.get("viewer"))


@pytest.mark.asyncio
@pytest.mark.parametrize("row,code", [
    (None, 404),
    (link(status="off"), 404),
    (link(status="pending"), 403),
    (link(expires_at=S._now() - timedelta(days=1)), 410),
    (link(access="organization"), 401),
])
async def test_refused_links(row, code):
    with pytest.raises(HTTPException) as err:
        await open_(row)
    assert err.value.status_code == code


@pytest.mark.asyncio
async def test_public_links_stop_when_outside_sharing_is_off(monkeypatch):
    async def off(db, org):
        raise HTTPException(status_code=403, detail="off")

    monkeypatch.setattr(S.policy, "require_outside_sharing", off)
    with pytest.raises(HTTPException):
        await open_(link())


@pytest.mark.asyncio
async def test_a_password_is_needed_and_checked():
    row = link(password_hash=S._passwords.hash("open sesame"))
    with pytest.raises(HTTPException) as err:
        await open_(row)
    assert err.value.detail == "password_required"
    with pytest.raises(HTTPException) as err:
        await open_(row, password="nope")
    assert err.value.detail == "wrong_password"
    assert "snapshot" in await open_(row, password="open sesame")


@pytest.mark.asyncio
async def test_saved_data_opens_without_running_a_query(monkeypatch):
    async def must_not_run(*_a, **_k):
        raise AssertionError("queried")

    monkeypatch.setattr(S, "_build_snapshot", must_not_run)
    out = await open_(link())
    assert out["snapshot"] == {"visuals": {"widgets": [], "layout": []}, "provenance": {}}
