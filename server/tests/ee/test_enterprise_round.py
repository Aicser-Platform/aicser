"""Channel verification, releases, Git files, batch inventory, legal hold, scalar answers, handover."""

import hashlib
import hmac
import json
import time

import pytest


# ── Slack and Teams only take requests their platforms signed ──────────────

def _slack_sig(secret: str, ts: str, body: bytes) -> str:
    return "v0=" + hmac.new(secret.encode(), b"v0:" + ts.encode() + b":" + body, hashlib.sha256).hexdigest()


def test_slack_signature_checked_and_replays_refused():
    from ee.modules.slack.verify import slack_request_valid

    body, ts = b'{"type":"event_callback"}', str(int(time.time()))
    assert slack_request_valid(body, ts, _slack_sig("s3cret", ts, body), secret="s3cret")
    assert not slack_request_valid(body, ts, _slack_sig("other", ts, body), secret="s3cret")
    old = str(int(time.time()) - 3600)
    assert not slack_request_valid(body, old, _slack_sig("s3cret", old, body), secret="s3cret")
    assert not slack_request_valid(body, ts, _slack_sig("s3cret", ts, body), secret="")  # not set up: refuse


def test_teams_replies_only_go_to_microsoft():
    from ee.modules.teams.verify import service_url_allowed

    assert service_url_allowed("https://smba.trafficmanager.net/amer/")
    assert service_url_allowed("https://europe.botframework.com/")
    assert not service_url_allowed("https://attacker.example/v3")
    assert not service_url_allowed("http://smba.trafficmanager.net/")
    assert not service_url_allowed("https://botframework.com.attacker.example/")


@pytest.mark.asyncio
async def test_teams_token_must_be_signed_for_this_bot_and_match_the_service_url():
    from cryptography.hazmat.primitives import serialization
    from cryptography.hazmat.primitives.asymmetric import rsa
    from jose import jwk, jwt

    from ee.modules.teams.verify import ISSUER, verify_teams_request

    key = rsa.generate_private_key(public_exponent=65537, key_size=2048)
    pem = key.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8, serialization.NoEncryption())
    public = jwk.construct(key.public_key().public_bytes(serialization.Encoding.PEM, serialization.PublicFormat.SubjectPublicKeyInfo).decode(), "RS256").to_dict()
    jwks = {"keys": [{**public, "kid": "k1"}]}
    url = "https://smba.trafficmanager.net/amer/"
    now = int(time.time())

    def token(aud="bot-app", serviceurl=url, iss=ISSUER):
        return jwt.encode({"aud": aud, "iss": iss, "exp": now + 300, "nbf": now - 10, "serviceurl": serviceurl},
                          pem.decode(), algorithm="RS256", headers={"kid": "k1"})

    activity = {"serviceUrl": url}
    assert await verify_teams_request(f"Bearer {token()}", activity, "bot-app", jwks=jwks)
    assert not await verify_teams_request(f"Bearer {token(aud='other')}", activity, "bot-app", jwks=jwks)
    assert not await verify_teams_request(f"Bearer {token(iss='https://evil')}", activity, "bot-app", jwks=jwks)
    assert not await verify_teams_request(f"Bearer {token(serviceurl='https://x.botframework.com/')}", activity, "bot-app", jwks=jwks)
    assert not await verify_teams_request("", activity, "bot-app", jwks=jwks)


# ── Releases ────────────────────────────────────────────────────────────────

def _bundle():
    return {"format": "aicser-bundle/1", "connections": ["Sales DB", "Ops"], "connection_ids": {"Sales DB": "src-1", "Ops": "src-2"},
            "items": [
                {"kind": "metric", "key": "metric:Sales DB:Revenue", "name": "Revenue", "connection": "Sales DB",
                 "fields": {"expression": "SUM(amount)"}},
                {"kind": "chart", "key": "chart:Revenue", "name": "Revenue", "connection": "Sales DB",
                 "fields": {"chart_query": {"dataSourceId": "src-1", "sql": "select 1"}}},
                {"kind": "alert", "key": "alert:Low stock", "name": "Low stock", "connection": "Ops", "fields": {}},
            ]}


