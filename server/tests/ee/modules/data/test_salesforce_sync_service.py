"""Regression tests for the Salesforce object read-sync (Phase 1).

Covers: SOQL/DDL/upsert SQL construction (no live DB needed), the
Postgres-only target guard, incremental watermark round-tripping, and the
full sync_object() orchestration with every external dependency (OAuth
token, Salesforce HTTP, target DB) mocked.
"""

from datetime import datetime, timezone
from types import SimpleNamespace
from unittest.mock import AsyncMock, patch
from uuid import uuid4

import pytest

from ee.modules.data.services import salesforce_sync_service as sync_svc
from ee.modules.data.services.salesforce_object_schemas import get_object_schema


# ---------------------------------------------------------------------------
# Pure SQL-construction tests -- no DB, no mocks
# ---------------------------------------------------------------------------

def test_build_soql_without_watermark_has_no_where_clause():
    from ee.modules.data.services import salesforce_client

    schema = get_object_schema("Account")
    soql = salesforce_client.build_soql(schema)
    assert soql.startswith("SELECT Id, Name, Industry")
    assert "FROM Account" in soql
    assert "WHERE" not in soql
    assert "ORDER BY SystemModstamp ASC" in soql


def test_build_soql_with_watermark_filters_incrementally():
    from ee.modules.data.services import salesforce_client

    schema = get_object_schema("Opportunity")
    soql = salesforce_client.build_soql(schema, since_watermark="2026-01-01T00:00:00.000Z")
    assert "WHERE SystemModstamp > 2026-01-01T00:00:00.000Z" in soql


def test_create_table_ddl_is_idempotent_and_includes_all_columns():
    schema = get_object_schema("Contact")
    ddl = sync_svc._create_table_ddl(schema)
    assert ddl.startswith("CREATE TABLE IF NOT EXISTS crm_salesforce_contact")
    for f in schema.fields:
        assert f.sql_column in ddl


def test_upsert_sql_builds_one_statement_for_a_batch_with_on_conflict():
    schema = get_object_schema("Lead")
    batch = [
        {"Id": "00Q1", "FirstName": "Ada", "LastName": "Lovelace", "Company": "Analytical Engines",
         "Email": "ada@example.com", "Status": "Open", "LeadSource": "Web",
         "CreatedDate": "2026-01-01T00:00:00Z", "LastModifiedDate": "2026-01-02T00:00:00Z",
         "SystemModstamp": "2026-01-02T00:00:00Z"},
        {"Id": "00Q2", "FirstName": "Alan", "LastName": "Turing", "Company": "Bletchley",
         "Email": "alan@example.com", "Status": "Working", "LeadSource": "Referral",
         "CreatedDate": "2026-01-01T00:00:00Z", "LastModifiedDate": "2026-01-02T00:00:00Z",
         "SystemModstamp": "2026-01-02T00:00:00Z"},
    ]
    sql, params = sync_svc._upsert_sql(schema, batch)
    assert "INSERT INTO crm_salesforce_lead" in sql
    assert "ON CONFLICT (id) DO UPDATE SET" in sql
    assert sql.count("(:id_") == 2  # one VALUES group per record
    assert params["id_0"] == "00Q1"
    assert params["id_1"] == "00Q2"
    assert params["first_name_0"] == "Ada"
    assert params["first_name_1"] == "Alan"
    # "id" itself must never appear in the UPDATE SET assignments (updating the conflict key is meaningless)
    assert "id = EXCLUDED.id" not in sql


def test_upsert_sql_never_string_interpolates_record_values():
    """Record VALUES (attacker-reachable if a Salesforce field were ever
    compromised/malicious) must only ever appear as bound param values, never
    inlined into the SQL text itself."""
    schema = get_object_schema("Account")
    malicious_name = "Robert'); DROP TABLE crm_salesforce_account;--"
    batch = [{"Id": "001x", "Name": malicious_name}]
    sql, params = sync_svc._upsert_sql(schema, batch)
    assert malicious_name not in sql
    assert params["name_0"] == malicious_name


