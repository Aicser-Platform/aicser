import io
import json
import urllib.error
from unittest import mock

import pytest

from aicser_embed import AicserSignError, sign_embed_url


class _Response(io.BytesIO):
    status = 200

    def __enter__(self):
        return self

    def __exit__(self, *exc):
        return False


def test_signs_with_key_and_filters():
    seen = {}

    def fake_urlopen(request, timeout):
        seen["url"] = request.full_url
        seen["auth"] = request.get_header("Authorization")
        seen["body"] = json.loads(request.data)
        return _Response(json.dumps({"url": "https://app/embed/dashboard/d?token=t", "token": "t", "expires_at": "2026-09-26T10:00:00Z"}).encode())

    with mock.patch("urllib.request.urlopen", fake_urlopen):
        embed = sign_embed_url(
            base_url="https://api.example.com/",
            api_key="aiser_sk_test",
            dashboard_id="d",
            locked_filters=[{"field": "tenant_id", "value": "acme"}],
            download="image",
        )
    assert embed.token == "t" and embed.url.endswith("token=t")
    assert seen["url"] == "https://api.example.com/api/embed/sign"
    assert seen["auth"] == "Bearer aiser_sk_test"
    assert seen["body"]["locked_filters"] == [{"field": "tenant_id", "value": "acme"}]
    assert seen["body"]["download"] == "image"
    assert seen["body"]["expires_in_minutes"] == 60
    assert seen["body"]["scope"] == "dashboard"
    assert seen["body"]["resource_id"] == "d"


def test_signs_report_with_scope_and_resource_id():
    seen = {}

    def fake_urlopen(request, timeout):
        seen["body"] = json.loads(request.data)
        return _Response(
            json.dumps(
                {
                    "url": "https://app/embed/report/c:m?token=t",
                    "token": "t",
                    "expires_at": "2026-09-26T10:00:00Z",
                }
            ).encode()
        )

    with mock.patch("urllib.request.urlopen", fake_urlopen):
        embed = sign_embed_url(
            base_url="https://api.example.com",
            api_key="aiser_sk_test",
            resource_id="c:m",
            scope="report",
        )
    assert embed.token == "t"
    assert seen["body"]["resource_id"] == "c:m"
    assert seen["body"]["scope"] == "report"


def test_refusal_carries_server_message():
    error = urllib.error.HTTPError(
        "https://api/api/embed/sign", 402, "Payment Required", {},
        io.BytesIO(json.dumps({"detail": {"message": "Embed analytics requires the Pro plan"}}).encode()),
    )
    with mock.patch("urllib.request.urlopen", side_effect=error):
        with pytest.raises(AicserSignError) as caught:
            sign_embed_url(base_url="https://api", api_key="k", dashboard_id="d")
    assert caught.value.status == 402
    assert "Pro plan" in str(caught.value)