def test_connections_match_by_name_unless_chosen():
    from ee.modules.promotion.bundle import resolve_connections

    conn_map, missing = resolve_connections(_bundle(), {"tgt-1": "Sales DB", "tgt-9": "Warehouse"})
    assert conn_map == {"Sales DB": "tgt-1"} and missing == ["Ops"]
    conn_map, missing = resolve_connections(_bundle(), {"tgt-1": "Sales DB", "tgt-9": "Warehouse"}, {"Ops": "tgt-9"})
    assert conn_map == {"Sales DB": "tgt-1", "Ops": "tgt-9"} and missing == []
    # A choice outside the target project is ignored.
    assert resolve_connections(_bundle(), {"tgt-1": "Sales DB"}, {"Ops": "elsewhere"})[1] == ["Ops"]


def test_saved_queries_point_at_the_target_connection():
    from ee.modules.promotion.bundle import _differs, _rewrite

    fields = _bundle()["items"][1]["fields"]
    assert _rewrite(fields, {"src-1": "tgt-1"})["chart_query"]["dataSourceId"] == "tgt-1"
    assert _differs(fields, {"chart_query": {"dataSourceId": "tgt-1", "sql": "select 1"}}, {"src-1": "tgt-1"}) == []
    assert _differs(fields, {"chart_query": {"dataSourceId": "tgt-1", "sql": "select 2"}}, {"src-1": "tgt-1"}) == ["chart_query"]


def test_repeated_chart_titles_get_the_same_keys_everywhere():
    from ee.modules.promotion.bundle import _number_charts

    keys = _number_charts([{"id": "a", "title": "Revenue"}, {"id": "b", "title": "Revenue"}, {"id": "c", "title": None}])
    assert keys == {"chart:Revenue": "a", "chart:Revenue #2": "b", "chart:Untitled chart": "c"}


def test_git_files_round_trip_to_the_same_bundle():
    from ee.modules.promotion.git_sync import GitError, GitHub, bundle_from, files_for

    files = files_for(_bundle(), "aicser/prod")
    assert "aicser/prod/bundle.json" in files and "aicser/prod/metrics/sales-db-revenue.json" in files
    back = bundle_from(files, "aicser/prod")
    assert back["connections"] == _bundle()["connections"]
    assert sorted(i["key"] for i in back["items"]) == sorted(i["key"] for i in _bundle()["items"])
    with pytest.raises(GitError):
        bundle_from({}, "aicser/prod")
    with pytest.raises(GitError):
        GitHub("not a repo", "t")


# ── Batch migration inventory ──────────────────────────────────────────────

def test_inventory_finds_shared_calculations_and_unreadable_files():
    from ee.modules.bi_sync.migrate import inventory_many

    twb = lambda calc: (f"<workbook><datasources><datasource name='d'><column caption='M' name='[M]'>"  # noqa: E731
                        f"<calculation formula='{calc}'/></column></datasource></datasources>"
                        "<worksheets><worksheet name='S'/></worksheets></workbook>").encode()
    out = inventory_many([("a.twb", twb("SUM([Sales])")), ("b.twb", twb("sum([sales])")), ("c.twb", twb("AVG([x])")),
                          ("bad.pbix", b"nope")])
    by = {r["filename"]: r for r in out["reports"]}
    assert by["a.twb"]["shared_calculations"] == 1 and by["b.twb"]["shared_calculations"] == 1
    assert by["c.twb"]["shared_calculations"] == 0 and "error" in by["bad.pbix"]
    assert out["shared_calculations"] == 1 and out["readable"] == 3


# ── Legal hold, scalar answers, handover ───────────────────────────────────

@pytest.mark.asyncio
async def test_legal_hold_refuses_permanent_deletes(monkeypatch):
    from fastapi import HTTPException

    from src.shared import legal_hold

    async def on(db, pid):
        return True

    monkeypatch.setattr(legal_hold, "held", on)
    with pytest.raises(HTTPException) as exc:
        await legal_hold.refuse_if_held(None, "p")
    assert exc.value.status_code == 423


