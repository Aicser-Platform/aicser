"""Regression tests for the HubSpot object read-sync (Phase 1, second vendor).

Mirrors test_salesforce_sync_service.py's coverage. The one HubSpot-specific
addition: coercion tests for the numeric/boolean string types HubSpot
returns that Salesforce's JSON API doesn't need (Salesforce returns typed
JSON for everything except dates; HubSpot returns everything as a string).
"""

from datetime import datetime, timezone
from decimal import Decimal
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from ee.modules.data.services import hubspot_sync_service as sync_svc
from ee.modules.data.services.hubspot_object_schemas import get_object_schema


# ---------------------------------------------------------------------------
# hubspot_client: query construction, flattening, epoch-millis watermark
# ---------------------------------------------------------------------------

def test_flatten_merges_id_and_properties():
    from ee.modules.data.services.hubspot_client import _flatten

    record = {"id": "123", "properties": {"firstname": "Ada", "lastname": "Lovelace"}, "createdAt": "2026-01-01"}
    flat = _flatten(record)
    assert flat == {"id": "123", "firstname": "Ada", "lastname": "Lovelace"}


def test_to_epoch_millis_converts_iso_string():
    from ee.modules.data.services.hubspot_client import _to_epoch_millis

    millis = _to_epoch_millis("2026-01-01T00:00:00.000Z")
    assert millis == str(int(datetime(2026, 1, 1, tzinfo=timezone.utc).timestamp() * 1000))


@pytest.mark.asyncio
async def test_query_all_sends_property_list_and_watermark_filter():
    from ee.modules.data.services import hubspot_client

    schema = get_object_schema("deals")
    fake_resp = SimpleNamespace(status_code=200, json=lambda: {"results": [], "paging": {}})
    with patch("httpx.AsyncClient.post", new=AsyncMock(return_value=fake_resp)) as mock_post:
        async for _ in hubspot_client.query_all("tok", schema, since_watermark="2026-01-01T00:00:00.000Z"):
            pass

    call = mock_post.call_args
    assert call.args[0] == "https://api.hubapi.com/crm/v3/objects/deals/search"
    body = call.kwargs["json"]
    assert "dealname" in body["properties"]
    assert body["filterGroups"][0]["filters"][0]["propertyName"] == "hs_lastmodifieddate"
    assert body["filterGroups"][0]["filters"][0]["operator"] == "GT"


@pytest.mark.asyncio
async def test_query_all_follows_pagination_cursor():
    from ee.modules.data.services import hubspot_client

    schema = get_object_schema("contacts")
    responses = [
        SimpleNamespace(status_code=200, json=lambda: {
            "results": [{"id": "1", "properties": {"firstname": "Ada"}}],
            "paging": {"next": {"after": "cursor-1"}},
        }),
        SimpleNamespace(status_code=200, json=lambda: {
            "results": [{"id": "2", "properties": {"firstname": "Alan"}}],
            "paging": {},
        }),
    ]
    with patch("httpx.AsyncClient.post", new=AsyncMock(side_effect=responses)) as mock_post:
        pages = [page async for page in hubspot_client.query_all("tok", schema)]

    assert len(pages) == 2
    assert pages[0][0]["id"] == "1"
    assert pages[1][0]["id"] == "2"
    assert mock_post.call_args_list[1].kwargs["json"]["after"] == "cursor-1"


# ---------------------------------------------------------------------------
# Value coercion: HubSpot returns everything as a string
# ---------------------------------------------------------------------------

def test_coerce_value_numeric_string_to_decimal():
    assert sync_svc._coerce_value("50000", "NUMERIC") == Decimal("50000")


def test_coerce_value_integer_string():
    assert sync_svc._coerce_value("250", "INTEGER") == 250
    assert sync_svc._coerce_value("250.0", "INTEGER") == 250  # HubSpot sometimes sends "250.0"


def test_coerce_value_boolean_strings():
    assert sync_svc._coerce_value("true", "BOOLEAN") is True
    assert sync_svc._coerce_value("false", "BOOLEAN") is False
    assert sync_svc._coerce_value("True", "BOOLEAN") is True  # case-insensitive


