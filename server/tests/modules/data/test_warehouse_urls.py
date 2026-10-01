"""Warehouse URLs: each engine's saved settings become the SQLAlchemy URL used by the connection
test, schema discovery and queries; a missing setting is named for the user."""

import json

import pytest
import sqlalchemy as sa

from src.modules.data.services import warehouse_urls as W


def test_databricks_url_carries_http_path_catalog_and_schema():
    url = W.build_url("databricks", {"host": "https://adb-1.azuredatabricks.net/", "token": "dapi x",
                                     "http_path": "/sql/1.0/warehouses/abc", "catalog": "main", "schema": "sales"})
    assert url.startswith("databricks://token:dapi+x@adb-1.azuredatabricks.net?")
    assert "http_path=%2Fsql%2F1.0%2Fwarehouses%2Fabc" in url and "catalog=main" in url and "schema=sales" in url


def test_oracle_uses_service_name_and_thin_driver():
    url = W.build_url("oracle", {"host": "db.local", "username": "scott", "password": "p@ss", "service_name": "ORCLPDB1"})
    assert url == "oracle+oracledb://scott:p%40ss@db.local:1521/?service_name=ORCLPDB1"
    assert W.ping_sql("oracle") == "SELECT 1 FROM DUAL"


def test_trino_catalog_schema_and_plain_http_when_tls_is_off():
    url = W.build_url("trino", {"host": "trino", "port": 8080, "username": "ana", "catalog": "hive",
                                "schema": "web", "ssl_mode": "disable"})
    assert url == "trino://ana@trino:8080/hive/web?http_scheme=http"


def test_athena_uses_region_and_result_location_and_allows_an_iam_role():
    url = W.build_url("athena", {"region": "ap-southeast-1", "s3_staging_dir": "s3://bucket/results/", "schema": "logs"})
    assert url.startswith("awsathena+rest://@athena.ap-southeast-1.amazonaws.com:443/logs?")
    assert "s3_staging_dir=s3%3A%2F%2Fbucket%2Fresults%2F" in url


def test_settings_nested_in_custom_fields_are_read():
    url = W.build_url("oracle", {"host": "h", "custom_fields": {"service_name": "XE"}})
    assert url.endswith("service_name=XE")


@pytest.mark.parametrize(
    "db_type,cfg,needs",
    [
        ("databricks", {"host": "h", "token": "t"}, "HTTP path"),
        ("oracle", {"host": "h"}, "service name"),
        ("trino", {"host": "h"}, "catalog"),
        ("athena", {"region": "eu-west-1"}, "S3 location"),
        ("bigquery", {}, "project id"),
    ],
)
def test_missing_settings_are_named(db_type, cfg, needs):
    with pytest.raises(ValueError, match=needs):
        W.build_url(db_type, cfg)


def test_bigquery_key_is_passed_as_credentials_not_in_the_url():
    key = {"type": "service_account", "project_id": "p"}
    assert W.build_url("bigquery", {"project_id": "p", "dataset": "d"}) == "bigquery://p/d"
    assert W.engine_kwargs("bigquery", {"credentials_json": json.dumps(key)}) == {"credentials_info": key}
    with pytest.raises(ValueError, match="not valid JSON"):
        W.engine_kwargs("bigquery", {"credentials_json": "{oops"})


@pytest.mark.parametrize("db_type,cfg", [
    ("databricks", {"host": "h", "token": "t", "http_path": "/p"}),
    ("oracle", {"host": "h", "service_name": "XE"}),
    ("trino", {"host": "h", "catalog": "c"}),
    ("athena", {"region": "us-east-1", "s3_staging_dir": "s3://b/"}),
    ("snowflake", {"host": "acct", "username": "u", "password": "p", "database": "DB"}),
    ("bigquery", {"project_id": "p"}),
    ("redshift", {"host": "h", "database": "dev", "username": "u", "password": "p"}),
])
def test_every_engine_has_an_installed_sqlalchemy_dialect(db_type, cfg):
    # A missing dialect package was why Snowflake / BigQuery / Redshift charts failed.
    sa.engine.url.make_url(W.build_url(db_type, cfg)).get_dialect()


def test_warehouse_secrets_are_encrypted_at_rest_and_masked(monkeypatch):
    from cryptography.fernet import Fernet

    from src.modules.data.utils import credentials as C
    from src.modules.data.utils.masking import mask_connection_info

    monkeypatch.setenv("ENCRYPTION_KEY", Fernet.generate_key().decode())
    monkeypatch.setattr(C, "_FERNET", None, raising=False)
    key = '{"type": "service_account", "private_key": "-----BEGIN PRIVATE KEY-----abc"}'
    uri = "snowflake://ana:s3cret@acct/DB"
    stored = C.encrypt_credentials({"credentials_json": key, "uri": uri, "project_id": "p"})
    assert stored["credentials_json"] != key and stored["uri"] != uri and stored["project_id"] == "p"
    back = C.decrypt_credentials(stored)
    assert back["credentials_json"] == key and back["uri"] == uri
    shown = mask_connection_info({"credentials_json": key, "uri": uri})
    assert "PRIVATE KEY" not in shown["credentials_json"] and "s3cret" not in shown["uri"]
