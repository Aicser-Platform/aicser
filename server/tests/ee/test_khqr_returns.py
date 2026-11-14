"""Coming back from a KHQR payment, for what a person buys for themselves."""
import pytest
from fastapi import HTTPException

from src.modules.billing.khqr import router as R


def _payment(**metadata):
    return {"id": "p1", "status": "paid", "amount": 149, "currency": "USD", "metadata": metadata}


@pytest.fixture
def cutluy(monkeypatch):
    monkeypatch.setattr(R, "_require_enabled", lambda: None)
    applied = []

    async def apply(db, payment):
        applied.append(payment)
        return {"applied": True}

    monkeypatch.setattr(R, "apply_khqr_payment", apply)
    return applied


def _returns(monkeypatch, payment):
    async def get_payment(_):
        return payment

    monkeypatch.setattr(R.CutLuyService, "get_payment", get_payment)


async def test_a_personal_license_is_applied_for_someone_with_no_organization(monkeypatch, cutluy):
    _returns(monkeypatch, _payment(kind="personal_license", user_id="u-1"))

    async def no_org(*_):
        raise HTTPException(status_code=404, detail="No organization found")

    monkeypatch.setattr(R, "_resolve_org", no_org)
    result = await R.get_khqr_payment("p1", current_token={"sub": "u-1"}, db=None, x_organization_id=None)
    assert result["kind"] == "personal_license" and result["applied"] is True and len(cutluy) == 1


async def test_someone_else_cant_claim_a_personal_license(monkeypatch, cutluy):
    _returns(monkeypatch, _payment(kind="personal_license", user_id="u-1"))
    with pytest.raises(HTTPException) as refused:
        await R.get_khqr_payment("p1", current_token={"sub": "u-2"}, db=None, x_organization_id=None)
    assert refused.value.status_code == 403 and not cutluy


async def test_credit_packs_still_belong_to_the_organization(monkeypatch, cutluy):
    _returns(monkeypatch, _payment(kind="credit_pack", organization_id="o-1"))

    async def org(*_):
        return "u-2", "o-2"

    monkeypatch.setattr(R, "_resolve_org", org)
    with pytest.raises(HTTPException):
        await R.get_khqr_payment("p1", current_token={"sub": "u-2"}, db=None, x_organization_id=None)
    assert not cutluy
