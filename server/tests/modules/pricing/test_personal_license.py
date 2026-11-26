"""Aicser Personal: a 2-year desktop license for one person, renewable."""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.modules.pricing import personal_license as pl
from src.modules.pricing.plans import PERSONAL_LICENSE


class _Db:
    """Just enough of an AsyncSession for fulfil()."""

    def __init__(self, rows=()):
        self.rows = list(rows)
        self.commit = AsyncMock()
        self.flush = AsyncMock()

    def add(self, obj):
        obj.id = obj.id or uuid.uuid4()
        self.rows.append(obj)

    async def execute(self, _stmt):
        result = MagicMock()
        result.scalars.return_value.all.return_value = list(self.rows)
        return result


USER = str(uuid.uuid4())


def test_price_and_offer():
    assert pl.price("purchase") == Decimal("149.00")
    assert pl.price("renewal") == Decimal("69.00")
    assert PERSONAL_LICENSE["update_years"] == 2 and PERSONAL_LICENSE["tier"] == "personal"


@pytest.mark.asyncio
async def test_purchase_creates_license_with_two_years_of_updates():
    db = _Db()
    with patch.object(pl, "_issue_on_license_server", AsyncMock()) as issue:
        out = await pl.fulfil(db, kind="purchase", user_id=USER, email="a@b.c", provider="stripe",
                              reference="cs_1", amount=Decimal("149"))
    assert out["applied"] is True
    lic = db.rows[0]
    assert lic.devices == PERSONAL_LICENSE["devices"]
    years = (lic.updates_until - datetime.now(timezone.utc)).days / 365
    assert 1.99 < years < 2.01
    assert lic.payments[0]["reference"] == "cs_1"
    issue.assert_awaited_once()
    db.commit.assert_awaited()


@pytest.mark.asyncio
async def test_underpayment_and_duplicate_are_refused():
    db = _Db()
    out = await pl.fulfil(db, kind="purchase", user_id=USER, email=None, provider="khqr", reference="p1", amount=Decimal("10"))
    assert out == {"applied": False, "reason": "amount_mismatch"}
    existing = SimpleNamespace(id=uuid.uuid4(), payments=[{"reference": "p1"}])
    out = await pl.fulfil(_Db([existing]), kind="purchase", user_id=USER, email=None, provider="khqr",
                          reference="p1", amount=Decimal("149"))
    assert out == {"applied": False, "reason": "duplicate"}


@pytest.mark.asyncio
async def test_renewal_extends_from_later_of_today_and_current_date():
    future = datetime.now(timezone.utc) + timedelta(days=100)
    lic = SimpleNamespace(id=uuid.uuid4(), updates_until=future, payments=[], status="issued", license_id="L1",
                          devices=3, created_at=datetime.now(timezone.utc), activation_key=None, email=None)
    with patch.object(pl, "_issue_on_license_server", AsyncMock()), patch.object(pl, "flag_modified"):
        out = await pl.fulfil(_Db([lic]), kind="renewal", user_id=USER, email=None, provider="stripe",
                              reference="cs_2", amount=Decimal("69"), license_ref=str(lic.id))
    assert out["applied"] is True
    assert (lic.updates_until - future).days in (730, 731)

    lapsed = SimpleNamespace(id=uuid.uuid4(), updates_until=datetime.now(timezone.utc) - timedelta(days=400), payments=[],
                             status="issued", license_id="L2", devices=3, created_at=None, activation_key=None, email=None)
    with patch.object(pl, "_issue_on_license_server", AsyncMock()), patch.object(pl, "flag_modified"):
        await pl.fulfil(_Db([lapsed]), kind="renewal", user_id=USER, email=None, provider="stripe",
                        reference="cs_3", amount=Decimal("69"), license_ref=str(lapsed.id))
    years = (lapsed.updates_until - datetime.now(timezone.utc)).days / 365
    assert 1.99 < years < 2.01


@pytest.mark.asyncio
async def test_renewal_of_unknown_license_is_refused():
    out = await pl.fulfil(_Db(), kind="renewal", user_id=USER, email=None, provider="stripe",
                          reference="cs_4", amount=Decimal("69"), license_ref=str(uuid.uuid4()))
    assert out == {"applied": False, "reason": "license_not_found"}


@pytest.mark.asyncio
async def test_unconfigured_license_server_keeps_purchase_pending():
    lic = SimpleNamespace(id=uuid.uuid4(), license_id=None, status="pending", last_error=None)
    with patch.object(pl.settings, "LICENSE_ADMIN_TOKEN", ""):
        await pl._issue_on_license_server(lic)
    assert lic.status == "pending" and "not configured" in lic.last_error


