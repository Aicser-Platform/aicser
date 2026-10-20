"""Semantic routes only touch metrics, dimensions and spines on connections the caller can open."""

import asyncio

import pytest
from fastapi import HTTPException

from ee.modules.ai import semantic_router as r

TOKEN = {"sub": "u1"}
MINE, THEIRS = "ds-mine", "ds-theirs"


@pytest.fixture(autouse=True)
def scope(monkeypatch):
    async def fake_scope(_token):
        return {MINE}

    monkeypatch.setattr(r, "_scope", fake_scope)


class FakeDB:
    metrics = {"m1": {"id": "m1", "data_source_id": MINE}, "m2": {"id": "m2", "data_source_id": THEIRS}}

    async def get_metric(self, mid):
        return self.metrics.get(mid)

    async def list_metrics(self, **_kw):
        return list(self.metrics.values())

    async def delete_metric(self, mid):
        return {"success": True}


@pytest.fixture
def db(monkeypatch):
    import ee.modules.ai.services.semantic_layer_db as mod

    fake = FakeDB()
    monkeypatch.setattr(mod, "semantic_layer_db", fake)
    return fake


def run(coro):
    return asyncio.run(coro)


def test_lists_only_show_the_callers_connections(db):
    out = run(r.list_metrics(current_token=TOKEN))
    assert [m["id"] for m in out["metrics"]] == ["m1"]


def test_another_connections_metric_is_not_found(db):
    assert run(r.get_metric("m1", current_token=TOKEN))["metric"]["id"] == "m1"
    for call in (lambda: r.get_metric("m2", current_token=TOKEN), lambda: r.delete_metric("m2", current_token=TOKEN)):
        with pytest.raises(HTTPException) as exc:
            run(call())
        assert exc.value.status_code == 404


def test_creating_on_another_connection_is_refused(db):
    body = r.MetricCreate(name="x", expression="SUM(a)", data_source_id=THEIRS)
    with pytest.raises(HTTPException) as exc:
        run(r.create_metric(body, current_token=TOKEN))
    assert exc.value.status_code == 404
    with pytest.raises(HTTPException) as exc:
        run(r.create_metric(r.MetricCreate(name="x", expression="SUM(a)"), current_token=TOKEN))
    assert exc.value.status_code == 422


def test_dbt_artifacts_are_read_only_from_the_configured_folder(monkeypatch, tmp_path):
    monkeypatch.setenv("AICSER_DBT_ARTIFACTS_DIR", str(tmp_path))
    good = tmp_path / "target" / "manifest.json"
    assert r._dbt_artifact_path(str(good)) == str(good.resolve())
    for bad in ("/etc/passwd", str(tmp_path / ".." / "secrets.json"), str(tmp_path / "manifest.yml")):
        with pytest.raises(HTTPException):
            r._dbt_artifact_path(bad)
