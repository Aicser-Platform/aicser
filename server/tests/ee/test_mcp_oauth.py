"""OAuth rules for the MCP server that need no database."""
import base64
import hashlib
from datetime import datetime, timedelta, timezone

import jwt
import pytest

from src.core.config import settings
from src.modules.authentication.service import decode_access_token
from ee.modules.mcp_server import oauth_service as O


@pytest.mark.parametrize("uri,allowed", [
    ("https://client.example/cb", True), ("http://localhost:3334/cb", True), ("http://127.0.0.1/cb", True),
    ("http://evil.example/cb", False), ("javascript:alert(1)", False), ("https://client.example/cb#frag", False), ("", False),
])
def test_redirects(uri, allowed):
    assert O.valid_redirect(uri) is allowed


def test_pkce():
    verifier = "a-long-random-verifier"
    challenge = base64.urlsafe_b64encode(hashlib.sha256(verifier.encode()).digest()).rstrip(b"=").decode()
    assert O._pkce_ok(verifier, challenge) and not O._pkce_ok("other", challenge)


def test_an_mcp_token_can_never_pass_as_a_login():
    token = O._access_token(grant_id="g", user_id="u", organization_id="o", client_id="c", audience="https://x/mcp")
    with pytest.raises(Exception):
        decode_access_token(token)


def test_the_signing_key_is_not_the_session_key():
    assert O._signing_key() != str(settings.SECRET_KEY)


def test_a_token_for_another_server_is_not_accepted():
    token = O._access_token(grant_id="g", user_id="u", organization_id="o", client_id="c", audience="https://a/mcp")
    with pytest.raises(jwt.InvalidAudienceError):
        jwt.decode(token, O._signing_key(), algorithms=["HS256"], audience="https://b/mcp")


def test_the_copilot_package_calls_mcp_as_the_signed_in_person():
    import io
    import json
    import zipfile

    from ee.modules.mcp_server.oauth_router import copilot_package

    data = copilot_package(mcp_url="https://x/mcp", site="https://x", app_id="id", oauth_reference="ref", tool_names=["list_metrics"])
    plugin = json.loads(zipfile.ZipFile(io.BytesIO(data)).read("aicser-plugin.json"))
    runtime = plugin["runtimes"][0]
    assert runtime["type"] == "RemoteMCPServer" and runtime["spec"]["url"] == "https://x/mcp"
    assert runtime["auth"] == {"type": "OAuthPluginVault", "reference_id": "ref"}
