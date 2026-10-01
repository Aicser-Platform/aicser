"""Cloud warehouses get server-side limits: a timeout that actually cancels the query,
a query tag admins can find, and (BigQuery) a bytes-billed cap enforced before scanning."""

from src.modules.data.services.direct_sql_pool import _timeout_connect_args


def test_snowflake_gets_server_side_timeout_and_tag():
    args = _timeout_connect_args("snowflake://u:p@acct/db/sch?warehouse=wh", 30)
    assert args["session_parameters"]["STATEMENT_TIMEOUT_IN_SECONDS"] == 30
    assert args["session_parameters"]["QUERY_TAG"]


def test_redshift_and_postgres_get_statement_timeout():
    for uri in ("redshift+psycopg2://u:p@h:5439/db", "postgresql://u:p@h/db"):
        assert _timeout_connect_args(uri, 30) == {"options": "-c statement_timeout=30000"}


def test_bigquery_query_uses_bytes_cap_and_source_credentials(monkeypatch):
    import asyncio
    import sys
    import types

    captured = {}

    class _Cfg:
        def __init__(self, **kw):
            self.__dict__.update(kw)

    class _Client:
        def __init__(self, **kw):
            captured["client_kwargs"] = kw

        def query(self, q, job_config=None):
            captured["job_config"] = job_config

            class _Job:
                def result(self_inner):
                    class _R(list):
                        schema = []
                    return _R()
            return _Job()

    fake_bq = types.ModuleType("google.cloud.bigquery")
    fake_bq.Client, fake_bq.QueryJobConfig = _Client, _Cfg
    fake_sa = types.ModuleType("google.oauth2.service_account")
    fake_sa.Credentials = types.SimpleNamespace(from_service_account_info=lambda info: ("creds", info))
    google = types.ModuleType("google")
    cloud = types.ModuleType("google.cloud")
    oauth2 = types.ModuleType("google.oauth2")
    cloud.bigquery, oauth2.service_account = fake_bq, fake_sa
    google.cloud, google.oauth2 = cloud, oauth2
    for name, mod in {"google": google, "google.cloud": cloud, "google.cloud.bigquery": fake_bq,
                      "google.oauth2": oauth2, "google.oauth2.service_account": fake_sa}.items():
        monkeypatch.setitem(sys.modules, name, mod)

    from ee.modules.data.services.enterprise_connectors_service import EnterpriseConnectorsService

    svc = EnterpriseConnectorsService.__new__(EnterpriseConnectorsService)
    cfg = types.SimpleNamespace(database="proj", metadata={"credentials_json": '{"k": 1}'})
    out = asyncio.run(svc._execute_bigquery_query({"config": cfg}, "SELECT 1", None))
    assert out["success"] is True
    assert captured["client_kwargs"]["credentials"] == ("creds", {"k": 1})
    assert captured["job_config"].maximum_bytes_billed > 0
