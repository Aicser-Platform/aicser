import os

os.environ.setdefault("AISER_EDITION", "enterprise")

import uuid
from pathlib import Path

import pytest

FIXTURES = Path(__file__).parent / "fixtures" / "onboarding"


class FakeResult:
    def __init__(self, value):
        self._value = value

    def scalar_one_or_none(self):
        return self._value


class FakeDB:
    """Returns the session first, then the staging object."""

    def __init__(self, *objects):
        self.objects = list(objects)

    async def execute(self, _statement):
        return FakeResult(self.objects.pop(0) if self.objects else None)

    def add(self, obj):
        pass

    async def commit(self):
        pass


def _session(decisions):
    from src.modules.data.models import DataOnboardingSession

    return DataOnboardingSession(
        id=uuid.uuid4(),
        organization_id=uuid.uuid4(),
        data_source_id="asset-1",
        staging_object_id=uuid.uuid4(),
        status="review",
        decisions=decisions,
    )


async def _preview(
    tmp_path, monkeypatch, decisions, *, fixture="dirty_sales.csv", **kwargs
):
    from src.core.config import settings
    from src.modules.pipeline.onboarding.service import preview_session
    from src.modules.pipeline.storage import LocalObjectStore

    monkeypatch.setattr(settings, "STORAGE_BACKEND", "", raising=False)
    monkeypatch.setattr(settings, "LAKE_ROOT", str(tmp_path), raising=False)

    store = LocalObjectStore(root=str(tmp_path))
    key = f"staging/{fixture}"
    await store.store_file((FIXTURES / fixture).read_bytes(), key)

    session = _session(decisions)

    class Obj:
        object_key = key
        format = "csv"

    return await preview_session(FakeDB(session, Obj()), session.id, **kwargs)


async def test_raw_mode_returns_the_untouched_rows(tmp_path, monkeypatch):
    result = await _preview(tmp_path, monkeypatch, {}, mode="raw")

    assert result.mode == "raw"
    assert result.total_rows == 8
    assert result.returned_rows == 8
    assert result.quarantined_count == 0
    assert {c.name for c in result.columns} >= {
        "order_id",
        "region",
        "amount",
        "order_date",
    }


async def test_typed_mode_applies_the_confirmed_casts(tmp_path, monkeypatch):
    result = await _preview(
        tmp_path, monkeypatch, {"types": {"amount": "double"}}, mode="typed"
    )

    amount = next(c for c in result.columns if c.name == "amount")
    assert "double" in amount.type.lower()


async def test_typed_mode_treats_missing_values_as_missing_not_quarantined(
    tmp_path, monkeypatch
):
    """amount has three non-null values that cannot become a double: 'N/A', an
    empty string, and a whitespace-only string. pyarrow's CSV reader keeps all
    three as literal (non-null) strings rather than nulls (the amount column
    mixes numeric and non-numeric text, so it is read as `string`, and
    `strings_can_be_null` defaults to False, so pyarrow's null_values list is
    not applied to it) -- verified empirically:
    amount == ['1240.00', '', '880.50', 'N/A', '412.25', '  ', '999.99', '150.00'].
    All three ('', 'N/A', '  ') are *missing* values -- blank, whitespace-only,
    and a recognized null token -- not malformed ones, so `bad_row_predicate`
    treats them as fine (they become NULL) rather than quarantine-worthy: 0
    rows are flagged.
    """
    result = await _preview(
        tmp_path, monkeypatch, {"types": {"amount": "double"}}, mode="typed"
    )

    assert result.quarantined_count == 0
    flagged = [row for row in result.rows if row["__quarantined"]]
    assert len(flagged) == 0


async def test_typed_mode_flags_rows_that_would_be_quarantined(tmp_path, monkeypatch):
    """malformed_values.csv's amount column has a valid number, a blank (missing,
    not bad), and 'oops' (genuinely malformed). Only the 'oops' row should be
    flagged for quarantine.
    """
    result = await _preview(
        tmp_path,
        monkeypatch,
        {"types": {"amount": "double"}},
        mode="typed",
        fixture="malformed_values.csv",
    )

    assert result.quarantined_count == 1
    flagged = [row for row in result.rows if row["__quarantined"]]
    assert len(flagged) == 1
    # typed mode already applied the cast, so the malformed value became NULL;
    # the row itself (order_id 3, the 'oops' row) is what got flagged.
    assert flagged[0]["order_id"] == 3
    assert flagged[0]["amount"] is None


async def test_raw_mode_never_flags_anything(tmp_path, monkeypatch):
    result = await _preview(
        tmp_path, monkeypatch, {"types": {"amount": "double"}}, mode="raw"
    )

    assert result.quarantined_count == 0
    assert all(row["__quarantined"] is False for row in result.rows)


async def test_the_limit_caps_returned_rows_and_sets_truncated(tmp_path, monkeypatch):
    result = await _preview(tmp_path, monkeypatch, {}, mode="raw", limit=3)

    assert result.returned_rows == 3
    assert result.total_rows == 8
    assert result.truncated is True


async def test_a_limit_above_the_cap_is_clamped(tmp_path, monkeypatch):
    from src.modules.pipeline.onboarding.service import PREVIEW_ROW_CAP

    result = await _preview(tmp_path, monkeypatch, {}, mode="raw", limit=100_000)

    assert result.returned_rows <= PREVIEW_ROW_CAP


async def test_values_are_json_safe(tmp_path, monkeypatch):
    """Dates and decimals must survive JSON encoding."""
    import json

    result = await _preview(
        tmp_path, monkeypatch, {"types": {"amount": "double"}}, mode="typed"
    )

    json.dumps(result.rows)  # raises if a value is not JSON-native


async def test_a_session_with_no_staged_object_raises(tmp_path, monkeypatch):
    from src.modules.pipeline.onboarding.service import preview_session

    session = _session({})
    session.staging_object_id = None

    with pytest.raises(ValueError, match="no staged object"):
        await preview_session(FakeDB(session), session.id)