def test_coerce_value_timestamptz_string():
    result = sync_svc._coerce_value("2026-01-02T00:00:00.000Z", "TIMESTAMPTZ")
    assert result == datetime(2026, 1, 2, tzinfo=timezone.utc)


def test_coerce_value_null_and_empty_string_become_none():
    assert sync_svc._coerce_value(None, "NUMERIC") is None
    assert sync_svc._coerce_value("", "TEXT") is None


def test_coerce_value_text_passes_through():
    assert sync_svc._coerce_value("Acme Corp", "TEXT") == "Acme Corp"


def test_coerce_value_malformed_numeric_string_returns_none_not_raise():
    """A malformed value must degrade to NULL, never crash the whole sync."""
    assert sync_svc._coerce_value("not-a-number", "NUMERIC") is None


# ---------------------------------------------------------------------------
# _upsert_sql / _create_table_ddl
# ---------------------------------------------------------------------------

def test_create_table_ddl_uses_hubspot_table_prefix():
    schema = get_object_schema("deals")
    ddl = sync_svc._create_table_ddl(schema)
    assert ddl.startswith("CREATE TABLE IF NOT EXISTS crm_hubspot_deal")


def test_upsert_sql_coerces_string_typed_properties():
    schema = get_object_schema("deals")
    batch = [{
        "id": "1", "dealname": "Big Deal", "dealstage": "negotiation",
        "amount": "75000", "closedate": "2026-03-15T00:00:00.000Z", "pipeline": "default",
        "hs_is_closed": "false", "hs_is_closed_won": "false",
        "createdate": "2026-01-01T00:00:00.000Z", "hs_lastmodifieddate": "2026-01-02T00:00:00.000Z",
    }]
    _, params = sync_svc._upsert_sql(schema, batch)
    assert params["amount_0"] == Decimal("75000")
    assert params["is_closed_0"] is False
    assert params["close_date_0"] == datetime(2026, 3, 15, tzinfo=timezone.utc)


def test_upsert_sql_never_string_interpolates_record_values():
    schema = get_object_schema("companies")
    malicious = "Robert'); DROP TABLE crm_hubspot_company;--"
    batch = [{"id": "1", "name": malicious}]
    sql, params = sync_svc._upsert_sql(schema, batch)
    assert malicious not in sql
    assert params["name_0"] == malicious


# ---------------------------------------------------------------------------
# sync_object orchestration (same shape as Salesforce's tests)
# ---------------------------------------------------------------------------

class _FakeSession:
    def __init__(self, *, cdc_state=None, existing_job=None):
        self.added = []
        self.commits = 0
        self._cdc_state = cdc_state
        self._existing_job = existing_job

    def add(self, obj):
        self.added.append(obj)

    async def commit(self):
        self.commits += 1

    async def refresh(self, obj):
        if getattr(obj, "id", None) is None:
            obj.id = uuid4()

    async def execute(self, stmt):
        from src.modules.data.models import DataCDCState, DataIngestionJob

        froms = stmt.get_final_froms() if hasattr(stmt, "get_final_froms") else []
        table_name = getattr(froms[0], "name", None) if froms else None
        if table_name == DataCDCState.__tablename__:
            return SimpleNamespace(scalar_one_or_none=lambda: self._cdc_state)
        if table_name == DataIngestionJob.__tablename__:
            return SimpleNamespace(scalar_one_or_none=lambda: self._existing_job)
        return SimpleNamespace(scalar_one_or_none=lambda: None)


def _fake_target_data_source(dialect="postgresql"):
    return {
        "id": "target-ds-1", "type": "database", "db_type": dialect,
        "connection_config": {"type": dialect, "host": "db.internal", "database": "app", "username": "u", "password": "p"},
    }


@pytest.fixture(autouse=True)
def _patch_oauth_token():
    with patch(
        "ee.modules.data.services.oauth_connector_service.get_valid_access_token",
        new=AsyncMock(return_value=("access-token-123", "https://api.hubapi.com")),
    ):
        yield


