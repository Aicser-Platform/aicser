"""
Enterprise Data Connectors Service
Handles enterprise-grade data source connections including warehouses, data lakes, and APIs
"""

import logging
import asyncio
import json
from typing import Dict, List, Any, Optional
from datetime import datetime
from dataclasses import dataclass
from enum import Enum
import aiohttp
from src.modules.data.utils.credentials import decrypt_credentials, encrypt_credentials

logger = logging.getLogger(__name__)


class ConnectorType(Enum):
    """Supported enterprise connector types"""

    SNOWFLAKE = "snowflake"
    POSTGRESQL = "postgresql"
    BIGQUERY = "bigquery"
    REDSHIFT = "redshift"
    DATABRICKS = "databricks"
    S3 = "s3"
    AZURE_BLOB = "azure_blob"
    GCS = "gcs"
    REST_API = "rest_api"
    GRAPHQL_API = "graphql_api"
    KAFKA = "kafka"
    ELASTICSEARCH = "elasticsearch"
    MONGODB = "mongodb"
    CASSANDRA = "cassandra"
    # IoT / time-series connectors (EE)
    INFLUXDB = "influxdb"
    PROMETHEUS_SOURCE = "prometheus_source"
    OPENSEARCH = "opensearch"


@dataclass
class ConnectionConfig:
    """Standardized connection configuration"""

    connector_type: ConnectorType
    name: str
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    schema: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    token: Optional[str] = None
    api_key: Optional[str] = None
    connection_string: Optional[str] = None
    ssl_enabled: bool = True
    timeout: int = 30
    max_connections: int = 10
    metadata: Optional[Dict[str, Any]] = None


@dataclass
class QueryResult:
    """Standardized query result"""

    success: bool
    data: List[Dict[str, Any]]
    columns: List[str]
    row_count: int
    execution_time: float
    query_id: Optional[str] = None
    error: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None


