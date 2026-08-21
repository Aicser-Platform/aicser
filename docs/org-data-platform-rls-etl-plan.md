# Organization Data Platform, RLS, and ETL Plan

## Goal

Aicser should move from project-owned data sources to an organization-owned data platform:

```text
Organization
  Connections
  Data Assets
  Access Grants
  RLS and Masking Policies
  Pipelines

Projects
  Dashboards
  Chats
  Reports
  Granted Data
```

Projects consume data. They should not own data connections or raw assets.

## Core Principles

- Organization owns connections, files, Bronze/Silver/Gold assets, and semantic models.
- Projects, users, groups, and roles receive explicit grants to use data.
- No grant means no access.
- Policy resolution failure means deny, not fallback to full access.
- Backend enforcement is mandatory; frontend guards are only user experience.
- Every query path must pass through one governed query gateway.
- Credentials and raw files must never be exposed to the browser.
- All sensitive actions must be auditable.

## Target Concepts

### Data Connection

A connection stores credentials and connector configuration.

Examples:

- PostgreSQL connection
- Snowflake connection
- S3 bucket connection
- BigQuery service account
- Kafka source

### Data Asset

A data asset is something queryable or usable by analytics.

Examples:

- Uploaded CSV or Excel sheet
- External database table
- Bronze table
- Silver table
- Gold table
- Semantic model
- Metric view

### Access Grant

An access grant defines who can use an asset.

Grant targets:

- project
- user
- group
- organization role
- project role

Grant permissions:

- view
- query
- edit
- manage
- share

### RLS Policy

An RLS policy defines row-level filters applied when querying an asset.

Example:

```text
sales.region IN current_user.allowed_regions
```

RLS must be applied to SQL editor, dashboards, AI-generated SQL, semantic queries, exports, previews, and future ETL previews.

## Phase 1: Org-Owned Data Sources

First, adapt the current `data_sources` model without breaking existing project flows.

Implementation:

- Add nullable `organization_id` to `data_sources`.
- Backfill from `data_sources.project_id -> projects.organization_id` when projects exist.
- Keep `project_id` temporarily for backward compatibility.
- Add `data_source_access_grants`.
- Create project grants from existing `data_sources.project_id`.

Migration rule:

```text
existing data_sources.project_id
=> grant that project view/query/edit/manage
```

## Phase 2: Backend Access Service

Create a central service:

```text
DataSourceAccessService
  can_view(user_id, data_source_id, project_id?)
  can_query(user_id, data_source_id, project_id?)
  can_edit(user_id, data_source_id)
  can_manage(user_id, data_source_id)
  list_accessible_sources(user_id, organization_id, project_id?)
```

Use it before:

- listing data sources
- reading data source details
- testing connections
- decrypting credentials
- querying rows
- updating or deleting data sources
- exporting data
- dashboard queries
- AI analysis
- schema preview

## Phase 3: First-Class RLS

Move policy out of `connection_config`.

Tables:

```text
data_source_rls_policies
data_source_rls_rules
```

MVP operators:

```text
eq
in
not_in
between
is_null
is_not_null
```

MVP value sources:

```text
fixed
user_attribute
group_attribute
org_attribute
project_attribute
```

## Phase 4: Governed Query Gateway

All query execution should follow the same flow:

```text
Authenticate user
Resolve organization and optional project context
Verify data source or asset grant
Resolve RLS and masking policies
Compile safe SQL or query plan
Execute
Audit
```

This gateway must be used by:

- SQL editor
- dashboards
- AI-generated SQL
- semantic layer
- exports
- previews
- materialized views
- snapshots
- ETL previews

## Phase 5: Future Data Platform Model

After current data source access is stable, introduce:

```text
data_connections
data_assets
pipelines
pipeline_runs
pipeline_checkpoints
```

Suggested `data_assets` fields:

```text
id
organization_id
connection_id
asset_type
layer
storage_type
storage_uri
schema
parent_asset_id
```

Suggested layers:

```text
source
bronze
silver
gold
semantic
```

## Bronze Ingestion

### CSV and Excel

Flow:

```text
Upload original file
Store private raw copy
Infer schema
Convert to Parquet
Register Bronze asset
Grant access
```

For Excel, each sheet should become a child asset or one Bronze table per sheet.

### Database

MVP:

```text
Database table
Full load
Parquet Bronze asset
Manual or scheduled refresh
```

Later:

```text
Incremental load by timestamp/id checkpoint
CDC by WAL/binlog/source offset
```

CDC Bronze records should include:

```text
_op
_source_offset
_source_event_at
_ingested_at
_source_table
```

## S3 Layout

Use organization-isolated storage paths:

```text
s3://bucket/orgs/{organization_id}/raw/uploads/{upload_id}/original.csv
s3://bucket/orgs/{organization_id}/bronze/assets/{asset_id}/load_id={run_id}/part-000.parquet
s3://bucket/orgs/{organization_id}/silver/assets/{asset_id}/...
s3://bucket/orgs/{organization_id}/gold/assets/{asset_id}/...
s3://bucket/orgs/{organization_id}/semantic/{semantic_model_id}/...
```

Do not store governed assets under project paths.

## Security Requirements

- Encrypt credentials before storage.
- Never return raw `connection_config` to clients.
- Store raw files and lake assets in private org-scoped paths.
- Grant asset access explicitly.
- Default new assets to creator plus org admin/owner only.
- Apply RLS and masking in backend query execution.
- Use read-only source database credentials where possible.
- Audit query, export, credential, grant, policy, and pipeline actions.
- Clear frontend caches on organization/project switch.

## Frontend Direction

Add organization-level data navigation:

```text
Org Data
  Connections
  Data Assets
  Pipelines
  Semantic Layer
  Policies
```

Project pages should show:

```text
Granted Data
Dashboards
Chats
Reports
```

Data source or asset detail tabs:

```text
Overview
Connection
Access
RLS
Lineage
Usage
Pipeline Runs
```

## Recommended Build Order

1. Add `organization_id` to `data_sources`.
2. Add `data_source_access_grants`.
3. Backfill project grants.
4. Build `DataSourceAccessService`.
5. Update current data source APIs.
6. Add tests for access isolation.
7. Add RLS policy tables.
8. Apply RLS in query execution.
9. Add frontend Access/RLS management UI.
10. Add `data_connections` and `data_assets`.
11. Add Bronze file/database ingestion.
12. Add scheduling.
13. Add Silver/Gold pipelines.
14. Add semantic layer over Gold assets.
