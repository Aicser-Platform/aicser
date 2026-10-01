"""Notebook schedules run at wall-clock times in their own zone, across DST changes."""

from datetime import datetime, timezone

from ee.modules.notebook_runs.schedule import next_run

UTC = timezone.utc


def test_hourly_daily_weekdays_weekly():
    t = datetime(2026, 9, 29, 10, 20, tzinfo=UTC)  # a Tuesday
    assert next_run("hourly", minute=15, after=t) == datetime(2026, 9, 29, 11, 15, tzinfo=UTC)
    assert next_run("hourly", minute=30, after=t) == datetime(2026, 9, 29, 10, 30, tzinfo=UTC)
    assert next_run("daily", hour=7, minute=0, after=t) == datetime(2026, 9, 30, 7, 0, tzinfo=UTC)
    fri = datetime(2026, 10, 2, 9, 0, tzinfo=UTC)
    assert next_run("weekdays", hour=7, minute=0, after=fri) == datetime(2026, 10, 5, 7, 0, tzinfo=UTC)  # Monday
    assert next_run("weekly", hour=7, minute=0, weekday=0, after=t) == datetime(2026, 10, 5, 7, 0, tzinfo=UTC)


def test_time_zone_and_daylight_saving():
    t = datetime(2026, 9, 29, 0, 0, tzinfo=UTC)
    assert next_run("daily", hour=7, minute=0, tz="Asia/Phnom_Penh", after=t) == datetime(2026, 9, 30, 0, 0, tzinfo=UTC)
    # New York leaves daylight saving on 1 Nov 2026: 07:00 local is 11:00 UTC before, 12:00 after.
    before = datetime(2026, 10, 31, 12, 0, tzinfo=UTC)
    assert next_run("daily", hour=7, minute=0, tz="America/New_York", after=before) == datetime(2026, 11, 1, 12, 0, tzinfo=UTC)
    assert next_run("daily", hour=7, minute=0, tz="Not/AZone", after=t) == datetime(2026, 9, 29, 7, 0, tzinfo=UTC)
