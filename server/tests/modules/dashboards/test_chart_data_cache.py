from datetime import datetime, timezone
from types import SimpleNamespace

from src.modules.dashboards.chart_data_cache import build_chart_data_cache_key
from src.modules.data.services.query_identity import QueryIdentity


def _chart(updated_at=datetime(2026, 1, 1, tzinfo=timezone.utc)):
    return SimpleNamespace(
        id="c1", updated_at=updated_at, chart_type="bar", data_source_id="ds1"
    )


def _key(chart=None, identity=None, chart_query=None, row_cap=None, narrow_only=False):
    return build_chart_data_cache_key(
        dashboard_id="d1",
        chart=chart or _chart(),
        chart_query=chart_query if chart_query is not None else {"x": "region"},
        identity=identity,
        row_cap=row_cap,
        narrow_only=narrow_only,
    )


def _identity(user_id="u1", **claims):
    return QueryIdentity(user_id=user_id, organization_id="o1", project_id="p1", token_payload=claims)


def test_viewers_never_share_an_entry():
    # Row-level security is applied per identity, so the rows differ per viewer.
    assert _key(identity=_identity("u1")) != _key(identity=_identity("u2"))
    assert _key(identity=_identity("u1", role="analyst")) != _key(identity=_identity("u1", role="admin"))
    assert _key(identity=None) != _key(identity=_identity("u1"))


def test_embed_locked_filters_are_part_of_the_key():
    a = _identity("u1", embed_locked_filters=[{"field": "tenant", "value": "a"}])
    b = _identity("u1", embed_locked_filters=[{"field": "tenant", "value": "b"}])
    assert _key(identity=a, narrow_only=True) != _key(identity=b, narrow_only=True)


def test_token_refresh_claims_do_not_bust_the_cache():
    assert _key(identity=_identity("u1", exp=1, iat=1, jti="a")) == _key(
        identity=_identity("u1", exp=2, iat=2, jti="b")
    )


def test_chart_edit_filters_and_row_cap_change_the_key():
    base = _key(identity=_identity())
    assert base != _key(chart=_chart(datetime(2026, 1, 2, tzinfo=timezone.utc)), identity=_identity())
    assert base != _key(identity=_identity(), chart_query={"x": "region", "filters": [{"f": 1}]})
    assert base != _key(identity=_identity(), row_cap=100)