async def _fake_query_all(access_token, schema, since_watermark=None):
    yield [{
        "id": "1", "dealname": "Acme Deal", "dealstage": "closedwon", "amount": "50000",
        "closedate": "2026-01-05T00:00:00.000Z", "pipeline": "default",
        "hs_is_closed": "true", "hs_is_closed_won": "true",
        "createdate": "2026-01-01T00:00:00.000Z", "hs_lastmodifieddate": "2026-01-05T00:00:00.000Z",
    }]


@pytest.mark.asyncio
async def test_sync_object_rejects_non_postgres_target():
    session = _FakeSession()
    with patch(
        "src.modules.data.services.data_connectivity_service.DataConnectivityService.get_data_source_by_id",
        new=AsyncMock(return_value=_fake_target_data_source(dialect="mysql")),
    ):
        with pytest.raises(sync_svc.HubSpotSyncError, match="Only Postgres"):
            await sync_svc.sync_object(
                session, organization_id=str(uuid4()), project_id=None,
                source_connection_id=str(uuid4()), target_data_source_id="target-ds-1",
                object_api_name="deals",
            )


@pytest.mark.asyncio
async def test_sync_object_happy_path_creates_table_and_upserts_and_marks_succeeded():
    session = _FakeSession()
    fake_db_connector = SimpleNamespace(
        create_connection=AsyncMock(return_value={"success": True, "connection_id": "conn-1"}),
        execute_query=AsyncMock(return_value={"success": True}),
        close_connection=AsyncMock(return_value={"success": True}),
    )
    with patch(
        "src.modules.data.services.data_connectivity_service.DataConnectivityService.get_data_source_by_id",
        new=AsyncMock(return_value=_fake_target_data_source()),
    ), patch(
        "src.modules.data.services.database_connector_service.DatabaseConnectorService",
        return_value=fake_db_connector,
    ), patch(
        "ee.modules.data.services.hubspot_client.query_all", new=_fake_query_all
    ):
        result = await sync_svc.sync_object(
            session, organization_id=str(uuid4()), project_id=None,
            source_connection_id=str(uuid4()), target_data_source_id="target-ds-1",
            object_api_name="deals",
        )

    assert result["success"] is True
    assert result["rows_written"] == 1
    assert result["table"] == "crm_hubspot_deal"

    ddl_call = fake_db_connector.execute_query.call_args_list[0]
    assert "CREATE TABLE IF NOT EXISTS crm_hubspot_deal" in ddl_call.args[1]

    from src.modules.data.models import DataCDCState, DataIngestionJob
    job_rows = [o for o in session.added if isinstance(o, DataIngestionJob)]
    cdc_rows = [o for o in session.added if isinstance(o, DataCDCState)]
    assert job_rows[0].status == "succeeded"
    assert cdc_rows[0].high_watermark == {"hs_last_modified_date": "2026-01-05T00:00:00.000Z"}


@pytest.mark.asyncio
async def test_sync_object_marks_job_failed_on_upsert_error():
    session = _FakeSession()
    fake_db_connector = SimpleNamespace(
        create_connection=AsyncMock(return_value={"success": True, "connection_id": "conn-1"}),
        execute_query=AsyncMock(side_effect=[{"success": True}, {"success": False, "error": "constraint violation"}]),
        close_connection=AsyncMock(return_value={"success": True}),
    )
    with patch(
        "src.modules.data.services.data_connectivity_service.DataConnectivityService.get_data_source_by_id",
        new=AsyncMock(return_value=_fake_target_data_source()),
    ), patch(
        "src.modules.data.services.database_connector_service.DatabaseConnectorService",
        return_value=fake_db_connector,
    ), patch(
        "ee.modules.data.services.hubspot_client.query_all", new=_fake_query_all
    ):
        with pytest.raises(sync_svc.HubSpotSyncError, match="Upsert batch failed"):
            await sync_svc.sync_object(
                session, organization_id=str(uuid4()), project_id=None,
                source_connection_id=str(uuid4()), target_data_source_id="target-ds-1",
                object_api_name="deals",
            )
    fake_db_connector.close_connection.assert_awaited_once_with("conn-1")
