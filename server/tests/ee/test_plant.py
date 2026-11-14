"""Plant: Sparkplug decoding, payload parsing, minute rollups, machine health, work-order bodies."""

import struct
from datetime import datetime, timedelta, timezone

import numpy as np
import pandas as pd
import pytest

from src.modules.plant import machine_health, rollup, sparkplug, work_orders


def _vi(n):
    out = bytearray()
    while True:
        b = n & 0x7F
        n >>= 7
        out.append(b | (0x80 if n else 0))
        if not n:
            return bytes(out)


def _f(num, wire, raw):
    return _vi(num << 3 | wire) + raw


def _ld(num, data):
    return _f(num, 2, _vi(len(data)) + data)


def _payload(*metrics, stamp=1_700_000_000_000):
    return _f(1, 0, _vi(stamp)) + b"".join(_ld(2, m) for m in metrics)


def test_sparkplug_birth_names_then_alias_only_data():
    book = sparkplug.AliasBook()
    birth = _payload(_ld(1, b"Motor/Temp") + _f(2, 0, _vi(7)) + _f(4, 0, _vi(10)) + _f(13, 1, struct.pack("<d", 61.5)))
    assert book.readings("spBv1.0/Plant1/NBIRTH/edge1", birth) == [("Plant1/edge1/Motor/Temp", 1_700_000_000_000, 61.5)]
    data = _payload(_f(2, 0, _vi(7)) + _f(4, 0, _vi(9)) + _f(12, 5, struct.pack("<f", 62.5)))
    assert book.readings("spBv1.0/Plant1/NDATA/edge1", data) == [("Plant1/edge1/Motor/Temp", 1_700_000_000_000, 62.5)]


def test_sparkplug_signed_ints_and_ignored_topics():
    book = sparkplug.AliasBook()
    negative = _payload(_ld(1, b"Delta") + _f(4, 0, _vi(3)) + _f(10, 0, _vi(0xFFFFFFFF)))
    assert book.readings("spBv1.0/G/DDATA/e/dev", negative)[0][2] == -1.0
    assert book.readings("spBv1.0/STATE/host", b"") == []


def test_json_readings():
    assert rollup.json_readings("line/temp", b"21.5") == [("line/temp", None, 21.5)]
    assert rollup.json_readings("m", b'{"d":{"t":4},"ts":"2026-01-01T00:00:00Z"}', "d.t", "ts") == [("m", 1767225600000, 4.0)]
    found = rollup.json_readings("m", b'{"ts":1767225600,"temp":4,"rpm":{"a":9},"ok":true,"label":"x"}')
    assert sorted(k for k, _, _ in found) == ["m/rpm/a", "m/temp"] and found[0][1] == 1767225600000
    assert rollup.json_readings("m", b"not json") == []


def test_rollup_aggregates_and_waits_for_late_readings():
    buf = rollup.RollupBuffer()
    start = 1_767_225_600_000
    for i, v in enumerate((1.0, 2.0, 3.0)):
        assert buf.add("k", v, start + i * 1000, start + i * 1000)
    assert buf.drain(start + 60_000) == []  # could still receive late readings
    row = buf.drain(start + 180_000)[0]
    assert (row["avg"], row["min"], row["max"], row["samples"], row["last"]) == (2.0, 1.0, 3.0, 3, 3.0)
    assert round(row["stddev"], 4) == 0.8165
    assert not buf.add("k", 9.0, start, start + 600_000) and buf.dropped_late == 1
    assert not buf.add("k", float("nan"), start, start)


def _history(minutes=1440, end_shift=0.0):
    now = datetime(2026, 10, 30, tzinfo=timezone.utc)
    rng = np.random.default_rng(3)
    rows = []
    for i in range(minutes):
        at = now - timedelta(minutes=minutes - i)
        shift = end_shift if i >= minutes - 30 else 0.0
        rows.append({"minute": at, "tag": "temp", "avg": 60 + np.sin(i / 60) + rng.normal(0, 0.2) + shift})
        rows.append({"minute": at, "tag": "vibration", "avg": 2 + rng.normal(0, 0.05) + shift / 10})
    return pd.DataFrame(rows)


def test_machine_needs_history_first():
    out = machine_health.score_machine(_history(60))
    assert out["status"] == "learning" and out["needed"] == machine_health.MIN_HISTORY_MINUTES


def test_machine_drift_scores_worse_and_names_the_signal():
    normal = machine_health.score_machine(_history())
    drifted = machine_health.score_machine(_history(end_shift=12.0))
    assert normal["status"] == drifted["status"] == "scored"
    assert drifted["health"] < 10 and normal["health"] > 50
    assert drifted["drivers"][0]["tag"] in ("temp", "vibration") and abs(drifted["drivers"][0]["deviation"]) > 3


def test_work_order_field_map():
    fields = {"title": "Bearing", "priority": "high"}
    assert work_orders.build_body(fields, {}) == fields
    assert work_orders.build_body(fields, {"DESCRIPTION": "title", "WOPRIORITY": "priority", "SITEID": "BEDFORD"}) == {
        "DESCRIPTION": "Bearing", "WOPRIORITY": "high", "SITEID": "BEDFORD"}


@pytest.mark.parametrize("protocol,config,host", [("mqtt", {"host": "b1"}, "b1"), ("opcua", {"endpoint": "opc.tcp://p:4840"}, "p")])
def test_host_extraction(protocol, config, host):
    from src.modules.plant.readers import host_of

    assert host_of(protocol, config) == host


@pytest.mark.asyncio
async def test_work_order_reaches_a_private_address_only_when_self_hosted(monkeypatch):
    from types import SimpleNamespace

    from aiohttp import web
    from aiohttp.test_utils import TestServer

    received = []

    async def handle(request):
        received.append(await request.json())
        return web.json_response({"wonum": "WO-7"}, status=201)

    app = web.Application()
    app.router.add_post("/wo", handle)
    server = TestServer(app)
    await server.start_server()
    target = SimpleNamespace(url=str(server.make_url("/wo")), auth_header=None)
    try:
        monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "self_host")
        sent = await work_orders._post(target, {"title": "Inspect"})
        monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "saas")
        refused = await work_orders._post(target, {"title": "Inspect"})
    finally:
        await server.close()
    assert sent == {"status": "sent", "external_id": "WO-7"} and received == [{"title": "Inspect"}]
    assert refused["status"] == "failed"


@pytest.mark.asyncio
async def test_connection_rules(monkeypatch):
    from src.modules.plant import readers

    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "self_host")
    assert await readers.connection_problem("mqtt", {"host": "broker.plant"}) is None
    assert await readers.connection_problem("mqtt", {"host": "bad host;"})
    assert await readers.connection_problem("opcua", {"endpoint": "http://plc:80"})
    monkeypatch.setenv("AISER_DEPLOYMENT_MODE", "saas")
    assert "reachable" in await readers.connection_problem("mqtt", {"host": "127.0.0.1"})


def test_endless_topic_names_cannot_grow_memory(monkeypatch):
    from src.modules import plant  # noqa: F401
    from src.modules.plant import runtime

    monkeypatch.setattr(runtime, "MAX_TAGS_PER_SOURCE", 3)
    rt = runtime.PlantRuntime()
    for i in range(10):
        rt.on_reading("s", f"topic/{i}", None, 1.0)
    assert len(rt.keys["s"]) == 3 and len(rt.latest) == 3
