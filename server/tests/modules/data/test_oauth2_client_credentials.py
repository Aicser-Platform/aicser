"""Generic OAuth2 client-credentials token acquisition and caching.

Generalizes what knowledge_connectors._graph_token and
bi_sync.powerbi_service.get_powerbi_access_token each implemented
independently (duplicated, uncached). These tests lock in the caching
behavior neither original implementation had, and the failure-does-not-raise
contract both call sites depend on.
"""
from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.data.services.oauth2_client_credentials import (
    OAuth2ClientCredentials,
    azure_ad_token_url,
    get_client_credentials_token,
    invalidate_client_credentials_token,
)


class _FakeResp:
    def __init__(self, status_code=200, access_token="tok", expires_in=3600, text=""):
        self.status_code = status_code
        self._access_token = access_token
        self._expires_in = expires_in
        self.text = text

    def json(self):
        return {"access_token": self._access_token, "expires_in": self._expires_in}


def test_azure_ad_token_url():
    assert azure_ad_token_url("my-tenant") == (
        "https://login.microsoftonline.com/my-tenant/oauth2/v2.0/token"
    )


@pytest.mark.asyncio
async def test_token_is_cached_across_calls():
    creds = OAuth2ClientCredentials(
        token_url="https://example.com/token",
        client_id="cache-test-client",
        client_secret="secret",
        scope="scope-a",
    )
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_FakeResp(access_token="first"))) as mock_post:
        tok1 = await get_client_credentials_token(creds)
        tok2 = await get_client_credentials_token(creds)
    assert tok1 == tok2 == "first"
    assert mock_post.call_count == 1


@pytest.mark.asyncio
async def test_invalidate_forces_refetch():
    creds = OAuth2ClientCredentials(
        token_url="https://example.com/token",
        client_id="invalidate-test-client",
        client_secret="secret",
        scope="scope-b",
    )
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_FakeResp(access_token="v1"))):
        await get_client_credentials_token(creds)
    invalidate_client_credentials_token(creds)
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_FakeResp(access_token="v2"))) as mock_post:
        tok = await get_client_credentials_token(creds)
    assert tok == "v2"
    assert mock_post.call_count == 1


@pytest.mark.asyncio
async def test_different_scope_is_a_different_cache_entry():
    base = dict(token_url="https://example.com/token", client_id="scope-test-client", client_secret="secret")
    creds_a = OAuth2ClientCredentials(scope="scope-x", **base)
    creds_b = OAuth2ClientCredentials(scope="scope-y", **base)
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_FakeResp(access_token="tok-x"))):
        tok_a = await get_client_credentials_token(creds_a)
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_FakeResp(access_token="tok-y"))):
        tok_b = await get_client_credentials_token(creds_b)
    assert tok_a == "tok-x"
    assert tok_b == "tok-y"


@pytest.mark.asyncio
async def test_returns_none_on_http_error_without_raising():
    creds = OAuth2ClientCredentials(
        token_url="https://example.com/token",
        client_id="fail-test-client",
        client_secret="wrong",
        scope="scope-fail",
    )
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_FakeResp(status_code=401, text="invalid_client"))):
        tok = await get_client_credentials_token(creds)
    assert tok is None


@pytest.mark.asyncio
async def test_returns_none_when_response_has_no_access_token():
    creds = OAuth2ClientCredentials(
        token_url="https://example.com/token",
        client_id="empty-test-client",
        client_secret="secret",
        scope="scope-empty",
    )

    class _EmptyResp:
        status_code = 200
        text = ""

        def json(self):
            return {}

    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_EmptyResp())):
        tok = await get_client_credentials_token(creds)
    assert tok is None


@pytest.mark.asyncio
async def test_returns_none_on_network_exception():
    creds = OAuth2ClientCredentials(
        token_url="https://example.com/token",
        client_id="exc-test-client",
        client_secret="secret",
        scope="scope-exc",
    )
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=ConnectionError("boom"))):
        tok = await get_client_credentials_token(creds)
    assert tok is None
