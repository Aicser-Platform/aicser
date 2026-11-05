"""Alert incidents: one per breach, counted repeats, reminders, quiet once acknowledged, recovery."""

from datetime import datetime, timedelta, timezone

import pytest

from ee.modules.alerts.alert_evaluator import AlertEvaluator, normalize_operator
from ee.modules.alerts.alert_rules_service import rule_signature


class FakeStore:
    def __init__(self):
        self.events = []  # dicts with id, status, triggered_at, last_notified_at, occurrences, peak_value
        self.touched = 0

    async def touch_evaluated_at(self, rule_id):
        self.touched += 1

    async def record_observation(self, *a):
        pass

    async def open_event(self, rule_id):
        return next((e for e in self.events if e["status"] in ("firing", "acknowledged")), None)

    async def create_event(self, rule_id, value, message):
        now = datetime.now(timezone.utc)
        self.events.append({"id": f"e{len(self.events) + 1}", "status": "firing", "triggered_at": now,
                            "last_notified_at": now, "occurrences": 1, "peak_value": value})
        return self.events[-1]["id"]

    async def still_breached(self, event_id, value, worse, notified):
        e = next(x for x in self.events if x["id"] == event_id)
        e["occurrences"] += 1
        if worse:
            e["peak_value"] = value
        if notified:
            e["last_notified_at"] = datetime.now(timezone.utc)

    async def resolve_open(self, rule_id):
        e = await self.open_event(rule_id)
        if e:
            e["status"] = "resolved"
        return e


class FakeNotifier:
    def __init__(self):
        self.sent = []

    async def notify(self, rule, event_id, value, message):
        self.sent.append(message)


RULE = {"id": "r1", "name": "Low stock", "threshold_operator": "lt", "threshold_value": 20, "window_minutes": 60}


async def _check(store, notifier, value):
    await AlertEvaluator()._compare_and_notify(dict(RULE), store, notifier, value, None)


@pytest.mark.asyncio
async def test_one_incident_per_breach_with_reminders_and_recovery():
    store, notifier = FakeStore(), FakeNotifier()
    await _check(store, notifier, 9)  # "lt" means below: 9 < 20 breaches (it used to be read as ">")
    assert len(store.events) == 1 and len(notifier.sent) == 1
    await _check(store, notifier, 7)  # still breached, within the hour: counted, no new message
    assert len(store.events) == 1 and store.events[0]["occurrences"] == 2 and len(notifier.sent) == 1
    assert store.events[0]["peak_value"] == 7  # the worst value for "below" is the lowest
    store.events[0]["last_notified_at"] -= timedelta(minutes=61)
    await _check(store, notifier, 8)  # an hour on: one reminder
    assert len(notifier.sent) == 2 and notifier.sent[-1].startswith("Still breached")
    await _check(store, notifier, 25)  # back above the line: resolved, said once
    assert store.events[0]["status"] == "resolved" and notifier.sent[-1].startswith("Back to normal")
    await _check(store, notifier, 30)
    assert len(notifier.sent) == 3
    await _check(store, notifier, 5)  # a new breach is a new incident
    assert len(store.events) == 2


@pytest.mark.asyncio
async def test_acknowledged_incident_stays_quiet():
    store, notifier = FakeStore(), FakeNotifier()
    await _check(store, notifier, 9)
    store.events[0]["status"] = "acknowledged"
    store.events[0]["last_notified_at"] -= timedelta(hours=5)
    await _check(store, notifier, 9)
    assert len(notifier.sent) == 1 and store.events[0]["occurrences"] == 2


def test_operator_words_mean_what_they_say():
    assert normalize_operator("lt") == "<" and normalize_operator("gte") == ">=" and normalize_operator(">") == ">"
    assert normalize_operator("nonsense") == ">"


def test_same_check_written_differently_is_a_duplicate():
    a = {"project_id": "p", "data_source_id": "d", "condition_sql": "SELECT COUNT(*) FROM stock WHERE qty < 20",
         "threshold_operator": "gt", "threshold_value": 0}
    b = {**a, "condition_sql": "select count(*)\n  from stock where qty<20;", "threshold_operator": ">", "threshold_value": "0"}
    c = {**a, "threshold_value": 5}
    assert rule_signature(a) == rule_signature(b)
    assert rule_signature(a) != rule_signature(c)
