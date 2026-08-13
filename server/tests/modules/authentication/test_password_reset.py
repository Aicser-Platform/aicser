import os
from uuid import uuid4

import pytest

os.environ["DEBUG"] = "false"

from src.modules.authentication import service
from src.modules.authentication.models import PasswordResetToken
from src.modules.user.models import User


class FakeSession:
    def __init__(self):
        self.added = []
        self.commits = 0
        self.executed = []

    async def execute(self, statement):
        self.executed.append(statement)

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1


@pytest.mark.asyncio
async def test_request_password_reset_ignores_unknown_email(monkeypatch):
    async def fake_get_user_by_email(db, email):
        return None

    async def fake_send_transactional_email(*args, **kwargs):
        raise AssertionError("email should not be sent for unknown account")

    db = FakeSession()
    monkeypatch.setattr(service, "get_user_by_email", fake_get_user_by_email)
    monkeypatch.setattr(service, "send_transactional_email", fake_send_transactional_email)

    await service.request_password_reset(db, "missing@example.com")

    assert db.added == []
    assert db.commits == 0
    assert db.executed == []


@pytest.mark.asyncio
async def test_request_password_reset_emails_local_user_with_hashed_token(monkeypatch):
    user = User(
        id=uuid4(),
        email="owner@example.com",
        hashed_password="hashed-password",
        provider="ce",
    )
    sent = {}

    async def fake_get_user_by_email(db, email):
        assert email == "owner@example.com"
        return user

    async def fake_send_transactional_email(recipients, subject, body_text, *, body_html=None):
        sent["recipients"] = recipients
        sent["subject"] = subject
        sent["body_text"] = body_text
        sent["body_html"] = body_html
        return True

    db = FakeSession()
    monkeypatch.setattr(service, "get_user_by_email", fake_get_user_by_email)
    monkeypatch.setattr(service, "send_transactional_email", fake_send_transactional_email)

    await service.request_password_reset(db, "OWNER@example.com")

    assert len(db.added) == 1
    reset = db.added[0]
    assert isinstance(reset, PasswordResetToken)
    assert reset.email == "owner@example.com"
    assert len(reset.token_hash) == 64
    assert len(reset.code_hash) == 64
    assert reset.token_hash not in sent["body_text"]
    assert reset.code_hash not in sent["body_text"]
    assert sent["recipients"] == ["owner@example.com"]
    assert "Reset your Aicser password" == sent["subject"]
