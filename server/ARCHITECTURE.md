# Data Source Architecture

## Overview

The data source management system uses direct SQLAlchemy connections to databases, with no middleware or query optimization layer. This architecture was simplified by removing the non-functional Cube.js integration.

## Architecture Diagram

```
┌─────────────────────────────────────────────────────────────────┐
│                         Client Layer                             │
│  (React/Next.js - DataSourceManager, UniversalDataSourceModal)  │
└────────────────────────────┬────────────────────────────────────┘
                             │ REST API
                             ▼
┌─────────────────────────────────────────────────────────────────┐
│                         API Layer                                │
│              (FastAPI - app/modules/data/api.py)                │
└────────────────────────────┬────────────────────────────────────┘
                             │
            ┌────────────────┴────────────────┐
            ▼                                 ▼
┌──────────────────────────┐    ┌───────────────────────────────┐
│ DataConnectivityService  │    │  DatabaseConnectorService     │
│  - File uploads          │    │  - Connection testing         │
│  - Connection mgmt       │    │  - Schema introspection       │
│  - Orchestration         │    │  - Query execution            │
└────────┬─────────────────┘    │  - Connection pooling         │
         │                      └────────────┬──────────────────┘
         │                                   │
         ▼                                   ▼
┌─────────────────────┐         ┌──────────────────────────────┐
│   PostgreSQL DB     │         │    External Databases        │
│ - data_sources      │         │  - PostgreSQL (asyncpg)      │
│ - data_queries      │         │  - MySQL (aiomysql)          │
│ - Encrypted creds   │         │  - ClickHouse (HTTP API)     │
└─────────────────────┘         │  - SQL Server (aioodbc)      │
                                │  - Snowflake (native)        │
                                │  - BigQuery (SDK)            │
                                │  - Redshift (asyncpg)        │
                                └──────────────────────────────┘
```

## Core Services

### 1. DatabaseConnectorService

**Location:** `app/modules/data/services/database_connector_service.py`  
**Purpose:** Unified service for all database operations  
**Lines:** ~750

**Key Features:**
- Direct SQLAlchemy connections for all database types
- Connection pooling (5-10 connections per pool)
- Schema introspection using SQLAlchemy Inspector
- ClickHouse HTTP API support (no SQLAlchemy driver needed)
- Async/await pattern for all operations

**Supported Databases:**

| Database | Driver | Port | Connection Type |
|----------|--------|------|----------------|
| PostgreSQL | asyncpg | 5432 | SQLAlchemy async |
| MySQL | aiomysql | 3306 | SQLAlchemy async |
| ClickHouse | HTTP API | 8123 | Direct HTTP (aiohttp) |
| SQL Server | aioodbc | 1433 | SQLAlchemy async |
| Snowflake | snowflake-connector | 443 | Direct driver |
| BigQuery | google-cloud SDK | - | Cloud SDK |
| Redshift | asyncpg | 5439 | SQLAlchemy async |

**Methods:**
- `test_connection(config)` - Test database connectivity
- `create_connection(config)` - Create and cache connection engine
- `get_schema(config)` - Retrieve database schema
- `execute_query(connection_id, query)` - Execute SQL query
- `close_connection(connection_id)` - Close and cleanup connection

### 2. DataConnectivityService

**Location:** `app/modules/data/services/data_connectivity_service.py`  
**Purpose:** Orchestrator for file uploads and database connections  
**Lines:** ~2700 (reduced from ~2850)

**Key Features:**
- File upload handling (CSV, Excel, JSON, Parquet)
- Database connection orchestration
- Schema management
- Data source CRUD operations
- Integration with DatabaseConnectorService

**Methods:**
- `test_database_connection(config)` - Test before storing
- `store_database_connection(config)` - Store with encryption
- `get_database_schema(source_id)` - Retrieve schema
- `upload_file(file)` - Handle file uploads
- `get_supported_databases()` - List supported database types

### 3. CredentialManager

**Location:** `app/modules/data/utils/credentials.py`  
**Purpose:** Centralized credential encryption/decryption  
**Lines:** ~80

**Key Features:**
- Fernet encryption using `ENCRYPTION_KEY` env var
- Automatic encryption of sensitive fields (password, api_key, token, etc.)
- Marker fields (`__enc_*`) to track encrypted data
- Graceful fallback when encryption key not available

**Functions:**
- `encrypt_credentials(config)` - Encrypt sensitive fields
- `decrypt_credentials(config)` - Decrypt sensitive fields

## Data Models

### DataSource Model

**Table:** `data_sources`  
**Purpose:** Unified model for both file and database sources