def test_upsert_sql_coerces_salesforce_iso_strings_to_real_datetimes():
    """Live-verified regression: asyncpg rejects an ISO-8601 STRING bound to a
    TIMESTAMPTZ column outright (DataError), unlike drivers that implicitly
    cast. Salesforce's REST API always returns date/datetime fields as JSON
    strings, so every TIMESTAMPTZ/DATE field must be converted before binding."""
    from datetime import date, datetime, timezone

    schema = get_object_schema("Opportunity")
    batch = [{
        "Id": "006x", "AccountId": "001x", "Name": "Big Deal", "StageName": "Negotiation",
        "Amount": 50000, "CloseDate": "2026-03-15", "Probability": 80,
        "IsClosed": False, "IsWon": False,
        "CreatedDate": "2026-01-01T00:00:00.000Z",
        "LastModifiedDate": "2026-01-02T00:00:00.000Z",
        "SystemModstamp": "2026-01-02T00:00:00.000Z",
    }]
    _, params = sync_svc._upsert_sql(schema, batch)
    assert params["close_date_0"] == date(2026, 3, 15)
    assert params["created_date_0"] == datetime(2026, 1, 1, tzinfo=timezone.utc)
    assert params["system_modstamp_0"] == datetime(2026, 1, 2, tzinfo=timezone.utc)
    # Non-temporal fields pass through unconverted.
    assert params["amount_0"] == 50000
    assert params["is_closed_0"] is False


def test_upsert_sql_coerce_handles_null_temporal_fields():
    schema = get_object_schema("Opportunity")
    batch = [{"Id": "006y", "Name": "No close date yet", "CloseDate": None}]
    _, params = sync_svc._upsert_sql(schema, batch)
    assert params["close_date_0"] is None


# ---------------------------------------------------------------------------
# Fake DB session supporting the handful of query shapes sync_object() issues
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
        target_table = froms[0] if froms else None
        table_name = getattr(target_table, "name", None)

        if table_name == DataCDCState.__tablename__:
            return SimpleNamespace(scalar_one_or_none=lambda: self._cdc_state)
        if table_name == DataIngestionJob.__tablename__:
            return SimpleNamespace(scalar_one_or_none=lambda: self._existing_job)
        return SimpleNamespace(scalar_one_or_none=lambda: None)


def _fake_target_data_source(dialect="postgresql"):
    return {
        "id": "target-ds-1",
        "type": "database",
        "db_type": dialect,
        "connection_config": {"type": dialect, "host": "db.internal", "database": "app", "username": "u", "password": "p"},
    }


@pytest.fixture(autouse=True)
def _patch_oauth_token():
    with patch(
        "ee.modules.data.services.oauth_connector_service.get_valid_access_token",
        new=AsyncMock(return_value=("access-token-123", "https://na1.salesforce.com")),
    ):
        yield


# ---------------------------------------------------------------------------
# sync_object orchestration
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_sync_object_rejects_non_postgres_target():
    session = _FakeSession()
    with patch(
        "src.modules.data.services.data_connectivity_service.DataConnectivityService.get_data_source_by_id",
        new=AsyncMock(return_value=_fake_target_data_source(dialect="snowflake")),
    ):
        with pytest.raises(sync_svc.SalesforceSyncError, match="Only Postgres"):
            await sync_svc.sync_object(
                session,
                organization_id=str(uuid4()),
                project_id=None,
                source_connection_id=str(uuid4()),
                target_data_source_id="target-ds-1",
                object_api_name="Account",
            )


@pytest.mark.asyncio
async def test_sync_object_rejects_missing_target():
    session = _FakeSession()
    with patch(
        "src.modules.data.services.data_connectivity_service.DataConnectivityService.get_data_source_by_id",
        new=AsyncMock(return_value=None),
    ):
        with pytest.raises(sync_svc.SalesforceSyncError, match="not found"):
            await sync_svc.sync_object(
                session,
                organization_id=str(uuid4()),
                project_id=None,
                source_connection_id=str(uuid4()),
                target_data_source_id="missing-ds",
                object_api_name="Account",
            )


