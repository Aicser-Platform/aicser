"""A notebook DataFrame is forecast with the same engine as a forecast model, nothing saved."""

import pytest
from fastapi import HTTPException

from ee.modules.mlops import router as R


async def _no_gate(*a, **k):
    return None


@pytest.mark.asyncio
async def test_frame_forecast_uses_the_models_engine(monkeypatch):
    monkeypatch.setattr(R, "_caller", _no_gate)
    rows = [[f"2025-{m:02d}-01", 100 + m * 5] for m in range(1, 25)]
    out = await R.forecast_frame(R.ForecastFrameIn(columns=["month", "sales"], rows=rows, time_col="month",
                                                   value_col="sales", periods=6), current_token={}, db=None)
    assert len(out["forecast"]) == 6 and out["method"] and out["historical"]


@pytest.mark.asyncio
async def test_frame_forecast_rejects_missing_columns(monkeypatch):
    monkeypatch.setattr(R, "_caller", _no_gate)
    body = R.ForecastFrameIn(columns=["month", "sales"], rows=[["2025-01-01", 1]] * 4, time_col="day", value_col="sales")
    with pytest.raises(HTTPException) as e:
        await R.forecast_frame(body, current_token={}, db=None)
    assert e.value.status_code == 400