**Key Fields:**
- `id` (String, PK) - Unique identifier
- `name` (String) - Display name
- `type` (String) - 'file' or 'database'
- `format` (String) - For files: 'csv', 'xlsx', etc.
- `db_type` (String) - For databases: 'postgresql', 'mysql', etc.
- `schema` (JSON) - Schema information (tables, columns)
- `connection_config` (JSON) - Encrypted connection details
- `file_path` (String) - For file sources
- `user_id` (String) - Owner
- `tenant_id` (String) - Multi-tenancy support
- `is_active` (Boolean) - Soft delete flag

### DataQuery Model

**Table:** `data_queries`  
**Purpose:** Query history and analytics

**Key Fields:**
- `data_source_id` (String) - Related data source
- `natural_language_query` (Text) - User's question
- `query_config` (JSON) - Filters, sorting, etc.
- `result_count` (Integer) - Rows returned
- `execution_time_ms` (Integer) - Performance metric

## Connection Flow

### 1. Test Connection

```
User → Client → API → DataConnectivityService → DatabaseConnectorService
                                                         │
                                                         ▼
                                              Direct driver test
                                              (psycopg2, pymysql, etc.)
                                                         │
                                                         ▼
                                              Return success/failure
```

### 2. Store Connection

```
User → Client → API → DataConnectivityService
                              │
                              ├─→ Test connection (DatabaseConnectorService)
                              │
                              ├─→ Encrypt credentials (CredentialManager)
                              │
                              ├─→ Store in PostgreSQL (data_sources table)
                              │
                              └─→ Create engine (DatabaseConnectorService)
```

### 3. Get Schema

```
User → Client → API → DataConnectivityService
                              │
                              ├─→ Get data source from DB
                              │
                              ├─→ Decrypt credentials
                              │
                              └─→ DatabaseConnectorService.get_schema()
                                           │
                                           ├─→ ClickHouse: HTTP API
                                           │
                                           └─→ Others: SQLAlchemy Inspector
```

### 4. Execute Query

```
User → Client → API → DatabaseConnectorService
                              │
                              ├─→ Get cached engine
                              │
                              ├─→ Execute query (async)
                              │
                              └─→ Return results
```

## Schema Storage

**Single Source of Truth:** PostgreSQL `data_sources.schema` column (JSON)

**Schema Structure:**
```json
{
  "tables": [
    {
      "schema": "public",
      "name": "users",
      "columns": [
        {
          "name": "id",
          "type": "INTEGER",
          "nullable": false,
          "primary_key": true
        },
        {
          "name": "email",
          "type": "VARCHAR(255)",
          "nullable": false
        }
      ],
      "rowCount": 1000
    }
  ],
  "schemas": ["public"],
  "total_rows": 1000,
  "last_updated": "2025-01-17T12:00:00Z"
}
```

**Schema Retrieval:**
- **Live:** Use SQLAlchemy Inspector to fetch current schema
- **Cached:** Fall back to stored schema if live fetch fails
- **ClickHouse:** Use HTTP API with JSON format

## Security

### Credential Encryption

1. **Encryption Key:** Set `ENCRYPTION_KEY` environment variable (Fernet key)
2. **Sensitive Fields:** password, api_key, token, secret_access_key, connection_string, credentials
3. **Marker Fields:** `__enc_*` flags indicate encrypted fields
4. **Decryption:** Automatic when credentials needed for connections

**Example:**
```python
# Before encryption
{
  "type": "postgresql",
  "host": "localhost",
  "password": "secret123"
}

# After encryption
{
  "type": "postgresql",
  "host": "localhost",
  "password": "gAAAAABg...",  # Encrypted
  "__enc_password": true       # Marker
}
```

### Connection Security

- **SSL Support:** All database types support SSL/TLS
- **Connection Pooling:** Limits concurrent connections
- **Credential Storage:** Never stored in plaintext
- **API Authentication:** JWT tokens required for all endpoints

## Performance Optimizations

### 1. Connection Pooling

```python
engine = create_async_engine(
    connection_string,
    poolclass=QueuePool,
    pool_size=5,           # Base pool size
    max_overflow=10,        # Additional connections
    pool_pre_ping=True,     # Test connections before use
    pool_recycle=3600       # Recycle after 1 hour
)
```

### 2. Schema Caching

- Schemas cached in PostgreSQL
- Live fetch only when explicitly requested
- Reduces load on external databases

### 3. Async/Await

- All database operations use async/await
- Non-blocking I/O for better concurrency
- Supports thousands of concurrent users

### 4. ClickHouse HTTP API

- No SQLAlchemy driver overhead
- Direct HTTP requests with JSON format
- Faster for ClickHouse-specific features

## Removed Components

The following Cube.js-related components were removed:

### Deleted Services (~3500 lines)
- `cube_connector_service.py` (662 lines)
- `real_cube_integration_service.py` (1069 lines)
- `cube_integration_service.py` (823 lines)
- `cube_data_modeling_service.py` (~500 lines)
- `yaml_schema_service.py` (~200 lines)