class EnterpriseConnectorsService:
    """Service for managing enterprise data connectors"""

    def __init__(self):
        self.connections = {}
        self.connection_pools = {}
        self.supported_connectors = {
            ConnectorType.SNOWFLAKE: self._connect_snowflake,
            ConnectorType.POSTGRESQL: self._connect_postgresql,
            ConnectorType.BIGQUERY: self._connect_bigquery,
            ConnectorType.REDSHIFT: self._connect_redshift,
            ConnectorType.DATABRICKS: self._connect_databricks,
            ConnectorType.S3: self._connect_s3,
            ConnectorType.AZURE_BLOB: self._connect_azure_blob,
            ConnectorType.GCS: self._connect_gcs,
            ConnectorType.REST_API: self._connect_rest_api,
            ConnectorType.INFLUXDB: self._connect_influxdb,
            ConnectorType.PROMETHEUS_SOURCE: self._connect_prometheus,
            ConnectorType.OPENSEARCH: self._connect_opensearch,
            ConnectorType.GRAPHQL_API: self._connect_graphql_api,
            ConnectorType.KAFKA: self._connect_kafka,
            ConnectorType.ELASTICSEARCH: self._connect_elasticsearch,
            ConnectorType.MONGODB: self._connect_mongodb,
            ConnectorType.CASSANDRA: self._connect_cassandra,
        }

        # Performance settings
        self.default_timeout = 30
        self.max_retries = 3
        self.retry_delay = 1

        # Security settings
        self.encrypt_credentials = True
        self.audit_connections = True

    def _decrypt_connection_config(self, config: ConnectionConfig) -> ConnectionConfig:
        """Return a copy of ConnectionConfig with decrypted sensitive fields when possible."""
        try:
            # Convert to dict, run decrypt, then map back
            cfg = {
                "password": config.password,
                "token": config.token,
                "api_key": config.api_key,
                "connection_string": config.connection_string,
            }
            dec = decrypt_credentials(cfg)
            # Create a shallow copy with decrypted values when present
            new = ConnectionConfig(
                connector_type=config.connector_type,
                name=config.name,
                host=config.host,
                port=config.port,
                database=config.database,
                schema=config.schema,
                username=config.username,
                password=dec.get("password") or config.password,
                token=dec.get("token") or config.token,
                api_key=dec.get("api_key") or config.api_key,
                connection_string=dec.get("connection_string") or config.connection_string,
                ssl_enabled=config.ssl_enabled,
                timeout=config.timeout,
                max_connections=config.max_connections,
                metadata=config.metadata,
            )
            return new
        except Exception:
            return config

    async def test_connection(self, config: ConnectionConfig) -> Dict[str, Any]:
        """Test connection to enterprise data source"""
        try:
            logger.info(
                f"🔌 Testing {config.connector_type.value} connection: {config.name}"
            )

            if config.connector_type not in self.supported_connectors:
                return {
                    "success": False,
                    "error": f"Unsupported connector type: {config.connector_type.value}",
                }

            # Test connection: call connector function defensively to support older signatures
            connector_func = self.supported_connectors[config.connector_type]
            try:
                result = await connector_func(config, test_only=True)
            except TypeError:
                # Fallback for legacy connector functions that accept only (config)
                result = await connector_func(config)

            if result["success"]:
                logger.info(f"✅ Connection test successful: {config.name}")
                return {
                    "success": True,
                    "message": f"Connection to {config.name} successful",
                    "connection_info": {
                        "type": config.connector_type.value,
                        "host": config.host,
                        "database": config.database,
                        "schema": config.schema,
                        "tested_at": datetime.now().isoformat(),
                    },
                }
            else:
                return result

        except Exception as e:
            logger.error(f"❌ Connection test failed: {str(e)}")
            return {"success": False, "error": str(e)}

    async def create_connection(self, config: ConnectionConfig) -> Dict[str, Any]:
        """Create and store enterprise connection"""
        try:
            logger.info(
                f"🔌 Creating {config.connector_type.value} connection: {config.name}"
            )

            # Decrypt any encrypted fields in the incoming config
            try:
                config = self._decrypt_connection_config(config)
            except Exception:
                # If decryption fails, continue with original config but log
                logger.exception("Failed to decrypt connection config; proceeding with raw values")

            # Test connection first
            test_result = await self.test_connection(config)
            if not test_result["success"]:
                return test_result

            # Create connection
            connector_func = self.supported_connectors[config.connector_type]
            # Execute connector creation with retries/backoff
            attempt = 0
            connection_result = None
            while attempt < self.max_retries:
                try:
                    connection_result = await connector_func(config)
                    # if connector returns a dict with success key, break on success
                    if isinstance(connection_result, dict) and connection_result.get("success"):
                        break
                except Exception as e:
                    logger.warning(f"Connector creation attempt {attempt+1} failed: {e}")
                attempt += 1
                await asyncio.sleep(self.retry_delay * (2 ** (attempt - 1)))

            if connection_result["success"]:
                # Store connection
                connection_id = f"{config.connector_type.value}_{config.name}_{int(datetime.now().timestamp())}"
                self.connections[connection_id] = {
                    "id": connection_id,
                    "config": config,
                    "connection": connection_result["connection"],
                    "created_at": datetime.now().isoformat(),
                    "last_used": datetime.now().isoformat(),
                    "status": "active",
                }

                # Save to database
                await self._save_connection_to_db(
                    connection_id, config, connection_result
                )

                logger.info(f"✅ Enterprise connection created: {connection_id}")
                return {
                    "success": True,
                    "connection_id": connection_id,
                    "message": f"Connection to {config.name} created successfully",
                    "connection_info": test_result["connection_info"],
                }
            else:
                return connection_result

        except Exception as e:
            logger.error(f"❌ Connection creation failed: {str(e)}")
            return {"success": False, "error": str(e)}

    async def execute_query(
        self, connection_id: str, query: str, params: Optional[Dict] = None
    ) -> QueryResult:
        """Execute query on enterprise connection"""
        try:
            logger.info(f"🔍 Executing query on connection: {connection_id}")

            if connection_id not in self.connections:
                return QueryResult(
                    success=False,
                    data=[],
                    columns=[],
                    row_count=0,
                    execution_time=0,
                    error=f"Connection {connection_id} not found",
                )

            connection = self.connections[connection_id]
            config = connection["config"]

            start_time = datetime.now()

            # Execute query based on connector type
            if config.connector_type == ConnectorType.SNOWFLAKE:
                result = await self._execute_snowflake_query(connection, query, params)
            elif config.connector_type == ConnectorType.BIGQUERY:
                result = await self._execute_bigquery_query(connection, query, params)
            elif config.connector_type == ConnectorType.REDSHIFT:
                result = await self._execute_redshift_query(connection, query, params)
            elif config.connector_type == ConnectorType.DATABRICKS:
                result = await self._execute_databricks_query(connection, query, params)
            elif config.connector_type == ConnectorType.POSTGRESQL:
                result = await self._execute_postgresql_query(connection, query, params)
            elif config.connector_type == ConnectorType.REST_API:
                result = await self._execute_rest_api_query(connection, query, params)
            elif config.connector_type == ConnectorType.S3:
                result = await self._execute_s3_query(connection, query, params)
            elif config.connector_type == ConnectorType.AZURE_BLOB:
                result = await self._execute_azure_blob_query(connection, query, params)
            elif config.connector_type == ConnectorType.GCS:
                result = await self._execute_gcs_query(connection, query, params)
            elif config.connector_type == ConnectorType.GRAPHQL_API:
                result = await self._execute_graphql_query(connection, query, params)
            elif config.connector_type == ConnectorType.KAFKA:
                result = await self._execute_kafka_query(connection, query, params)
            elif config.connector_type == ConnectorType.ELASTICSEARCH:
                result = await self._execute_elasticsearch_query(connection, query, params)
            elif config.connector_type == ConnectorType.MONGODB:
                result = await self._execute_mongodb_query(connection, query, params)
            elif config.connector_type == ConnectorType.CASSANDRA:
                result = await self._execute_cassandra_query(connection, query, params)
            else:
                result = await self._execute_generic_query(connection, query, params)

            execution_time = (datetime.now() - start_time).total_seconds()

            # Update last used timestamp
            connection["last_used"] = datetime.now().isoformat()

            return QueryResult(
                success=result["success"],
                data=result.get("data", []),
                columns=result.get("columns", []),
                row_count=result.get("row_count", 0),
                execution_time=execution_time,
                query_id=result.get("query_id"),
                error=result.get("error"),
                metadata=result.get("metadata"),
            )

        except Exception as e:
            logger.error(f"❌ Query execution failed: {str(e)}")
            return QueryResult(
                success=False,
                data=[],
                columns=[],
                row_count=0,
                execution_time=0,
                error=str(e),
            )

    async def get_schema(
        self, connection_id: str, table_name: Optional[str] = None
    ) -> Dict[str, Any]:
        """Get schema information from enterprise connection"""
        try:
            logger.info(f"🔍 Getting schema for connection: {connection_id}")

            if connection_id not in self.connections:
                return {
                    "success": False,
                    "error": f"Connection {connection_id} not found",
                }

            connection = self.connections[connection_id]
            config = connection["config"]

            # Get schema based on connector type
            if config.connector_type == ConnectorType.SNOWFLAKE:
                result = await self._get_snowflake_schema(connection, table_name)
            elif config.connector_type == ConnectorType.BIGQUERY:
                result = await self._get_bigquery_schema(connection, table_name)
            elif config.connector_type == ConnectorType.REDSHIFT:
                result = await self._get_redshift_schema(connection, table_name)
            elif config.connector_type == ConnectorType.DATABRICKS:
                result = await self._get_databricks_schema(connection, table_name)
            elif config.connector_type == ConnectorType.S3:
                result = await self._get_s3_schema(connection, table_name)
            elif config.connector_type == ConnectorType.AZURE_BLOB:
                result = await self._get_azure_blob_schema(connection, table_name)
            elif config.connector_type == ConnectorType.GCS:
                result = await self._get_gcs_schema(connection, table_name)
            elif config.connector_type == ConnectorType.ELASTICSEARCH:
                result = await self._get_elasticsearch_schema(connection, table_name)
            elif config.connector_type == ConnectorType.MONGODB:
                result = await self._get_mongodb_schema(connection, table_name)
            elif config.connector_type == ConnectorType.KAFKA:
                result = await self._get_kafka_schema(connection, table_name)
            elif config.connector_type == ConnectorType.CASSANDRA:
                result = await self._get_cassandra_schema(connection, table_name)
            elif config.connector_type == ConnectorType.GRAPHQL_API:
                result = await self._get_graphql_schema(connection, table_name)
            else:
                result = await self._get_generic_schema(connection, table_name)

            return result

        except Exception as e:
            logger.error(f"❌ Schema retrieval failed: {str(e)}")
            return {"success": False, "error": str(e)}

    # --- Snowflake Connector ---

    async def _connect_snowflake(self, config: ConnectionConfig, test_only: bool = False) -> Dict[str, Any]:
        """Connect to Snowflake using snowflake-connector-python."""
        try:
            import snowflake.connector  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "Snowflake connector not installed. Run: pip install snowflake-connector-python",
                "connector": "snowflake",
            }
        try:
            def _connect():
                params: Dict[str, Any] = {
                    "account": config.host,
                    "user": config.username,
                    "password": config.password,
                    "warehouse": config.metadata.get("warehouse") if config.metadata else None,
                    "database": config.database,
                    "schema": config.schema or "PUBLIC",
                    "role": config.metadata.get("role") if config.metadata else None,
                    "login_timeout": 15,
                }
                params = {k: v for k, v in params.items() if v is not None}
                conn = snowflake.connector.connect(**params)
                cur = conn.cursor()
                cur.execute("SELECT CURRENT_VERSION()")
                version = cur.fetchone()
                cur.close()
                conn.close()
                return version
            await asyncio.to_thread(_connect)
            msg = "Snowflake connection test successful" if test_only else "Snowflake connection established"
            conn_info = None if test_only else {"account": config.host, "database": config.database, "schema": config.schema}
            return {"success": True, "connection": conn_info, "message": msg}
        except Exception as e:
            logger.error(f"Snowflake connection failed: {e}")
            return {"success": False, "error": str(e)}

    async def _execute_snowflake_query(self, connection: Dict, query: str, params: Optional[Dict]) -> Dict[str, Any]:
        """Execute query on Snowflake."""
        try:
            import snowflake.connector  # type: ignore
        except ImportError:
            return {"success": False, "error": "snowflake-connector-python not installed"}
        try:
            cfg = connection["config"]
            def _run():
                conn_params: Dict[str, Any] = {
                    "account": cfg.host, "user": cfg.username, "password": cfg.password,
                    "database": cfg.database, "schema": cfg.schema or "PUBLIC",
                    "warehouse": cfg.metadata.get("warehouse") if cfg.metadata else None,
                    "role": cfg.metadata.get("role") if cfg.metadata else None,
                }
                conn_params = {k: v for k, v in conn_params.items() if v is not None}
                conn = snowflake.connector.connect(**conn_params)
                cur = conn.cursor(snowflake.connector.DictCursor)
                cur.execute(query, params or {})
                rows = cur.fetchall()
                cols = [col[0] for col in cur.description] if cur.description else []
                cur.close(); conn.close()
                return rows, cols
            rows, cols = await asyncio.to_thread(_run)
            return {"success": True, "data": rows, "columns": cols, "row_count": len(rows), "query_id": f"sf_{int(datetime.now().timestamp())}"}
        except Exception as e:
            logger.error(f"Snowflake query failed: {e}")
            return {"success": False, "error": str(e)}

    async def _get_snowflake_schema(self, connection: Dict, table_name: Optional[str]) -> Dict[str, Any]:
        """Get Snowflake INFORMATION_SCHEMA tables."""
        schema_query = "SELECT TABLE_NAME, COLUMN_NAME, DATA_TYPE, IS_NULLABLE FROM INFORMATION_SCHEMA.COLUMNS"
        if table_name:
            schema_query += f" WHERE TABLE_NAME = '{table_name.upper()}'"
        result = await self._execute_snowflake_query(connection, schema_query, None)
        if not result.get("success"):
            return result
        tables: Dict[str, Any] = {}
        for row in result.get("data", []):
            tname = row.get("TABLE_NAME", "")
            if tname not in tables:
                tables[tname] = {"name": tname, "columns": []}
            tables[tname]["columns"].append({"name": row["COLUMN_NAME"], "type": row["DATA_TYPE"], "nullable": row["IS_NULLABLE"] == "YES"})
        return {"success": True, "tables": list(tables.values()), "total_tables": len(tables), "database": connection["config"].database}

    # --- BigQuery Connector ---

    async def _connect_bigquery(self, config: ConnectionConfig, test_only: bool = False) -> Dict[str, Any]:
        """Connect to Google BigQuery using google-cloud-bigquery."""
        try:
            from google.cloud import bigquery  # type: ignore
            from google.oauth2 import service_account  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "BigQuery not installed. Run: pip install google-cloud-bigquery",
                "connector": "bigquery",
            }
        try:
            def _connect():
                kwargs: Dict[str, Any] = {"project": config.database}
                if config.metadata and config.metadata.get("credentials_json"):
                    creds = service_account.Credentials.from_service_account_info(json.loads(config.metadata["credentials_json"]))
                    kwargs["credentials"] = creds
                client = bigquery.Client(**kwargs)
                list(client.list_datasets(max_results=1))
                return True
            await asyncio.to_thread(_connect)
            msg = "BigQuery connection test successful" if test_only else "BigQuery connection established"
            return {"success": True, "connection": None if test_only else {"project": config.database}, "message": msg}
        except Exception as e:
            logger.error(f"BigQuery connection failed: {e}")
            return {"success": False, "error": str(e)}

    async def _execute_bigquery_query(self, connection: Dict, query: str, params: Optional[Dict]) -> Dict[str, Any]:
        """Execute query on BigQuery."""
        try:
            from google.cloud import bigquery  # type: ignore
        except ImportError:
            return {"success": False, "error": "google-cloud-bigquery not installed"}
        try:
            cfg = connection["config"]
            def _run():
                client = bigquery.Client(project=cfg.database)
                job = client.query(query)
                rows = [dict(r) for r in job.result()]
                cols = [f.name for f in job.result().schema] if job.result().schema else (list(rows[0].keys()) if rows else [])
                return rows, cols
            rows, cols = await asyncio.to_thread(_run)
            return {"success": True, "data": rows, "columns": cols, "row_count": len(rows), "query_id": f"bq_{int(datetime.now().timestamp())}"}
        except Exception as e:
            logger.error(f"BigQuery query failed: {e}")
            return {"success": False, "error": str(e)}

    async def _get_bigquery_schema(self, connection: Dict, table_name: Optional[str]) -> Dict[str, Any]:
        """Get BigQuery dataset/table schema."""
        try:
            from google.cloud import bigquery  # type: ignore
        except ImportError:
            return {"success": False, "error": "google-cloud-bigquery not installed"}
        try:
            cfg = connection["config"]
            def _run():
                client = bigquery.Client(project=cfg.database)
                tables_out = []
                for ds in client.list_datasets():
                    for tref in client.list_tables(ds.reference):
                        if table_name and tref.table_id != table_name:
                            continue
                        t = client.get_table(tref)
                        tables_out.append({
                            "name": f"{ds.dataset_id}.{t.table_id}",
                            "columns": [{"name": f.name, "type": str(f.field_type), "nullable": f.mode == "NULLABLE"} for f in t.schema],
                            "row_count": t.num_rows,
                        })
                return tables_out
            tables = await asyncio.to_thread(_run)
            return {"success": True, "tables": tables, "total_tables": len(tables), "project": cfg.database}
        except Exception as e:
            logger.error(f"BigQuery schema failed: {e}")
            return {"success": False, "error": str(e)}

    # --- Redshift Connector ---

    async def _connect_redshift(self, config: ConnectionConfig, test_only: bool = False) -> Dict[str, Any]:
        """Connect to Amazon Redshift using redshift_connector."""
        try:
            import redshift_connector  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "Redshift connector not installed. Run: pip install redshift_connector",
                "connector": "redshift",
            }
        try:
            def _connect():
                conn = redshift_connector.connect(
                    host=config.host, port=config.port or 5439,
                    database=config.database, user=config.username, password=config.password,
                )
                cur = conn.cursor()
                cur.execute("SELECT 1")
                cur.close(); conn.close()
            await asyncio.to_thread(_connect)
            msg = "Redshift connection test successful" if test_only else "Redshift connection established"
            return {"success": True, "connection": None if test_only else {"host": config.host, "database": config.database}, "message": msg}
        except Exception as e:
            logger.error(f"Redshift connection failed: {e}")
            return {"success": False, "error": str(e)}

    async def _execute_redshift_query(self, connection: Dict, query: str, params: Optional[Dict]) -> Dict[str, Any]:
        """Execute query on Redshift."""
        try:
            import redshift_connector  # type: ignore
        except ImportError:
            return {"success": False, "error": "redshift_connector not installed"}
        try:
            cfg = connection["config"]
            def _run():
                conn = redshift_connector.connect(
                    host=cfg.host, port=cfg.port or 5439,
                    database=cfg.database, user=cfg.username, password=cfg.password,
                )
                cur = conn.cursor()
                cur.execute(query)
                rows = cur.fetchall()
                cols = [d[0] for d in cur.description] if cur.description else []
                cur.close(); conn.close()
                return [dict(zip(cols, r)) for r in rows], cols
            data, cols = await asyncio.to_thread(_run)
            return {"success": True, "data": data, "columns": cols, "row_count": len(data), "query_id": f"rs_{int(datetime.now().timestamp())}"}
        except Exception as e:
            logger.error(f"Redshift query failed: {e}")
            return {"success": False, "error": str(e)}

    async def _execute_postgresql_query(self, connection: Dict, query: str, params: Optional[Dict]) -> Dict[str, Any]:
        """Execute a real query against PostgreSQL using psycopg2 in a thread."""
        try:
            cfg = connection.get('config')

            def run():
                import psycopg2
                import psycopg2.extras

                conn = psycopg2.connect(
                    host=cfg.host,
                    port=cfg.port or 5432,
                    dbname=cfg.database,
                    user=cfg.username,
                    password=cfg.password,
                    connect_timeout=10,
                )
                cur = conn.cursor(cursor_factory=psycopg2.extras.RealDictCursor)
                cur.execute(query)
                rows = cur.fetchall()
                cols = list(rows[0].keys()) if rows else []
                cur.close()
                conn.close()
                return {"success": True, "data": rows, "columns": cols, "row_count": len(rows)}

            res = await asyncio.to_thread(run)
            return res
        except Exception as e:
            logger.error(f"❌ Postgres query execution failed: {e}")
            return {"success": False, "error": str(e)}

    async def _get_redshift_schema(self, connection: Dict, table_name: Optional[str]) -> Dict[str, Any]:
        """Get Redshift schema from INFORMATION_SCHEMA."""
        where = f" WHERE table_name = '{table_name}'" if table_name else ""
        schema_query = f"SELECT table_name, column_name, data_type, is_nullable FROM information_schema.columns{where} ORDER BY table_name, ordinal_position"
        result = await self._execute_redshift_query(connection, schema_query, None)
        if not result.get("success"):
            return result
        tables: Dict[str, Any] = {}
        for row in result.get("data", []):
            tname = row.get("table_name", "")
            if tname not in tables:
                tables[tname] = {"name": tname, "columns": []}
            tables[tname]["columns"].append({"name": row["column_name"], "type": row["data_type"], "nullable": row["is_nullable"] == "YES"})
        return {"success": True, "tables": list(tables.values()), "total_tables": len(tables), "cluster": connection["config"].host, "database": connection["config"].database}

    # --- Databricks Connector ---

    async def _connect_databricks(self, config: ConnectionConfig, test_only: bool = False) -> Dict[str, Any]:
        """Connect to Databricks using databricks-sql-connector."""
        try:
            from databricks import sql as databricks_sql  # type: ignore
        except ImportError:
            return {
                "success": False,
                "error": "Databricks SQL connector not installed. Run: pip install databricks-sql-connector",
                "connector": "databricks",
            }
        try:
            http_path = (config.metadata or {}).get("http_path") or config.database
            def _connect():
                conn = databricks_sql.connect(
                    server_hostname=config.host,
                    http_path=http_path,
                    access_token=config.token or config.password,
                )
                cur = conn.cursor()
                cur.execute("SELECT 1")
                cur.close(); conn.close()
            await asyncio.to_thread(_connect)
            msg = "Databricks connection test successful" if test_only else "Databricks connection established"
            conn_info = None if test_only else {"workspace": config.host, "http_path": http_path}
            return {"success": True, "connection": conn_info, "message": msg}
        except Exception as e:
            logger.error(f"Databricks connection failed: {e}")
            return {"success": False, "error": str(e)}

    async def _execute_databricks_query(self, connection: Dict, query: str, params: Optional[Dict]) -> Dict[str, Any]:
        """Execute query on Databricks."""
        try:
            from databricks import sql as databricks_sql  # type: ignore
        except ImportError:
            return {"success": False, "error": "databricks-sql-connector not installed"}
        try:
            cfg = connection["config"]
            http_path = (cfg.metadata or {}).get("http_path") or cfg.database
            def _run():
                conn = databricks_sql.connect(
                    server_hostname=cfg.host, http_path=http_path,
                    access_token=cfg.token or cfg.password,
                )
                cur = conn.cursor()
                cur.execute(query)
                rows = cur.fetchall()
                cols = [d[0] for d in cur.description] if cur.description else []
                cur.close(); conn.close()
                return [dict(zip(cols, r)) for r in rows], cols
            data, cols = await asyncio.to_thread(_run)
            return {"success": True, "data": data, "columns": cols, "row_count": len(data), "query_id": f"dbx_{int(datetime.now().timestamp())}"}
        except Exception as e:
            logger.error(f"Databricks query failed: {e}")
            return {"success": False, "error": str(e)}

    async def _get_databricks_schema(self, connection: Dict, table_name: Optional[str]) -> Dict[str, Any]:
        """Get Databricks catalog/schema tables."""
        schema_query = "SHOW TABLES"
        if table_name:
            schema_query = f"DESCRIBE TABLE {table_name}"
        result = await self._execute_databricks_query(connection, schema_query, None)
        if not result.get("success"):
            return result
        return {"success": True, "tables": result.get("data", []), "total_tables": len(result.get("data", [])), "workspace": connection["config"].host}

    # REST API Connector
    async def _connect_rest_api(
        self, config: ConnectionConfig, test_only: bool = False
    ) -> Dict[str, Any]:
        """Connect to REST API"""
        try:
            connection_info = {
                "base_url": config.host,
                "api_key": config.api_key,
                "token": config.token,
                "headers": {
                    "Content-Type": "application/json",
                    "User-Agent": "Aiser-Data-Connector/1.0",
                },
            }

            if config.api_key:
                connection_info["headers"]["Authorization"] = f"Bearer {config.api_key}"
            elif config.token:
                connection_info["headers"]["Authorization"] = f"Bearer {config.token}"

            if test_only:
                # Test API endpoint
                async with aiohttp.ClientSession() as session:
                    async with session.get(
                        f"{config.host}/health",
                        headers=connection_info["headers"],
                        timeout=aiohttp.ClientTimeout(total=config.timeout),
                    ) as response:
                        if response.status in [200, 201]:
                            return {
                                "success": True,
                                "connection": None,
                                "message": "REST API connection test successful",
                            }
                        else:
                            return {
                                "success": False,
                                "error": f"API test failed: HTTP {response.status}",
                            }

            return {
                "success": True,
                "connection": connection_info,
                "message": "REST API connection established",
            }

        except Exception as e:
            logger.error(f"❌ REST API connection failed: {str(e)}")
            return {"success": False, "error": str(e)}

    async def _execute_rest_api_query(
        self, connection: Dict, query: str, params: Optional[Dict]
    ) -> Dict[str, Any]:
        """Execute query on REST API"""
        try:
            # Parse query as API endpoint and parameters
            query_parts = query.split(" ", 1)
            endpoint = query_parts[0] if query_parts else "/data"
            query_params = query_parts[1] if len(query_parts) > 1 else ""

            # Convert query parameters to API parameters
            api_params = {}
            if query_params:
                # Simple parameter parsing
                for param in query_params.split("&"):
                    if "=" in param:
                        key, value = param.split("=", 1)
                        api_params[key] = value

            # Merge with provided params
            if params:
                api_params.update(params)

            connection_info = connection["connection"]

            async with aiohttp.ClientSession() as session:
                async with session.get(
                    f"{connection_info['base_url']}{endpoint}",
                    headers=connection_info["headers"],
                    params=api_params,
                    timeout=aiohttp.ClientTimeout(total=connection["config"].timeout),
                ) as response:
                    if response.status == 200:
                        data = await response.json()

                        # Convert API response to standardized format
                        if isinstance(data, list):
                            result_data = data
                        elif isinstance(data, dict) and "data" in data:
                            result_data = data["data"]
                        else:
                            result_data = [data]

                        # Extract columns from first row
                        columns = list(result_data[0].keys()) if result_data else []

                        return {
                            "success": True,
                            "data": result_data,
                            "columns": columns,
                            "row_count": len(result_data),
                            "query_id": f"api_{int(datetime.now().timestamp())}",
                            "metadata": {
                                "endpoint": endpoint,
                                "status_code": response.status,
                                "response_headers": dict(response.headers),
                            },
                        }
                    else:
                        error_text = await response.text()
                        return {
                            "success": False,
                            "error": f"API request failed: HTTP {response.status} - {error_text}",
                        }

        except Exception as e:
            logger.error(f"❌ REST API query execution failed: {str(e)}")
            return {"success": False, "error": str(e)}

    # --- S3 (boto3) ---
    def _s3_creds(self, config: ConnectionConfig) -> Dict[str, Any]:
        md = config.metadata or {}
        return {
            "region": config.host or md.get("region") or "us-east-1",
            "bucket": config.database or md.get("bucket"),
            "aws_access_key_id": config.username or md.get("aws_access_key_id"),
            "aws_secret_access_key": config.password or md.get("aws_secret_access_key"),
        }

    async def _connect_s3(
        self, config: ConnectionConfig, test_only: bool = False
    ) -> Dict[str, Any]:
        try:
            import boto3  # type: ignore
        except ImportError:
            return {"success": False, "error": "boto3 not installed (included with aws deps)"}
        c = self._s3_creds(config)
        try:
            def _test():
                sess = boto3.session.Session(
                    aws_access_key_id=c["aws_access_key_id"],
                    aws_secret_access_key=c["aws_secret_access_key"],
                    region_name=c["region"],
                )
                client = sess.client("s3")
                if c["bucket"]:
                    client.head_bucket(Bucket=c["bucket"])
                else:
                    client.list_buckets()
            await asyncio.to_thread(_test)
            msg = "S3 connection OK" if test_only else "S3 connection established"
            return {"success": True, "connection": {"type": "s3", **{k: v for k, v in c.items() if k != "aws_secret_access_key"}}, "message": msg}
        except Exception as e:
            logger.error(f"S3 connect failed: {e}")
            return {"success": False, "error": str(e)}

    async def _execute_s3_query(self, connection: Dict, query: str, params: Optional[Dict]) -> Dict[str, Any]:
        try:
            import boto3  # type: ignore
        except ImportError:
            return {"success": False, "error": "boto3 not installed"}
        cfg = connection["config"]
        c = self._s3_creds(cfg)
        if not c["bucket"]:
            return {"success": False, "error": "S3 bucket required (database field or metadata.bucket)"}
        try:
            op: Dict[str, Any] = {}
            q = (query or "").strip()
            if q.startswith("{"):
                op = json.loads(q)
            elif q.upper().startswith("LIST") or not q:
                op = {"op": "list", "prefix": q.split(" ", 1)[1].strip() if " " in q else "", "max_keys": 500}
            else:
                op = {"op": "list", "prefix": q, "max_keys": 500}
            if params:
                op.update(params)

            def _run():
                sess = boto3.session.Session(
                    aws_access_key_id=c["aws_access_key_id"],
                    aws_secret_access_key=c["aws_secret_access_key"],
                    region_name=c["region"],
                )
                cl = sess.client("s3")
                prefix = op.get("prefix", "")
                max_keys = min(int(op.get("max_keys", 500)), 5000)
                resp = cl.list_objects_v2(Bucket=c["bucket"], Prefix=prefix, MaxKeys=max_keys)
                rows = []
                for o in resp.get("Contents", []):
                    rows.append({"key": o["Key"], "size": o["Size"], "last_modified": str(o["LastModified"])})
                return rows, list(rows[0].keys()) if rows else ["key", "size", "last_modified"]

            rows, cols = await asyncio.to_thread(_run)
            return {"success": True, "data": rows, "columns": cols, "row_count": len(rows), "query_id": f"s3_{int(datetime.now().timestamp())}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _get_s3_schema(self, connection: Dict, table_name: Optional[str]) -> Dict[str, Any]:
        r = await self._execute_s3_query(connection, json.dumps({"op": "list", "prefix": table_name or "", "max_keys": 200}), None)
        if not r.get("success"):
            return r
        keys = [row["key"] for row in r.get("data", [])]
        return {"success": True, "tables": [{"name": "objects", "columns": [{"name": "key", "type": "string"}, {"name": "size", "type": "int"}]}], "sample_keys": keys[:50], "total_objects": len(keys)}

    # --- Azure Blob ---
    async def _connect_azure_blob(
        self, config: ConnectionConfig, test_only: bool = False
    ) -> Dict[str, Any]:
        try:
            from azure.storage.blob import BlobServiceClient  # type: ignore
        except ImportError:
            return {"success": False, "error": "azure-storage-blob not installed"}
        try:
            def _test():
                if config.connection_string:
                    svc = BlobServiceClient.from_connection_string(config.connection_string)
                else:
                    account = (config.metadata or {}).get("account_name") or config.host
                    if not account:
                        raise ValueError("Set connection_string or metadata.account_name + token/credential")
                    url = f"https://{account}.blob.core.windows.net"
                    cred = config.token or config.password
                    svc = BlobServiceClient(account_url=url, credential=cred)
                container = config.database or (config.metadata or {}).get("container")
                if container:
                    cc = svc.get_container_client(container)
                    cc.get_container_properties()
                else:
                    next(svc.list_containers(max_results=1), None)
            await asyncio.to_thread(_test)
            return {"success": True, "connection": {"type": "azure_blob"}, "message": "Azure Blob OK" if test_only else "Azure Blob connected"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _execute_azure_blob_query(self, connection: Dict, query: str, params: Optional[Dict]) -> Dict[str, Any]:
        try:
            from azure.storage.blob import BlobServiceClient  # type: ignore
        except ImportError:
            return {"success": False, "error": "azure-storage-blob not installed"}
        cfg = connection["config"]
        md = cfg.metadata or {}
        try:
            def _run():
                if cfg.connection_string:
                    svc = BlobServiceClient.from_connection_string(cfg.connection_string)
                else:
                    account = md.get("account_name") or cfg.host
                    url = f"https://{account}.blob.core.windows.net"
                    svc = BlobServiceClient(account_url=url, credential=cfg.token or cfg.password)
                container = cfg.database or md.get("container")
                if not container:
                    raise ValueError("container required in database or metadata.container")
                cc = svc.get_container_client(container)
                op = json.loads(query) if (query or "").strip().startswith("{") else {"prefix": (query or "").strip()}
                prefix = op.get("prefix", "")
                max_r = min(int(op.get("max_results", 500)), 5000)
                rows = []
                for i, b in enumerate(cc.list_blobs(name_starts_with=prefix)):
                    if i >= max_r:
                        break
                    rows.append({"name": b.name, "size": b.size, "last_modified": str(b.last_modified)})
                cols = list(rows[0].keys()) if rows else ["name", "size", "last_modified"]
                return rows, cols

            rows, cols = await asyncio.to_thread(_run)
            return {"success": True, "data": rows, "columns": cols, "row_count": len(rows), "query_id": f"az_{int(datetime.now().timestamp())}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _get_azure_blob_schema(self, connection: Dict, table_name: Optional[str]) -> Dict[str, Any]:
        r = await self._execute_azure_blob_query(connection, json.dumps({"prefix": table_name or "", "max_results": 100}), None)
        if not r.get("success"):
            return r
        return {"success": True, "tables": [{"name": "blobs", "columns": [{"name": "name", "type": "string"}]}], "blobs": [x["name"] for x in r.get("data", [])]}

    # --- GCS ---
    async def _connect_gcs(
        self, config: ConnectionConfig, test_only: bool = False
    ) -> Dict[str, Any]:
        try:
            from google.cloud import storage  # type: ignore
            from google.oauth2 import service_account  # type: ignore
        except ImportError:
            return {"success": False, "error": "google-cloud-storage not installed"}
        try:
            bucket_name = config.database or (config.metadata or {}).get("bucket")
            if not bucket_name:
                return {"success": False, "error": "GCS bucket required (database or metadata.bucket)"}

            def _test():
                creds = None
                if config.metadata and config.metadata.get("credentials_json"):
                    creds = service_account.Credentials.from_service_account_info(
                        json.loads(config.metadata["credentials_json"])
                    )
                client = storage.Client(credentials=creds, project=(config.metadata or {}).get("project"))
                b = client.bucket(bucket_name)
                b.reload()
            await asyncio.to_thread(_test)
            return {"success": True, "connection": {"type": "gcs", "bucket": bucket_name}, "message": "GCS OK"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _execute_gcs_query(self, connection: Dict, query: str, params: Optional[Dict]) -> Dict[str, Any]:
        try:
            from google.cloud import storage  # type: ignore
            from google.oauth2 import service_account  # type: ignore
        except ImportError:
            return {"success": False, "error": "google-cloud-storage not installed"}
        cfg = connection["config"]
        md = cfg.metadata or {}
        bucket_name = cfg.database or md.get("bucket")
        try:
            def _run():
                creds = None
                if md.get("credentials_json"):
                    creds = service_account.Credentials.from_service_account_info(json.loads(md["credentials_json"]))
                client = storage.Client(credentials=creds, project=md.get("project"))
                b = client.bucket(bucket_name)
                op = json.loads(query) if (query or "").strip().startswith("{") else {"prefix": (query or "").strip()}
                prefix = op.get("prefix", "")
                max_r = min(int(op.get("max_results", 500)), 5000)
                rows = []
                for i, bl in enumerate(client.list_blobs(bucket_name, prefix=prefix)):
                    if i >= max_r:
                        break
                    rows.append({"name": bl.name, "size": bl.size, "updated": str(bl.updated)})
                cols = list(rows[0].keys()) if rows else ["name", "size", "updated"]
                return rows, cols

            rows, cols = await asyncio.to_thread(_run)
            return {"success": True, "data": rows, "columns": cols, "row_count": len(rows), "query_id": f"gcs_{int(datetime.now().timestamp())}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _get_gcs_schema(self, connection: Dict, table_name: Optional[str]) -> Dict[str, Any]:
        r = await self._execute_gcs_query(connection, json.dumps({"prefix": table_name or "", "max_results": 50}), None)
        if not r.get("success"):
            return r
        return {"success": True, "tables": [{"name": "objects", "columns": [{"name": "name", "type": "string"}]}], "objects": [x["name"] for x in r.get("data", [])]}

    # --- GraphQL ---
    async def _connect_graphql_api(
        self, config: ConnectionConfig, test_only: bool = False
    ) -> Dict[str, Any]:
        if not config.host:
            return {"success": False, "error": "GraphQL endpoint URL required (host)"}
        try:
            headers = {"Content-Type": "application/json"}
            if config.api_key:
                headers["Authorization"] = f"Bearer {config.api_key}"
            elif config.token:
                headers["Authorization"] = f"Bearer {config.token}"
            payload = {"query": "{ __typename }"}
            async with aiohttp.ClientSession() as session:
                async with session.post(config.host, json=payload, headers=headers, timeout=aiohttp.ClientTimeout(total=config.timeout or 30)) as resp:
                    if resp.status not in (200, 201):
                        return {"success": False, "error": f"GraphQL HTTP {resp.status}"}
                    _ = await resp.json()
            return {"success": True, "connection": {"endpoint": config.host}, "message": "GraphQL OK"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _execute_graphql_query(self, connection: Dict, query: str, params: Optional[Dict]) -> Dict[str, Any]:
        cfg = connection["config"]
        try:
            body = json.loads(query) if query.strip().startswith("{") else {"query": query, "variables": params or {}}
            headers = {"Content-Type": "application/json"}
            if cfg.api_key:
                headers["Authorization"] = f"Bearer {cfg.api_key}"
            elif cfg.token:
                headers["Authorization"] = f"Bearer {cfg.token}"
            async with aiohttp.ClientSession() as session:
                async with session.post(cfg.host, json=body, headers=headers, timeout=aiohttp.ClientTimeout(total=cfg.timeout or 60)) as resp:
                    data = await resp.json()
            if data.get("errors"):
                return {"success": False, "error": str(data["errors"])}
            d = data.get("data") or {}
            flat = d if isinstance(d, list) else [d]
            cols = list(flat[0].keys()) if flat and isinstance(flat[0], dict) else ["result"]
            rows = flat if flat and isinstance(flat[0], dict) else [{"result": json.dumps(d)[:8000]}]
            return {"success": True, "data": rows, "columns": cols, "row_count": len(rows), "query_id": f"gql_{int(datetime.now().timestamp())}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _get_graphql_schema(self, connection: Dict, table_name: Optional[str]) -> Dict[str, Any]:
        return {
            "success": True,
            "tables": [],
            "note": "Run a GraphQL query or introspection via Execute; many gateways disable schema export.",
        }

    # --- Kafka ---
    async def _connect_kafka(
        self, config: ConnectionConfig, test_only: bool = False
    ) -> Dict[str, Any]:
        try:
            from kafka import KafkaAdminClient  # type: ignore
        except ImportError:
            return {"success": False, "error": "kafka-python not installed. Run: pip install kafka-python"}
        if not config.host:
            return {"success": False, "error": "Kafka bootstrap servers required (host, comma-separated)"}
        try:
            def _test():
                admin = KafkaAdminClient(bootstrap_servers=config.host.split(","), request_timeout_ms=10000)
                admin.list_topics()
                admin.close()
            await asyncio.to_thread(_test)
            return {"success": True, "connection": {"bootstrap": config.host}, "message": "Kafka OK"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _execute_kafka_query(self, connection: Dict, query: str, params: Optional[Dict]) -> Dict[str, Any]:
        try:
            from kafka import KafkaConsumer  # type: ignore
        except ImportError:
            return {"success": False, "error": "kafka-python not installed"}
        cfg = connection["config"]
        md = cfg.metadata or {}
        try:
            op = json.loads(query) if (query or "").strip().startswith("{") else {}
            topic = op.get("topic") or md.get("topic") or cfg.database
            if not topic:
                return {"success": False, "error": 'Kafka topic required (metadata.topic, database field, or JSON {"topic":"t"}'}
            limit = min(int(op.get("limit", 50)), 500)
            timeout_ms = int(op.get("timeout_ms", 8000))

            def _poll():
                consumer = KafkaConsumer(
                    topic,
                    bootstrap_servers=cfg.host.split(","),
                    consumer_timeout_ms=timeout_ms,
                    auto_offset_reset=op.get("auto_offset_reset", "earliest"),
                    enable_auto_commit=False,
                    group_id=f"aiser_read_{int(datetime.now().timestamp())}",
                    value_deserializer=lambda m: m.decode("utf-8", errors="replace") if m else None,
                )
                rows = []
                for msg in consumer:
                    rows.append({
                        "partition": msg.partition,
                        "offset": msg.offset,
                        "key": msg.key.decode("utf-8", errors="replace") if msg.key else None,
                        "value": (msg.value or "")[:4000],
                    })
                    if len(rows) >= limit:
                        break
                consumer.close()
                return rows

            rows = await asyncio.to_thread(_poll)
            cols = ["partition", "offset", "key", "value"]
            return {"success": True, "data": rows, "columns": cols, "row_count": len(rows), "query_id": f"kfk_{int(datetime.now().timestamp())}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _get_kafka_schema(self, connection: Dict, table_name: Optional[str]) -> Dict[str, Any]:
        try:
            from kafka import KafkaConsumer  # type: ignore
        except ImportError:
            return {"success": False, "error": "kafka-python not installed"}
        cfg = connection["config"]

        def _topics():
            c = KafkaConsumer(bootstrap_servers=cfg.host.split(","), consumer_timeout_ms=5000)
            topics = list(c.topics())
            c.close()
            return topics

        try:
            topics = await asyncio.to_thread(_topics)
            if table_name:
                topics = [t for t in topics if table_name in t]
            return {"success": True, "tables": [{"name": t, "columns": [{"name": "value", "type": "string"}]} for t in topics[:200]], "total_topics": len(topics)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # --- Elasticsearch ---
    async def _connect_elasticsearch(
        self, config: ConnectionConfig, test_only: bool = False
    ) -> Dict[str, Any]:
        try:
            from elasticsearch import Elasticsearch  # type: ignore
        except ImportError:
            return {"success": False, "error": "elasticsearch package not installed"}
        if not config.host:
            return {"success": False, "error": "Elasticsearch URL required (host, e.g. https://localhost:9200)"}
        try:
            def _test():
                auth = (config.username, config.password) if config.username else None
                es = Elasticsearch(config.host, basic_auth=auth, verify_certs=config.ssl_enabled, request_timeout=config.timeout or 30)
                es.info()
            await asyncio.to_thread(_test)
            return {"success": True, "connection": {"url": config.host}, "message": "Elasticsearch OK"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _execute_elasticsearch_query(self, connection: Dict, query: str, params: Optional[Dict]) -> Dict[str, Any]:
        try:
            from elasticsearch import Elasticsearch  # type: ignore
        except ImportError:
            return {"success": False, "error": "elasticsearch not installed"}
        cfg = connection["config"]
        try:
            def _run():
                auth = (cfg.username, cfg.password) if cfg.username else None
                es = Elasticsearch(cfg.host, basic_auth=auth, verify_certs=cfg.ssl_enabled, request_timeout=60)
                q = (query or "").strip()
                if q.startswith("{"):
                    body = dict(json.loads(q))
                    idx = body.pop("index", "_all")
                    size = int(body.pop("size", 100))
                    try:
                        res = es.search(index=idx, body=body)
                    except TypeError:
                        inner = body.get("query", {"match_all": {}})
                        res = es.search(index=idx, query=inner, size=size)
                else:
                    try:
                        res = es.search(
                            index="_all",
                            body={"query": {"query_string": {"query": q}}, "size": 100},
                        )
                    except TypeError:
                        res = es.search(
                            index="_all",
                            query={"query_string": {"query": q}},
                            size=100,
                        )
                hits = res.get("hits", {}).get("hits", [])
                rows = []
                for h in hits:
                    src = h.get("_source") or {}
                    src["_id"] = h.get("_id")
                    src["_index"] = h.get("_index")
                    rows.append(src)
                cols = list(rows[0].keys()) if rows else []
                return rows, cols

            rows, cols = await asyncio.to_thread(_run)
            return {"success": True, "data": rows, "columns": cols, "row_count": len(rows), "query_id": f"es_{int(datetime.now().timestamp())}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _get_elasticsearch_schema(self, connection: Dict, table_name: Optional[str]) -> Dict[str, Any]:
        try:
            from elasticsearch import Elasticsearch  # type: ignore
        except ImportError:
            return {"success": False, "error": "elasticsearch not installed"}
        cfg = connection["config"]

        def _cat():
            auth = (cfg.username, cfg.password) if cfg.username else None
            es = Elasticsearch(cfg.host, basic_auth=auth, verify_certs=cfg.ssl_enabled)
            try:
                return list(es.indices.get_alias(index="*").keys())
            except Exception:
                raw = es.cat.indices(format="json")
                if isinstance(raw, list):
                    return [x.get("index") for x in raw if x.get("index")]
                return []

        try:
            indices = await asyncio.to_thread(_cat)
            if table_name:
                indices = [i for i in indices if table_name in i]
            return {"success": True, "tables": [{"name": i, "columns": [{"name": "_source", "type": "object"}]} for i in indices[:200]]}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # --- MongoDB ---
    async def _connect_mongodb(
        self, config: ConnectionConfig, test_only: bool = False
    ) -> Dict[str, Any]:
        try:
            import pymongo  # type: ignore
        except ImportError:
            return {"success": False, "error": "pymongo not installed"}
        try:
            def _test():
                if config.connection_string:
                    client = pymongo.MongoClient(config.connection_string, serverSelectionTimeoutMS=8000)
                else:
                    client = pymongo.MongoClient(
                        host=config.host or "localhost",
                        port=config.port or 27017,
                        username=config.username or None,
                        password=config.password or None,
                        serverSelectionTimeoutMS=8000,
                    )
                client.admin.command("ping")
                client.close()
            await asyncio.to_thread(_test)
            return {"success": True, "connection": {"type": "mongodb"}, "message": "MongoDB OK"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _execute_mongodb_query(self, connection: Dict, query: str, params: Optional[Dict]) -> Dict[str, Any]:
        try:
            import pymongo  # type: ignore
        except ImportError:
            return {"success": False, "error": "pymongo not installed"}
        cfg = connection["config"]
        db_name = cfg.database
        if not db_name:
            return {"success": False, "error": "MongoDB database name required"}
        try:
            lines = (query or "").strip().split("\n", 1)
            coll_name = "documents"
            filter_doc: Dict[str, Any] = {}
            if lines and lines[0].startswith("collection:"):
                coll_name = lines[0].split(":", 1)[1].strip()
                rest = lines[1] if len(lines) > 1 else "{}"
            else:
                rest = lines[0] if lines else "{}"
            if rest.strip():
                filter_doc = json.loads(rest) if rest.strip().startswith("{") else {}

            def _run():
                if cfg.connection_string:
                    client = pymongo.MongoClient(cfg.connection_string)
                else:
                    client = pymongo.MongoClient(
                        host=cfg.host or "localhost",
                        port=cfg.port or 27017,
                        username=cfg.username or None,
                        password=cfg.password or None,
                    )
                col = client[db_name][coll_name]
                cur = col.find(filter_doc).limit(200)
                rows = list(cur)
                for r in rows:
                    if "_id" in r:
                        r["_id"] = str(r["_id"])
                cols = list(rows[0].keys()) if rows else []
                client.close()
                return rows, cols

            rows, cols = await asyncio.to_thread(_run)
            return {"success": True, "data": rows, "columns": cols, "row_count": len(rows), "query_id": f"mongo_{int(datetime.now().timestamp())}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _get_mongodb_schema(self, connection: Dict, table_name: Optional[str]) -> Dict[str, Any]:
        try:
            import pymongo  # type: ignore
        except ImportError:
            return {"success": False, "error": "pymongo not installed"}
        cfg = connection["config"]
        if not cfg.database:
            return {"success": False, "error": "database name required"}

        def _cols():
            if cfg.connection_string:
                client = pymongo.MongoClient(cfg.connection_string)
            else:
                client = pymongo.MongoClient(host=cfg.host or "localhost", port=cfg.port or 27017, username=cfg.username, password=cfg.password)
            db = client[cfg.database]
            names = db.list_collection_names()
            if table_name:
                names = [n for n in names if table_name in n]
            out = [{"name": n, "columns": [{"name": "document", "type": "object"}]} for n in names[:200]]
            client.close()
            return out

        try:
            tables = await asyncio.to_thread(_cols)
            return {"success": True, "tables": tables, "total_collections": len(tables)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # --- Cassandra ---
    async def _connect_cassandra(
        self, config: ConnectionConfig, test_only: bool = False
    ) -> Dict[str, Any]:
        try:
            from cassandra.cluster import Cluster  # type: ignore
        except ImportError:
            return {"success": False, "error": "cassandra-driver not installed. Run: pip install cassandra-driver"}
        if not config.host:
            return {"success": False, "error": "Cassandra contact points required (host, comma-separated)"}
        try:
            def _test():
                points = [h.strip() for h in config.host.split(",")]
                cl = Cluster(points, port=config.port or 9042, connect_timeout=10)
                sess = cl.connect()
                sess.execute("SELECT release_version FROM system.local")
                cl.shutdown()
            await asyncio.to_thread(_test)
            return {"success": True, "connection": {"contact_points": config.host}, "message": "Cassandra OK"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _execute_cassandra_query(self, connection: Dict, query: str, params: Optional[Dict]) -> Dict[str, Any]:
        try:
            from cassandra.cluster import Cluster  # type: ignore
        except ImportError:
            return {"success": False, "error": "cassandra-driver not installed"}
        cfg = connection["config"]
        if not (query or "").strip():
            return {"success": False, "error": "CQL query required"}
        try:
            def _run():
                points = [h.strip() for h in cfg.host.split(",")]
                cl = Cluster(points, port=cfg.port or 9042)
                sess = cl.connect(cfg.database) if cfg.database else cl.connect()
                if cfg.username and cfg.password:
                    pass  # auth_provider would be needed for full auth
                rows = sess.execute(query)
                data = [dict(r._asdict()) for r in rows]
                cols = list(data[0].keys()) if data else []
                cl.shutdown()
                return data, cols

            data, cols = await asyncio.to_thread(_run)
            return {"success": True, "data": data, "columns": cols, "row_count": len(data), "query_id": f"cas_{int(datetime.now().timestamp())}"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _get_cassandra_schema(self, connection: Dict, table_name: Optional[str]) -> Dict[str, Any]:
        try:
            from cassandra.cluster import Cluster  # type: ignore
        except ImportError:
            return {"success": False, "error": "cassandra-driver not installed"}
        cfg = connection["config"]
        ks = cfg.database or "system_schema"

        def _tables():
            points = [h.strip() for h in cfg.host.split(",")]
            cl = Cluster(points, port=cfg.port or 9042)
            sess = cl.connect()
            q = "SELECT keyspace_name, table_name, column_name, type FROM system_schema.columns WHERE keyspace_name = %s"
            rows = sess.execute(q, (ks,))
            tables: Dict[str, List[Dict]] = {}
            for r in rows:
                tname = f"{r.keyspace_name}.{r.table_name}"
                if table_name and table_name not in tname:
                    continue
                tables.setdefault(tname, []).append({"name": r.column_name, "type": r.type})
            cl.shutdown()
            return [{"name": k, "columns": v} for k, v in tables.items()]

        try:
            tables = await asyncio.to_thread(_tables)
            return {"success": True, "tables": tables[:200]}
        except Exception as e:
            return {"success": False, "error": str(e)}

    # Generic methods
    async def _execute_generic_query(
        self, connection: Dict, query: str, params: Optional[Dict]
    ) -> Dict[str, Any]:
        """Execute generic query"""
        return {
            "success": False,
            "error": f"Generic query execution not supported for {connection['config'].connector_type.value}",
        }

    async def _get_generic_schema(
        self, connection: Dict, table_name: Optional[str]
    ) -> Dict[str, Any]:
        """Get generic schema"""
        return {
            "success": False,
            "error": f"Generic schema retrieval not supported for {connection['config'].connector_type.value}",
        }

    async def _save_connection_to_db(
        self, connection_id: str, config: ConnectionConfig, connection_result: Dict
    ) -> None:
        """Save connection to database"""
        try:
            from src.modules.data.models import DataSource
            from src.db.session import async_session

            async with async_session() as db:
                # Create data source record
                # Encrypt stored connection_config for at-rest safety
                try:
                    stored_cfg = {
                        "connector_type": config.connector_type.value,
                        "host": config.host,
                        "port": config.port,
                        "database": config.database,
                        "schema": config.schema,
                        "ssl_enabled": config.ssl_enabled,
                        "timeout": config.timeout,
                    }
                    stored_cfg_enc = encrypt_credentials(stored_cfg)
                except Exception:
                    stored_cfg_enc = {
                        "connector_type": config.connector_type.value,
                        "host": config.host,
                        "port": config.port,
                        "database": config.database,
                        "schema": config.schema,
                        "ssl_enabled": config.ssl_enabled,
                        "timeout": config.timeout,
                    }

                data_source = DataSource(
                    id=connection_id,
                    name=config.name,
                    type="enterprise_connector",
                    format=config.connector_type.value,
                    db_type=config.connector_type.value,
                    connection_config=json.dumps(stored_cfg_enc),
                    metadata=json.dumps(
                        {
                            "connection_type": "enterprise",
                            "created_at": datetime.now().isoformat(),
                            "status": "active",
                        }
                    ),
                    is_active=True,
                    created_at=datetime.now(),
                    updated_at=datetime.now(),
                )

                db.add(data_source)
                await db.commit()

                logger.info(
                    f"✅ Enterprise connection saved to database: {connection_id}"
                )

        except Exception as e:
            logger.error(f"❌ Failed to save connection to database: {str(e)}")

    async def _connect_postgresql(
        self, config: ConnectionConfig, test_only: bool = False
    ) -> Dict[str, Any]:
        """Simple PostgreSQL connector test using psycopg2 via thread to avoid blocking.

        Accepts `test_only` flag to match other connector signatures.
        """
        try:
            import psycopg2
            import psycopg2.extras

            def _test():
                conn = psycopg2.connect(
                    host=config.host,
                    port=config.port or 5432,
                    dbname=config.database,
                    user=config.username,
                    password=config.password,
                    connect_timeout=5,
                )
                cur = conn.cursor()
                cur.execute("SELECT 1")
                r = cur.fetchone()
                cur.close()
                conn.close()
                return r

            res = await asyncio.to_thread(_test)

            if test_only:
                return {"success": True, "connection": None, "message": "Postgres connection test successful"}

            # For non-test (create) flows, return a minimal connection info object
            connection_info = {
                "host": config.host,
                "port": config.port or 5432,
                "database": config.database,
                "user": config.username,
            }

            return {
                "success": True,
                "connection": connection_info,
                "message": "Postgres connection established",
            }
        except Exception as e:
            logger.error(f"❌ Postgres connection test failed: {e}")
            return {"success": False, "error": str(e)}

    async def list_connections(self) -> List[Dict[str, Any]]:
        """List all enterprise connections"""
        connections = []
        for conn_id, conn_data in self.connections.items():
            connections.append(
                {
                    "id": conn_id,
                    "name": conn_data["config"].name,
                    "type": conn_data["config"].connector_type.value,
                    "host": conn_data["config"].host,
                    "database": conn_data["config"].database,
                    "status": conn_data["status"],
                    "created_at": conn_data["created_at"],
                    "last_used": conn_data["last_used"],
                }
            )
        return connections

    async def delete_connection(self, connection_id: str) -> Dict[str, Any]:
        """Delete enterprise connection"""
        try:
            if connection_id in self.connections:
                del self.connections[connection_id]

            from src.modules.data.models import DataSource
            from src.db.session import async_session
            from sqlalchemy import select

            async with async_session() as db:
                q = select(DataSource).where(DataSource.id == connection_id)
                result = await db.execute(q)
                data_source = result.scalar_one_or_none()
                if data_source:
                    data_source.is_active = False
                    data_source.updated_at = datetime.now()
                    await db.commit()

            logger.info(f"✅ Enterprise connection deleted: {connection_id}")
            return {"success": True, "message": f"Connection {connection_id} deleted successfully"}
        except Exception as e:
            logger.error(f"❌ Failed to delete connection: {str(e)}")
            return {"success": False, "error": str(e)}

    # ------------------------------------------------------------------
    # IoT / Time-Series Connectors (EE)
    # ------------------------------------------------------------------

    async def _connect_influxdb(self, config: "ConnectionConfig", test_only: bool = False) -> Dict[str, Any]:
        """Connect to InfluxDB v2 via HTTP API token auth."""
        import aiohttp as _aiohttp
        token = (config.metadata or {}).get("influxdb_token") or config.token or ""
        org = (config.metadata or {}).get("influxdb_org") or ""
        host = f"{config.host or 'http://localhost'}:{config.port or 8086}"
        headers = {"Authorization": f"Token {token}", "Content-Type": "application/json"}
        try:
            async with _aiohttp.ClientSession(headers=headers) as session:
                async with session.get(f"{host}/api/v2/ping", timeout=_aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status not in (200, 204):
                        return {"success": False, "error": f"InfluxDB ping returned HTTP {resp.status}"}
            return {"success": True, "connection": {"host": host, "org": org}, "message": "InfluxDB connection successful"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _execute_influxdb_query(self, config: "ConnectionConfig", query: str) -> Dict[str, Any]:
        """Execute InfluxQL or Flux query against InfluxDB v2."""
        import aiohttp as _aiohttp
        token = (config.metadata or {}).get("influxdb_token") or config.token or ""
        org = (config.metadata or {}).get("influxdb_org") or ""
        bucket = (config.metadata or {}).get("influxdb_bucket") or ""
        host = f"{config.host or 'http://localhost'}:{config.port or 8086}"
        headers = {"Authorization": f"Token {token}", "Accept": "application/csv"}
        # Use Flux query endpoint
        flux_query = query if "from(bucket:" in query else f'from(bucket:"{bucket}") |> range(start: -1h) |> filter(fn: (r) => true)'
        try:
            async with _aiohttp.ClientSession() as session:
                async with session.post(
                    f"{host}/api/v2/query",
                    params={"org": org},
                    headers=headers,
                    json={"query": flux_query, "type": "flux"},
                    timeout=_aiohttp.ClientTimeout(total=30),
                ) as resp:
                    csv_text = await resp.text()
                    # Parse CSV into list of dicts
                    rows = [line.split(",") for line in csv_text.strip().split("\n") if line and not line.startswith("#")]
                    if len(rows) < 2:
                        return {"success": True, "data": [], "columns": []}
                    headers_row = rows[0]
                    data = [dict(zip(headers_row, row)) for row in rows[1:]]
                    return {"success": True, "data": data, "columns": headers_row, "row_count": len(data)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _get_influxdb_schema(self, config: "ConnectionConfig") -> Dict[str, Any]:
        """Return InfluxDB measurements as logical tables with tag keys as columns."""
        import aiohttp as _aiohttp
        token = (config.metadata or {}).get("influxdb_token") or config.token or ""
        org = (config.metadata or {}).get("influxdb_org") or ""
        bucket = (config.metadata or {}).get("influxdb_bucket") or ""
        host = f"{config.host or 'http://localhost'}:{config.port or 8086}"
        headers = {"Authorization": f"Token {token}"}
        try:
            async with _aiohttp.ClientSession() as session:
                async with session.get(
                    f"{host}/api/v2/buckets/{bucket}/measurements",
                    params={"org": org},
                    headers=headers,
                    timeout=_aiohttp.ClientTimeout(total=10),
                ) as resp:
                    if resp.status == 200:
                        body = await resp.json()
                        measurements = body.get("measurements", [])
                    else:
                        measurements = []
            return {
                "success": True,
                "tables": [
                    {"name": m, "columns": ["_time", "_value", "_field", "_measurement"]}
                    for m in measurements
                ],
            }
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _connect_prometheus(self, config: "ConnectionConfig", test_only: bool = False) -> Dict[str, Any]:
        """Test connectivity to a Prometheus HTTP API endpoint."""
        import aiohttp as _aiohttp
        url = (config.metadata or {}).get("prometheus_url") or f"http://{config.host or 'localhost'}:{config.port or 9090}"
        try:
            async with _aiohttp.ClientSession() as session:
                async with session.get(f"{url}/-/healthy", timeout=_aiohttp.ClientTimeout(total=5)) as resp:
                    if resp.status != 200:
                        return {"success": False, "error": f"Prometheus health check returned HTTP {resp.status}"}
            return {"success": True, "connection": {"url": url}, "message": "Prometheus connection successful"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _execute_prometheus_query(self, config: "ConnectionConfig", query: str, start: str = "", end: str = "", step: str = "60s") -> Dict[str, Any]:
        """Execute a PromQL range query and pivot to tabular format."""
        import aiohttp as _aiohttp
        url = (config.metadata or {}).get("prometheus_url") or f"http://{config.host or 'localhost'}:{config.port or 9090}"
        try:
            params: Dict[str, str] = {"query": query}
            if start:
                params.update({"start": start, "end": end or start, "step": step})
                endpoint = f"{url}/api/v1/query_range"
            else:
                endpoint = f"{url}/api/v1/query"
            async with _aiohttp.ClientSession() as session:
                async with session.get(endpoint, params=params, timeout=_aiohttp.ClientTimeout(total=30)) as resp:
                    body = await resp.json()
                    http_status = resp.status
            if http_status != 200:
                return {"success": False, "error": f"Prometheus HTTP {http_status}: {body}"}
            if body.get("status") == "error":
                return {
                    "success": False,
                    "error": body.get("error") or body.get("errorType") or str(body),
                }
            result_type = body.get("data", {}).get("resultType", "")
            results = body.get("data", {}).get("result", [])
            rows = []
            for series in results:
                metric = series.get("metric", {})
                values = series.get("values") or ([series.get("value")] if "value" in series else [])
                for ts, val in values:
                    row = {"__timestamp": ts, "__value": val}
                    row.update(metric)
                    rows.append(row)
            cols = list(rows[0].keys()) if rows else ["__timestamp", "__value"]
            return {"success": True, "data": rows, "columns": cols, "row_count": len(rows)}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _connect_opensearch(self, config: "ConnectionConfig", test_only: bool = False) -> Dict[str, Any]:
        """Test connectivity to OpenSearch / Elasticsearch."""
        import aiohttp as _aiohttp
        host = f"http://{config.host or 'localhost'}:{config.port or 9200}"
        auth = None
        if config.username and config.password:
            auth = _aiohttp.BasicAuth(config.username, config.password)
        try:
            async with _aiohttp.ClientSession() as session:
                async with session.get(f"{host}/_cluster/health", auth=auth, timeout=_aiohttp.ClientTimeout(total=5)) as resp:
                    body = await resp.json()
                    status = body.get("status", "unknown")
                    if status == "red":
                        return {"success": False, "error": f"Cluster health is RED: {body}"}
            return {"success": True, "connection": {"host": host, "status": status}, "message": "OpenSearch/Elasticsearch connection successful"}
        except Exception as e:
            return {"success": False, "error": str(e)}

    async def _execute_elasticsearch_query(self, config: "ConnectionConfig", query: str, index: str = "*") -> Dict[str, Any]:
        """Execute an OpenSearch/Elasticsearch DSL query and return tabular hits."""
        import aiohttp as _aiohttp
        import json as _json
        host = f"http://{config.host or 'localhost'}:{config.port or 9200}"
        auth = None
        if config.username and config.password:
            auth = _aiohttp.BasicAuth(config.username, config.password)
        try:
            # Try to parse as JSON DSL; fall back to match_all
            try:
                dsl = _json.loads(query)
            except Exception:
                dsl = {"query": {"query_string": {"query": query}}, "size": 100}
            async with _aiohttp.ClientSession() as session:
                async with session.post(
                    f"{host}/{index}/_search",
                    auth=auth,
                    json=dsl,
                    headers={"Content-Type": "application/json"},
                    timeout=_aiohttp.ClientTimeout(total=30),
                ) as resp:
                    body = await resp.json()
            hits = body.get("hits", {}).get("hits", [])
            rows = [{"_id": h["_id"], "_index": h["_index"], **h.get("_source", {})} for h in hits]
            cols = list(rows[0].keys()) if rows else ["_id", "_index"]
            return {"success": True, "data": rows, "columns": cols, "row_count": len(rows)}
        except Exception as e:
            return {"success": False, "error": str(e)}
