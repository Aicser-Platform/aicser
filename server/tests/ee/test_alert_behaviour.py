"""What people rely on from /alerts: changes save, broken checks show, nothing stays open by accident."""

import pytest

from ee.modules.alerts import alert_evaluator as ev
from ee.modules.alerts.alert_rules_service import AlertRulesService


class Result:
    def __init__(self, rows=()):
        self.rows = list(rows)

    def fetchone(self):
        return self.rows[0] if self.rows else None

    def fetchall(self):
        return self.rows


class Row:
    def __init__(self, **values):
        self._mapping = values


class Nested:
    async def __aenter__(self):
        return self

    async def __aexit__(self, *exc):
        return False


class Db:
    """Records statements; answers a rule for reads."""

    def __init__(self):
        self.sql = []

    def begin_nested(self):
        return Nested()

    def add(self, _):
        pass

    async def execute(self, statement, params=None):
        text = str(statement)
        self.sql.append((text, params))
        if text.startswith("SELECT id, org_id, project_id, name"):
            return Result([Row(id="r1", name="Sales", channels=[], source=None, description=None)])
        return Result()

    async def commit(self):
        pass

    async def rollback(self):
        pass


@pytest.mark.asyncio
async def test_pausing_saves_and_closes_the_open_incident():
    db = Db()
    updated = await AlertRulesService(db).update_rule("r1", {"is_active": False}, "o1")
    assert updated["id"] == "r1"
    assert any("UPDATE alert_rules SET is_active" in s for s, _ in db.sql)
    assert any("UPDATE alert_events SET status = 'resolved'" in s for s, _ in db.sql)


@pytest.mark.asyncio
async def test_a_plain_edit_leaves_incidents_alone():
    db = Db()
    await AlertRulesService(db).update_rule("r1", {"name": "New name"}, "o1")
    assert not any("UPDATE alert_events" in s for s, _ in db.sql)


@pytest.mark.asyncio
async def test_project_scope_reaches_rules_events_and_the_count():
    db = Db()
    svc = AlertRulesService(db)
    await svc.list_rules("o1", "p1")
    await svc.list_events("o1", project_id="p1")
    await svc.count_open_events("o1", "p1")
    assert len(db.sql) == 3
    assert all("project_id IS NULL OR CAST" in s and params["project_id"] == "p1" for s, params in db.sql)


@pytest.mark.asyncio
async def test_without_a_project_everything_in_the_organization_shows():
    db = Db()
    await AlertRulesService(db).list_rules("o1")
    assert "project_id IS NULL OR CAST" not in db.sql[0][0]


@pytest.mark.asyncio
async def test_a_failed_check_reads_as_a_problem_and_attention_comes_first():
    db = Db()
    base = dict(is_active=True, name="x", channels=[], source=None, last_evaluated_at="2026-11-02", threshold_value=1,
                threshold_operator=">", condition_sql="select 1", data_source_id="d", project_id=None)
    rows = [Row(**base, id="ok", created_at="1", open_status=None, last_error=None),
            Row(**base, id="broken", created_at="2", open_status=None, last_error="query_failed"),
            Row(**base, id="firing", created_at="3", open_status="firing", last_error=None)]

    async def execute(statement, params=None):
        return Result(rows)

    db.execute = execute
    rules = await AlertRulesService(db).list_rules("o1")
    assert [(r["id"], r["state"]) for r in rules] == [("firing", "firing"), ("broken", "error"), ("ok", "ok")]


class Svc:
    def __init__(self):
        self.failures = []

    async def record_failure(self, rule_id, code):
        self.failures.append((rule_id, code))

    async def touch_evaluated_at(self, rule_id):
        raise AssertionError("a failure must be recorded, not just timed")


@pytest.mark.asyncio
async def test_missing_connection_is_recorded_on_the_rule():
    svc = Svc()
    await ev.AlertEvaluator()._evaluate_rule({"id": "r1", "condition_sql": "select 1", "data_source_id": ""}, svc, None)
    assert svc.failures == [("r1", "source_missing")]


@pytest.mark.asyncio
async def test_failed_query_is_recorded_on_the_rule(monkeypatch):
    class Query:
        async def execute_query(self, **_):
            return {"success": False, "error": "boom"}

    import src.modules.data.services.multi_engine_query_service as m

    monkeypatch.setattr(m, "get_multi_engine_query_service", lambda: Query())

    async def source(self, _):
        return {"id": "d"}

    monkeypatch.setattr(ev.AlertEvaluator, "_fetch_data_source", source)
    svc = Svc()
    await ev.AlertEvaluator()._evaluate_rule({"id": "r1", "condition_sql": "select 1", "data_source_id": "d"}, svc, None)
    assert svc.failures == [("r1", "query_failed")]


def test_delivery_secrets_are_sealed_masked_and_kept(monkeypatch):
    from cryptography.fernet import Fernet

    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())
    from ee.modules.alerts import channel_secrets as cs

    url = "https://hooks.slack.com/services/T0/B0/secretvalue"
    stored = cs.seal([{"type": "slack", "webhook_url": url}, {"type": "email", "emails": ["a@b.co"]}])
    assert stored[0]["webhook_url"].startswith(cs.SEALED) and url not in str(stored)
    assert stored[1]["emails"] == ["a@b.co"]
    assert cs.reveal(stored[0])["webhook_url"] == url

    shown = cs.mask(stored)
    assert shown[0]["webhook_url"] == cs.MASK + "alue" and "secret" not in str(shown)

    # A form sends the mask back unchanged: the secret stays; a new value replaces it.
    assert cs.reveal(cs.seal(shown, stored)[0])["webhook_url"] == url
    assert cs.reveal(cs.seal([{"type": "slack", "webhook_url": "https://new"}], stored)[0])["webhook_url"] == "https://new"
    # Saving twice doesn't seal twice, and a value from before encryption still sends.
    assert cs.seal(stored)[0]["webhook_url"] == stored[0]["webhook_url"]
    assert cs.reveal({"type": "pagerduty", "key": "plain"})["key"] == "plain"
    # A mask with nothing behind it never becomes the address.
    assert "webhook_url" not in cs.seal([{"type": "slack", "webhook_url": cs.MASK + "abcd"}], [])[0]
