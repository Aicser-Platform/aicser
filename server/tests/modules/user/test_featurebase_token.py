"""The support portal is a cross-origin Featurebase iframe; signing users in needs a JWT from
the server (secure installation). Without FEATUREBASE_JWT_SECRET the portal stays anonymous."""

from unittest.mock import AsyncMock, patch

import jwt
import pytest

from src.modules.user.router import get_featurebase_token

TOKEN = {"sub": "8cf102a8-fd93-40d1-bed3-50e42158d62a"}
PROFILE = {"id": "8cf102a8-fd93-40d1-bed3-50e42158d62a", "email": "ada@example.com", "first_name": "Ada", "last_name": "Lovelace"}


@pytest.mark.asyncio
async def test_no_secret_means_no_token(monkeypatch):
    monkeypatch.delenv("FEATUREBASE_JWT_SECRET", raising=False)
    assert await get_featurebase_token(current_token=TOKEN, db=AsyncMock()) == {"token": None}


@pytest.mark.asyncio
async def test_token_carries_the_signed_in_user(monkeypatch):
    monkeypatch.setenv("FEATUREBASE_JWT_SECRET", "s3cret")
    with patch("src.modules.user.router.UserService.get_profile", new=AsyncMock(return_value=PROFILE)):
        result = await get_featurebase_token(current_token=TOKEN, db=AsyncMock())
    claims = jwt.decode(result["token"], "s3cret", algorithms=["HS256"])
    assert claims["email"] == "ada@example.com"
    assert claims["name"] == "Ada Lovelace"
    assert claims["userId"] == PROFILE["id"]
    assert claims["exp"] > 0