@pytest.mark.asyncio
async def test_license_server_issue_stores_encrypted_key():
    lic = SimpleNamespace(id=uuid.uuid4(), license_id=None, status="pending", last_error=None, email="a@b.c",
                          user_id=USER, devices=3, updates_until=datetime.now(timezone.utc) + timedelta(days=730),
                          activation_key=None)
    resp = MagicMock(content=b"{}", raise_for_status=MagicMock())
    resp.json.return_value = {"license_id": "LIC-9", "activation_key": "KEY-123"}
    client = MagicMock()
    client.post = AsyncMock(return_value=resp)
    client.__aenter__ = AsyncMock(return_value=client)
    client.__aexit__ = AsyncMock(return_value=False)
    with patch.object(pl.settings, "LICENSE_ADMIN_TOKEN", "t"), patch.object(pl.httpx, "AsyncClient", return_value=client), \
         patch("src.modules.data.utils.credentials.encrypt_text", return_value="enc"):
        await pl._issue_on_license_server(lic)
    body = client.post.await_args.kwargs["json"]
    assert body["tier"] == "personal" and body["max_devices"] == 3
    # A 2-year license: it ends when its updates do.
    assert body["license_expires_at"] == body["updates_until"] == int(lic.updates_until.timestamp())
    assert lic.status == "issued" and lic.license_id == "LIC-9" and lic.activation_key == "enc"


@pytest.mark.asyncio
async def test_verify_session_applies_the_buyers_own_personal_payment():
    """The desktop checks the Stripe session right after paying (no wait for the webhook); same reference."""
    from src.modules.pricing import router as pricing_router

    session = SimpleNamespace(id="cs_1", payment_status="paid", amount_total=14900, subscription=None,
                              metadata={"kind": "personal_license", "license_kind": "purchase",
                                        "user_id": USER, "email": "a@b.c", "license_ref": ""})
    fulfil = AsyncMock(return_value={"applied": True, "license": {}})
    with patch.object(pricing_router.stripe.checkout.Session, "retrieve", return_value=session), \
         patch("src.modules.billing.stripe.stripe_service.StripeService.is_enabled", return_value=True), \
         patch.object(pl, "fulfil", fulfil):
        out = await pricing_router.verify_checkout_session("cs_1", current_token={"sub": USER}, db=MagicMock())
        assert out == {"success": True, "kind": "personal_license", "reason": None}
        assert fulfil.await_args.kwargs["reference"] == "cs_1"
        assert fulfil.await_args.kwargs["amount"] == Decimal("149")

        # Someone else's payment is refused.
        with pytest.raises(pricing_router.HTTPException) as refused:
            await pricing_router.verify_checkout_session("cs_1", current_token={"sub": "someone-else"}, db=MagicMock())
        assert refused.value.status_code == 403


def _issued(kind="purchase", email="buyer@example.com"):
    return SimpleNamespace(id=uuid.uuid4(), status="issued", email=email, activation_key="enc", devices=3,
                           updates_until=datetime(2028, 11, 20, tzinfo=timezone.utc),
                           payments=[{"kind": kind, "reference": "r1"}])


@pytest.mark.asyncio
async def test_a_purchase_emails_the_key_once_issued():
    send = AsyncMock(return_value=True)
    with patch.object(pl, "send_transactional_email", send), \
         patch("src.modules.data.utils.credentials.decrypt_text", return_value="AICSER-PER-ABCD-EFGH-JKMN-PQRS"):
        assert await pl._email_issued_license(_issued()) is True
    (to, subject, text), kwargs = send.await_args
    assert to == ["buyer@example.com"] and subject == "Your Aicser Personal license key"
    assert "AICSER-PER-ABCD-EFGH-JKMN-PQRS" in text and "20 November 2028" in text and "3 computers" in text
    assert "AICSER-PER-ABCD-EFGH-JKMN-PQRS" in kwargs["body_html"]


@pytest.mark.asyncio
async def test_a_renewal_emails_the_new_end_date_not_the_key():
    send = AsyncMock(return_value=True)
    with patch.object(pl, "send_transactional_email", send), \
         patch("src.modules.data.utils.credentials.decrypt_text", return_value="AICSER-PER-ABCD-EFGH-JKMN-PQRS"):
        assert await pl._email_issued_license(_issued(kind="renewal")) is True
    (_, subject, text), _ = send.await_args
    assert subject == "Aicser Personal renewed until 20 November 2028"
    assert "AICSER-PER" not in text