### Deleted Directories
- `cube_helpers/` - Placeholder Cube.js directory
- `cube_schemas/` - YAML schema files

### Deprecated Endpoints
All Cube.js endpoints now return 501 Not Implemented:
- `/api/data/cube/*`
- `/api/data/cube-modeling/*`

### Removed Models
- `DataConnection` - Duplicate of DataSource

## Migration Notes

### Before (With Cube.js)

```python
# Old approach - relied on non-existent Cube.js
test_result = await cube_connector.test_connection(config)
schema = await cube_connector.get_database_schema(config)
```

### After (Direct SQLAlchemy)

```python
# New approach - direct database connections
test_result = await database_connector.test_connection(config)
schema = await database_connector.get_schema(config)
```

## API Endpoints

### Working Endpoints

| Method | Endpoint | Purpose |
|--------|----------|---------|
| POST | `/api/data/database/test` | Test database connection |
| POST | `/api/data/database/connect` | Store database connection |
| GET | `/api/data/sources` | List all data sources |
| GET | `/api/data/sources/{id}` | Get specific data source |
| GET | `/api/data/sources/{id}/schema` | Get database schema |
| POST | `/api/data/upload` | Upload file |
| DELETE | `/api/data/sources/{id}` | Delete data source |

### Deprecated Endpoints (501 Not Implemented)

All `/api/data/cube/*` and `/api/data/cube-modeling/*` endpoints

## Environment Variables

```bash
# Required
DATABASE_URL=postgresql+asyncpg://user:pass@localhost:5432/db
ENCRYPTION_KEY=your-base64-encoded-fernet-key

# Optional
CLICKHOUSE_HOST=localhost
CLICKHOUSE_PORT=8123
CLICKHOUSE_USER=default
CLICKHOUSE_PASSWORD=password
CLICKHOUSE_DB=default
```

## Error Handling

### Connection Errors

```python
{
  "success": false,
  "error": "Connection failed: Could not connect to server"
}
```

### Schema Retrieval Errors

```python
{
  "success": true,
  "schema": {...},  # Cached schema
  "warning": "Using cached schema - live fetch failed"
}
```

### Unsupported Database

```python
{
  "success": false,
  "error": "Unsupported database type: mongodb. Supported: [...]"
}
```

## Logging

All operations are logged with emoji indicators:

- 🔌 Connection operations
- 🧪 Connection tests
- ✅ Success operations
- ❌ Error operations
- ⚠️ Warning operations
- 🔍 Query/schema operations
- 💾 Storage operations

**Example:**
```
INFO: 🔌 Testing postgresql connection to localhost
INFO: ✅ postgresql connection test successful
INFO: 💾 Storing database connection: postgresql
INFO: ✅ Credentials encrypted for postgresql connection
```

## Future Enhancements

1. **Query Builder UI** - Visual query construction
2. **Connection Health Monitoring** - Periodic connection tests
3. **Query Caching** - Cache frequently run queries
4. **Schema Change Detection** - Notify when schema changes
5. **Additional Databases** - MongoDB, Cassandra, etc.
6. **SSH Tunneling** - Secure connections through SSH tunnels
7. **Query History** - Full query audit trail
8. **Performance Metrics** - Query execution analytics

## Troubleshooting

### Connection Fails

1. Check database is running: `docker ps`
2. Test connection manually: `psql -h localhost -U user -d db`
3. Check firewall rules
4. Verify credentials are correct
5. Check logs for detailed error

### Schema Not Loading

1. Check database permissions (need SELECT on information_schema)
2. Try with cached schema (stored in PostgreSQL)
3. Check for timeout issues (large databases)

### Credentials Not Decrypting

1. Verify `ENCRYPTION_KEY` is set correctly
2. Check key hasn't changed (would invalidate existing encrypted data)
3. Look for encryption warnings in logs

## Development

### Adding New Database Type

1. Add to `database_configs` in DatabaseConnectorService
2. Implement driver-specific connection test
3. Add to supported databases list
4. Update documentation
5. Add tests

**Example:**
```python
'mongodb': {
    'driver': 'motor',  # async MongoDB driver
    'default_port': 27017,
    'connection_string': 'mongodb://{username}:{password}@{host}:{port}/{database}',
}
```

## Metrics

### Code Reduction
- **Lines Removed:** ~3,500
- **Lines Added:** ~850
- **Net Reduction:** ~2,650 lines (60-70% complexity reduction)

### Performance
- **Connection Speed:** Faster (no middleware)
- **Memory Usage:** Lower (fewer services)
- **Maintainability:** Significantly improved

## References

- SQLAlchemy Docs: https://docs.sqlalchemy.org/
- ClickHouse HTTP API: https://clickhouse.com/docs/en/interfaces/http/
- Fernet Encryption: https://cryptography.io/en/latest/fernet/
