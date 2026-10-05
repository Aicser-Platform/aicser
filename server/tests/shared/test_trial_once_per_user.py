"""One free trial per organization AND per user, never applied by default, and a
spent trial in onboarding never turns into a surprise payment redirect."""

import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

os.environ.setdefault("AISER_EDITION", "enterprise")


def _result(*, one=None, mapping=None):
    res = MagicMock()
    res.fetchone.return_value = one
    res.mappings.return_value.first.return_value = mapping
    return res


def _free_row(**overrides):
    row = {"status": "active", "trial_used_at": None, "plan_slug": "free", "ends_at": None, "provider": "internal"}
    row.update(overrides)
    return row


async def test_user_who_used_a_trial_in_another_org_is_refused():
    from src.shared.trial_grant import ALREADY_USED, grant_trial_once

    db = AsyncMock()
    db.execute.side_effect = [
        _result(one=SimpleNamespace(id=uuid.uuid4())),  # plan
        _result(mapping=_free_row()),                   # this org: never trialed
        _result(one=(1,)),                              # user owns another org that trialed
    ]

    out = await grant_trial_once(db, uuid.uuid4(), "pro", user_id=str(uuid.uuid4()))

    assert out == {"outcome": ALREADY_USED, "reason": "user_already_used"}
    assert db.execute.await_count == 3  # nothing written


async def test_first_trial_for_user_and_org_is_granted():
    from src.shared.trial_grant import GRANTED, grant_trial_once

    db = AsyncMock()
    db.execute.side_effect = [
        _result(one=SimpleNamespace(id=uuid.uuid4())),
        _result(mapping=_free_row()),
        _result(one=None),                   # user never trialed anywhere
        _result(one=(uuid.uuid4(),)),        # users.trial_used_at claimed
        MagicMock(),                         # subscription UPDATE
    ]

    out = await grant_trial_once(db, uuid.uuid4(), "team", user_id=str(uuid.uuid4()))

    assert out["outcome"] == GRANTED
    claim_sql = str(db.execute.await_args_list[3].args[0])
    assert "UPDATE users" in claim_sql and "trial_used_at IS NULL" in claim_sql
    assert "trial_used_at = :now" in str(db.execute.await_args_list[4].args[0])


async def test_concurrent_second_trial_for_same_user_is_refused_without_writing():
    """Another org's request claimed users.trial_used_at between our check and our claim."""
    from src.shared.trial_grant import ALREADY_USED, grant_trial_once

    db = AsyncMock()
    db.execute.side_effect = [
        _result(one=SimpleNamespace(id=uuid.uuid4())),
        _result(mapping=_free_row()),
        _result(one=None),   # check: not used yet
        _result(one=None),   # claim: lost the race, nothing updated
        _result(one=(1,)),   # the users row exists
    ]

    out = await grant_trial_once(db, uuid.uuid4(), "pro", user_id=str(uuid.uuid4()))

    assert out == {"outcome": ALREADY_USED, "reason": "user_already_used"}
    assert not any("status = 'trialing'" in str(c.args[0]) for c in db.execute.await_args_list)


async def test_user_check_reads_the_users_trial_column():
    from src.shared.trial_grant import user_has_used_trial

    db = AsyncMock()
    db.execute.return_value = _result(one=(1,))

    assert await user_has_used_trial(db, str(uuid.uuid4())) is True
    sql = str(db.execute.await_args.args[0])
    assert "FROM users u" in sql and "u.trial_used_at IS NOT NULL" in sql


async def test_org_that_used_its_trial_is_refused_before_user_check():
    from src.shared.trial_grant import ALREADY_USED, grant_trial_once

    db = AsyncMock()
    db.execute.side_effect = [
        _result(one=SimpleNamespace(id=uuid.uuid4())),
        _result(mapping=_free_row(trial_used_at=datetime.now(timezone.utc) - timedelta(days=30))),
    ]

    out = await grant_trial_once(db, uuid.uuid4(), "pro", user_id=str(uuid.uuid4()))

    assert out["outcome"] == ALREADY_USED


def test_paid_plan_in_effect_rules():
    from src.shared.trial_grant import _in_effect

    now = datetime.now(timezone.utc)
    past, future = now - timedelta(days=1), now + timedelta(days=1)
    # A lapsed prepaid KHQR period no longer blocks a trial...
    assert _in_effect("active", past, "khqr", now) is False
    assert _in_effect("active", future, "khqr", now) is True
    # ...but a Stripe row awaiting its renewal webhook still does, for a while.
    assert _in_effect("active", past, "stripe", now) is True
    assert _in_effect("active", now - timedelta(days=30), "stripe", now) is False
    # An internally assigned plan ends at its ends_at.
    assert _in_effect("active", past, "internal", now) is False
    # Stripe is still retrying a failed payment: the plan stays.
    assert _in_effect("past_due", future, "stripe", now) is True
    assert _in_effect("canceled", future, "stripe", now) is True
    assert _in_effect("canceled", past, "stripe", now) is False
    assert _in_effect("canceled", None, "stripe", now) is False


async def test_prefill_never_defaults_to_a_trial():
    from src.modules.onboarding.frictionless_optimizer import FrictionlessOptimizer

    db = AsyncMock()
    db.execute.return_value = _result(one=SimpleNamespace(email="a@example.org", first_name="A", last_name="B"))

    out = await FrictionlessOptimizer(db).prefill_onboarding_data(str(uuid.uuid4()), {})

    assert out["plan"]["enableTeamTrial"] is False
    assert out["plan"]["enableProTrial"] is False
    assert out["plan"]["selectedPlan"] == "free"
