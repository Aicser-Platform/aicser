"""REST API enterprise connector: OAuth2 client-credentials auth path.

This is the entry point future OAuth2-based systems (SAP OData, Dynamics
365, ...) would use without any connector-specific code -- just
config.metadata carrying oauth2_token_url/client_id/client_secret/scope.
"""
from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.data.services.enterprise_connectors_service import (
    ConnectionConfig,
    ConnectorType,
    EnterpriseConnectorsService,
)


class _FakeTokenResp:
    status_code = 200
    text = ""

    def json(self):
        return {"access_token": "oauth2-rest-token", "expires_in": 3600}


@pytest.mark.asyncio
async def test_rest_api_uses_oauth2_metadata_when_no_static_token():
    svc = EnterpriseConnectorsService()
    config = ConnectionConfig(
        connector_type=ConnectorType.REST_API,
        name="oauth2-rest",
        host="https://api.example.com",
        metadata={
            "oauth2_token_url": "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
            "oauth2_client_id": "cid",
            "oauth2_client_secret": "secret",
            "oauth2_scope": "https://example.com/.default",
        },
    )
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_FakeTokenResp())):
        result = await svc._connect_rest_api(config, test_only=False)
    assert result["success"] is True
    assert result["connection"]["headers"]["Authorization"] == "Bearer oauth2-rest-token"


@pytest.mark.asyncio
async def test_rest_api_static_api_key_takes_priority_over_oauth2():
    """A pre-supplied api_key must win -- no network round-trip needed, and it's unambiguous."""
    svc = EnterpriseConnectorsService()
    config = ConnectionConfig(
        connector_type=ConnectorType.REST_API,
        name="static-key-wins",
        host="https://api.example.com",
        api_key="static-key-abc",
        metadata={"oauth2_token_url": "https://example.com/token", "oauth2_client_id": "x", "oauth2_client_secret": "y"},
    )
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=AssertionError("must not call the token endpoint"))):
        result = await svc._connect_rest_api(config, test_only=False)
    assert result["success"] is True
    assert result["connection"]["headers"]["Authorization"] == "Bearer static-key-abc"


@pytest.mark.asyncio
async def test_rest_api_no_auth_configured_omits_authorization_header():
    svc = EnterpriseConnectorsService()
    config = ConnectionConfig(connector_type=ConnectorType.REST_API, name="no-auth", host="https://api.example.com")
    result = await svc._connect_rest_api(config, test_only=False)
    assert result["success"] is True
    assert "Authorization" not in result["connection"]["headers"]


@pytest.mark.asyncio
async def test_rest_api_oauth2_failure_returns_error_not_exception():
    svc = EnterpriseConnectorsService()
    config = ConnectionConfig(
        connector_type=ConnectorType.REST_API,
        name="oauth2-fails",
        host="https://api.example.com",
        # Distinct client_id from the success test above: the token cache
        # key is (token_url, client_id, scope), and a cache hit here would
        # skip the network call entirely, silently no-op'ing this test.
        metadata={
            "oauth2_token_url": "https://login.microsoftonline.com/tenant/oauth2/v2.0/token",
            "oauth2_client_id": "cid-that-gets-denied",
            "oauth2_client_secret": "wrong-secret",
            "oauth2_scope": "https://example.com/.default",
        },
    )

    class _Denied:
        status_code = 401
        text = "invalid_client"

        def json(self):
            return {}

    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=_Denied())):
        result = await svc._connect_rest_api(config, test_only=False)
    assert result["success"] is False
    assert "OAuth2" in result["error"]