@pytest.mark.asyncio
async def test_scalar_answer_keeps_the_exact_figure_or_falls_back():
    from ee.modules.ai.nodes.insight_synthesizer_node import _scalar_kpi_sentence

    class LLM:
        def __init__(self, reply):
            self.reply = reply

        async def generate_completion(self, **_):
            return {"content": self.reply}

    row = {"customers": 40}
    assert await _scalar_kpi_sentence(LLM("You have 40 customers."), "How many customers?", row) == "You have 40 customers."
    # A sentence with a different number is not used.
    fallback = await _scalar_kpi_sentence(LLM("You have about 42 customers."), "How many customers?", row)
    assert "42" not in fallback and "40" in fallback
    assert "there count" not in fallback.lower()


def test_handover_only_moves_rows_inside_the_organization():
    from ee.modules.organizations.handover import OWNED, _where

    assert "organization_id = CAST(:o AS uuid)" in _where("project_id", "created_by")
    assert "CAST(t.org_id AS text) = :o" in _where("org_id", "created_by")
    personal = {"conversation", "agent_memories", "platform_api_keys", "query_tabs"}
    assert not personal & {t for t, _, _ in OWNED}


# ── Project AI limits, Git commits, push ───────────────────────────────────

@pytest.mark.asyncio
async def test_project_ai_limit_blocks_only_that_project(monkeypatch):
    from ee.modules.ai.services import org_budget_service as B

    async def prefs(*_):
        return {"project_limits_usd": {"p1": 10.0}}

    async def spent(_):
        return 9.99

    monkeypatch.setattr(B, "_load_prefs", prefs)
    monkeypatch.setattr(B, "get_project_spend_usd", spent)
    monkeypatch.setattr(B, "_current_project", lambda: "p1")
    assert (await B.check_org_budget_allowed("o", "u", 0.0))[0] is True
    allowed, reason = await B.check_org_budget_allowed("o", "u", 0.05)
    assert allowed is False and "project" in reason
    monkeypatch.setattr(B, "_current_project", lambda: "p2")
    assert (await B.check_org_budget_allowed("o", "u", 5.0))[0] is True


@pytest.mark.asyncio
async def test_git_save_is_one_commit_and_removes_stale_files(monkeypatch):
    import httpx

    from ee.modules.promotion import git_sync as G

    calls = []

    def handler(request):
        path = request.url.path.split("/repos/acme/defs")[1]
        calls.append((request.method, path))
        if path == "/git/ref/heads/main":
            return httpx.Response(200, json={"object": {"sha": "c0"}})
        if path == "/git/commits/c0":
            return httpx.Response(200, json={"tree": {"sha": "t0"}})
        if path == "/git/trees/c0":
            return httpx.Response(200, json={"tree": [{"type": "blob", "path": "aicser/p/charts/old.json"}]})
        if path == "/git/trees":
            body = json.loads(request.content)
            assert {"path": "aicser/p/charts/old.json", "mode": "100644", "type": "blob", "sha": None} in body["tree"]
            return httpx.Response(200, json={"sha": "t1"})
        if path == "/git/commits":
            return httpx.Response(200, json={"sha": "c1"})
        return httpx.Response(200, json={})

    real = httpx.AsyncClient
    monkeypatch.setattr(G.httpx, "AsyncClient", lambda **kw: real(transport=httpx.MockTransport(handler), **kw))
    sha = await G.GitHub("acme/defs", "tok").write_folder("main", "aicser/p", {"aicser/p/bundle.json": "{}"}, "msg")
    assert sha == "c1" and ("PATCH", "/git/refs/heads/main") in calls


@pytest.mark.asyncio
async def test_push_does_nothing_until_configured(monkeypatch):
    from src.modules.notifications import push

    for key in ("VAPID_PUBLIC_KEY", "VAPID_PRIVATE_KEY", "VAPID_SUBJECT"):
        monkeypatch.delenv(key, raising=False)
    assert push.public_key() is None
    assert await push.send_to_user("00000000-0000-0000-0000-000000000000", "t", "b", "/") == 0
