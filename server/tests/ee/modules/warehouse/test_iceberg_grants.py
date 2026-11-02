"""Iceberg REST catalog: grant scopes and vended credentials."""

import json
from datetime import datetime, timezone
from unittest.mock import MagicMock, patch

from src.modules.warehouse.iceberg_rest import _allowed, _session_policy, vended_credentials


def test_grant_scope():
    scope = {("org_x_gold", None), ("org_y_gold", "orders")}
    assert _allowed(None, "anything", "t")  # admins
    assert _allowed(scope, "org_x_gold", "customers")
    assert _allowed(scope, "org_y_gold", "orders")
    assert not _allowed(scope, "org_y_gold", "payments")


def test_session_policy_reads_only_the_table_folder():
    policy = _session_policy("lake", "warehouse/org_x_gold/orders/")
    actions = {a for st in policy["Statement"] for a in st["Action"]}
    assert actions == {"s3:GetObject", "s3:ListBucket"}
    assert policy["Statement"][0]["Resource"] == ["arn:aws:s3:::lake/warehouse/org_x_gold/orders/*"]


def test_no_role_or_not_s3_means_no_credentials(monkeypatch):
    monkeypatch.delenv("ICEBERG_VENDED_ROLE_ARN", raising=False)
    assert vended_credentials("s3://lake/t") is None
    monkeypatch.setenv("ICEBERG_VENDED_ROLE_ARN", "arn:aws:iam::1:role/r")
    assert vended_credentials("file:///lake/t") is None


def test_vends_scoped_short_lived_credentials(monkeypatch):
    monkeypatch.setenv("ICEBERG_VENDED_ROLE_ARN", "arn:aws:iam::1:role/r")
    sts = MagicMock()
    sts.assume_role.return_value = {"Credentials": {
        "AccessKeyId": "AK", "SecretAccessKey": "SK", "SessionToken": "TOK",
        "Expiration": datetime(2030, 1, 1, tzinfo=timezone.utc)}}
    with patch("boto3.client", return_value=sts):
        creds = vended_credentials("s3://lake/warehouse/ns/orders")
    assert creds["s3.session-token"] == "TOK" and creds["s3.access-key-id"] == "AK"
    kwargs = sts.assume_role.call_args.kwargs
    assert kwargs["DurationSeconds"] == 900
    assert "warehouse/ns/orders/*" in json.loads(kwargs["Policy"])["Statement"][0]["Resource"][0]
