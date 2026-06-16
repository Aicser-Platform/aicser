"""Feed author display name must prefer real identity, never the synthetic 'User <id>'.

Order: full name (first + last) -> user.name -> email -> 'User <id>' fallback.
Users without a full name should show their email, not 'User 216f1939'.
"""

from types import SimpleNamespace

from src.modules.feed.service_serialization import FeedServiceSerializationMixin

_build_name = FeedServiceSerializationMixin._build_name


def _user(**kw):
    base = {"first_name": None, "last_name": None, "name": None, "email": None}
    base.update(kw)
    return SimpleNamespace(**base)


def test_full_name_wins():
    assert _build_name(_user(first_name="Makara", last_name="Sok", email="m@x.com"), "User abc") == "Makara Sok"


def test_email_used_when_no_full_name():
    assert _build_name(_user(email="makarasok1624@gmail.com"), "User 216f1939") == "makarasok1624@gmail.com"


def test_name_field_used_before_email():
    assert _build_name(_user(name="Display Name", email="m@x.com"), "User abc") == "Display Name"


def test_fallback_only_when_nothing_available():
    assert _build_name(_user(), "User 216f1939") == "User 216f1939"


def test_no_user_returns_fallback():
    assert _build_name(None, "User 216f1939") == "User 216f1939"
