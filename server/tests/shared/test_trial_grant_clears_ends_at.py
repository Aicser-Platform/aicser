"""A trial granted over an ended subscription must not inherit its ends_at: the feature
gate treats a past ends_at as ended and resolved such trials to the free tier."""

import os
import uuid
from datetime import datetime, timedelta, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock

os.environ.setdefault("AISER_EDITION", "enterprise")


def _result(*, one=None, mapping=None):
    res = MagicMock()
    res.fetchone.return_value = one
    res.mappings.return_value.first.return_value = mapping
    return res


async def test_trial_over_an_ended_subscription_clears_ends_at():
    from src.shared.trial_grant import GRANTED, grant_trial_once

    db = AsyncMock()
    db.execute.side_effect = [
        _result(one=SimpleNamespace(id=uuid.uuid4())),
        _result(mapping={
            "status": "canceled", "trial_used_at": None, "plan_slug": "free",
            "ends_at": datetime.now(timezone.utc) - timedelta(days=27),
        }),
        MagicMock(),
    ]

    out = await grant_trial_once(db, uuid.uuid4(), "team")

    assert out["outcome"] == GRANTED
    update_sql = str(db.execute.await_args_list[2].args[0])
    assert "status = 'trialing'" in update_sql
    assert "ends_at = NULL" in update_sql


def test_gate_treats_a_trial_with_a_stale_ends_at_as_ended():
    """Why the row must be cleaned: this is the gate's rule the stale value tripped."""
    from src.modules.pricing.feature_gate import _subscription_inactive

    now = datetime.now(timezone.utc)
    stale = SimpleNamespace(status="trialing", trial_ends_at=now + timedelta(days=13), ends_at=now - timedelta(days=27))
    clean = SimpleNamespace(status="trialing", trial_ends_at=now + timedelta(days=13), ends_at=None)

    assert _subscription_inactive(stale) is True
    assert _subscription_inactive(clean) is False