async def _fake_query_all(instance_url, access_token, soql):
    yield [
        {"Id": "001A", "Name": "Acme Corp", "Industry": "Manufacturing", "AnnualRevenue": 1000000,
         "NumberOfEmployees": 250, "BillingCity": "Springfield", "BillingState": "IL", "BillingCountry": "US",
         "CreatedDate": "2026-01-01T00:00:00Z", "LastModifiedDate": "2026-01-05T00:00:00Z",
         "SystemModstamp": "2026-01-05T00:00:00Z"},
    ]


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
        "ee.modules.data.services.salesforce_client.query_all", new=_fake_query_all
    ):
        result = await sync_svc.sync_object(
            session,
            organization_id=str(uuid4()),
            project_id=None,
            source_connection_id=str(uuid4()),
            target_data_source_id="target-ds-1",
            object_api_name="Account",
        )

    assert result["success"] is True
    assert result["rows_read"] == 1
    assert result["rows_written"] == 1
    assert result["table"] == "crm_salesforce_account"

    # CREATE TABLE ran before any upsert.
    ddl_call = fake_db_connector.execute_query.call_args_list[0]
    assert "CREATE TABLE IF NOT EXISTS crm_salesforce_account" in ddl_call.args[1]
    upsert_call = fake_db_connector.execute_query.call_args_list[1]
    assert "INSERT INTO crm_salesforce_account" in upsert_call.args[1]

    fake_db_connector.close_connection.assert_awaited_once_with("conn-1")

    # A DataIngestionJob row and a DataCDCState watermark row were both persisted.
    from src.modules.data.models import DataCDCState, DataIngestionJob

    job_rows = [o for o in session.added if isinstance(o, DataIngestionJob)]
    cdc_rows = [o for o in session.added if isinstance(o, DataCDCState)]
    assert len(job_rows) == 1
    assert job_rows[0].status == "succeeded"
    assert job_rows[0].rows_written == 1
    assert len(cdc_rows) == 1
    assert cdc_rows[0].high_watermark == {"system_modstamp": "2026-01-05T00:00:00Z"}


@pytest.mark.asyncio
async def test_sync_object_marks_job_failed_and_reraises_on_upsert_error():
    session = _FakeSession()

    fake_db_connector = SimpleNamespace(
        create_connection=AsyncMock(return_value={"success": True, "connection_id": "conn-1"}),
        execute_query=AsyncMock(side_effect=[
            {"success": True},  # CREATE TABLE succeeds
            {"success": False, "error": "constraint violation"},  # upsert fails
        ]),
        close_connection=AsyncMock(return_value={"success": True}),
    )

    with patch(
        "src.modules.data.services.data_connectivity_service.DataConnectivityService.get_data_source_by_id",
        new=AsyncMock(return_value=_fake_target_data_source()),
    ), patch(
        "src.modules.data.services.database_connector_service.DatabaseConnectorService",
        return_value=fake_db_connector,
    ), patch(
        "ee.modules.data.services.salesforce_client.query_all", new=_fake_query_all
    ):
        with pytest.raises(sync_svc.SalesforceSyncError, match="Upsert batch failed"):
            await sync_svc.sync_object(
                session,
                organization_id=str(uuid4()),
                project_id=None,
                source_connection_id=str(uuid4()),
                target_data_source_id="target-ds-1",
                object_api_name="Account",
            )

    from src.modules.data.models import DataIngestionJob

    job_rows = [o for o in session.added if isinstance(o, DataIngestionJob)]
    assert job_rows[0].status == "failed"
    assert "constraint violation" in job_rows[0].error_message
    # Connection must still be closed even though the sync failed.
    fake_db_connector.close_connection.assert_awaited_once_with("conn-1")


@pytest.mark.asyncio
async def test_sync_object_reuses_a_precreated_job_row_instead_of_making_a_new_one():
    """The API endpoint creates the DataIngestionJob row up front (so it can
    return a pollable id before the ARQ job even runs) -- sync_object() must
    update that same row, not silently create a second one."""
    existing_job = SimpleNamespace(
        id=uuid4(), status="queued", rows_read=None, rows_written=None,
        error_message=None, started_at=None, finished_at=None,
        source_snapshot={"vendor": "salesforce", "object": "Account"},
    )
    session = _FakeSession(existing_job=existing_job)

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
        "ee.modules.data.services.salesforce_client.query_all", new=_fake_query_all
    ):
        await sync_svc.sync_object(
            session,
            organization_id=str(uuid4()),
            project_id=None,
            source_connection_id=str(uuid4()),
            target_data_source_id="target-ds-1",
            object_api_name="Account",
            job_id=str(existing_job.id),
        )

    from src.modules.data.models import DataIngestionJob

    assert not any(isinstance(o, DataIngestionJob) for o in session.added)
    assert existing_job.status == "succeeded"
