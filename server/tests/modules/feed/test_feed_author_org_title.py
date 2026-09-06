"""Feed author 'title' must prefer the user's real platform Organization
(resolved via user_roles -> organizations) over their self-reported
"Company" profile text field, when both are available.

Live-reproduced: a demo user's self-reported company field ("Aiser") did
not match their actual organization name ("Aicser"), and the Author card
was showing the former as if it were an authoritative affiliation.
"""

from types import SimpleNamespace

from src.modules.feed.service_serialization import FeedServiceSerializationMixin


class _FakeService(FeedServiceSerializationMixin):
    """_to_author only touches self via _build_name (also on the mixin) —
    no db access needed for these calls."""


def _user(**kw):
    base = {
        "id": "95f07977-7222-4ba1-9eb3-86024e86ebd3",
        "first_name": "demo",
        "last_name": None,
        "name": None,
        "email": "demo@dataticon.com",
        "username": "dem",
        "avatar_url": None,
        "company": "Aiser",
    }
    base.update(kw)
    return SimpleNamespace(**base)


def test_real_org_name_wins_over_self_reported_company():
    svc = _FakeService()
    author = svc._to_author(_user(), "95f07977-7222-4ba1-9eb3-86024e86ebd3", org_name="Aicser")
    assert author.title == "Aicser"


def test_falls_back_to_company_field_when_no_org_resolved():
    svc = _FakeService()
    author = svc._to_author(_user(), "95f07977-7222-4ba1-9eb3-86024e86ebd3", org_name=None)
    assert author.title == "Aiser"


def test_username_and_name_are_unaffected_by_org_name():
    svc = _FakeService()
    author = svc._to_author(_user(), "95f07977-7222-4ba1-9eb3-86024e86ebd3", org_name="Aicser")
    assert author.name == "demo"
    assert author.username == "dem"