@pytest.mark.asyncio
async def test_no_email_while_pending_without_an_address_or_when_sending_fails():
    send = AsyncMock(return_value=True)
    with patch.object(pl, "send_transactional_email", send):
        pending = _issued()
        pending.status = "pending"
        assert await pl._email_issued_license(pending) is False
        assert await pl._email_issued_license(_issued(email=None)) is False
    send.assert_not_awaited()

    broken = AsyncMock(side_effect=RuntimeError("SMTP down"))
    with patch.object(pl, "send_transactional_email", broken), \
         patch("src.modules.data.utils.credentials.decrypt_text", return_value="K"):
        assert await pl._email_issued_license(_issued()) is False  # the sale stands


# ── Guests: buy from the desktop with just an email ──────────────────────────────────────────────────────────


def test_a_guest_is_known_by_their_email_only():
    assert pl.normalize_email("  Buyer@Example.COM ") == "buyer@example.com"
    assert pl.guest_user_id("Buyer@Example.com") == pl.guest_user_id("buyer@example.com")
    assert pl.guest_user_id("a@b.co") != pl.guest_user_id("c@b.co")
    for bad in ["", "nope", "a@b", "a b@c.co", "x" * 250 + "@b.co"]:
        with pytest.raises(ValueError):
            pl.normalize_email(bad)


def test_the_guest_checkout_is_rate_limited_per_ip_and_email():
    limiter = pl.GuestLimiter(limit=2, window_seconds=3600)
    assert limiter.allow("k") and limiter.allow("k")
    assert not limiter.allow("k")
    assert limiter.allow("other")


@pytest.mark.asyncio
async def test_signing_in_with_the_same_email_shows_licenses_bought_as_a_guest():
    seen = {}

    class Db:
        async def execute(self, stmt):
            seen["sql"] = str(stmt.compile(compile_kwargs={"literal_binds": True}))
            result = MagicMock()
            result.scalars.return_value.all.return_value = []
            return result

    await pl.list_for_user(Db(), USER, "Buyer@example.com")
    assert USER.replace("-", "") in seen["sql"].replace("-", "")
    assert pl.guest_user_id("buyer@example.com").replace("-", "") in seen["sql"].replace("-", "")


@pytest.mark.asyncio
async def test_guest_verify_applies_only_guest_personal_checkouts_and_never_returns_the_key():
    from src.modules.pricing import router as pricing_router

    guest = pl.guest_user_id("buyer@example.com")
    paid = SimpleNamespace(id="cs_g", payment_status="paid", amount_total=14900,
                           metadata={"kind": "personal_license", "guest": "1", "user_id": guest, "email": "buyer@example.com"})
    fulfil = AsyncMock(return_value={"applied": True, "license": {"activation_key": "SECRET"}})
    with patch.object(pricing_router.stripe.checkout.Session, "retrieve", return_value=paid), \
         patch("src.modules.billing.stripe.stripe_service.StripeService.is_enabled", return_value=True), \
         patch.object(pl, "fulfil", fulfil):
        out = await pricing_router.personal_license_guest_verify("cs_g", db=MagicMock())
    assert out == {"success": True, "email": "buyer@example.com", "reason": None}
    assert "SECRET" not in str(out)
    assert fulfil.await_args.kwargs["user_id"] == guest and fulfil.await_args.kwargs["reference"] == "cs_g"

    signed_in = SimpleNamespace(id="cs_u", payment_status="paid", amount_total=14900,
                                metadata={"kind": "personal_license", "user_id": USER})
    with patch.object(pricing_router.stripe.checkout.Session, "retrieve", return_value=signed_in), \
         patch("src.modules.billing.stripe.stripe_service.StripeService.is_enabled", return_value=True):
        with pytest.raises(pricing_router.HTTPException) as refused:
            await pricing_router.personal_license_guest_verify("cs_u", db=MagicMock())
    assert refused.value.status_code == 404


@pytest.mark.asyncio
async def test_guest_checkout_refuses_a_bad_email_before_stripe():
    from src.modules.pricing import router as pricing_router

    request = SimpleNamespace(client=SimpleNamespace(host="1.2.3.4"))
    body = pricing_router.GuestPersonalCheckout(email="nope", success_url="https://x/s", cancel_url="https://x/c")
    with pytest.raises(pricing_router.HTTPException) as refused:
        await pricing_router.personal_license_guest_checkout(body, request)
    assert refused.value.status_code == 400
