"""
Real Data Source Service
Production-ready data source management for Aiser Platform
"""

import os
import yaml
from typing import Dict, List, Any, Optional
from datetime import datetime
import logging
from dataclasses import dataclass

import psycopg2
import pymysql
import redis
try:
    import boto3
except Exception:
    boto3 = None
try:
    from azure.storage.blob import BlobServiceClient
except Exception:
    BlobServiceClient = None
try:
    from google.cloud import storage as gcs
except Exception:
    gcs = None
import requests
import pandas as pd
from src.modules.data.utils.credentials import decrypt_credentials
import time as _time

from src.modules.data.models import DataSource

logger = logging.getLogger(__name__)


@dataclass
class ConnectionResult:
    """Connection test result"""

    success: bool
    message: str
    connection_time: float
    metadata: Dict[str, Any] = None


@dataclass
class QueryResult:
    """Query execution result"""

    success: bool
    data: List[Dict[str, Any]]
    columns: List[str]
    row_count: int
    execution_time: float
    error_message: Optional[str] = None


class RealDataSourceManager:
    """Real data source manager with production-ready connections"""

    def __init__(self):
        self.connection_pools = {}
        self.templates = self._load_data_source_templates()

    def _load_data_source_templates(self) -> Dict[str, Any]:
        """Load data source templates from configuration"""
        try:
            template_path = os.path.join(
                os.path.dirname(__file__),
                "..",
                "..",
                "..",
                "..",
                "config",
                "data-sources",
                "production-templates.yaml",
            )

            if os.path.exists(template_path):
                with open(template_path, "r") as f:
                    return yaml.safe_load(f)
            else:
                logger.warning("Data source templates not found, using defaults")
                return self._get_default_templates()

        except Exception as e:
            logger.error(f"Error loading data source templates: {e}")
            return self._get_default_templates()

    def _get_default_templates(self) -> Dict[str, Any]:
        """Get default data source templates"""
        return {
            "databases": {
                "postgresql": {
                    "name": "PostgreSQL Database",
                    "type": "database",
                    "format": "postgresql",
                    "connection_config": {
                        "host": "postgres",
                        "port": 5432,
                        "database": "aiser_production",
                        "username": "aiser_admin",
                        "password": "${POSTGRES_PASSWORD}",
                        "ssl_mode": "require",
                    },
                }
            }
        }

    async def test_connection(self, data_source: DataSource) -> ConnectionResult:
        """Test connection to data source"""
        start_time = datetime.now()

        try:
            cfg = data_source.connection_config or {}
            if cfg.get("skip_connection_test") or cfg.get("metadata_only"):
                end_time = datetime.now()
                return ConnectionResult(
                    success=True,
                    message="Metadata-only / BI mirror — connection test skipped",
                    connection_time=(end_time - start_time).total_seconds(),
                )

            if data_source.type == "database":
                result = await self._test_database_connection(data_source)
            elif data_source.type == "file_storage":
                result = await self._test_file_storage_connection(data_source)
            elif data_source.type == "api":
                result = await self._test_api_connection(data_source)
            elif data_source.type == "streaming":
                result = await self._test_streaming_connection(data_source)
            else:
                result = ConnectionResult(
                    success=False,
                    message=f"Unsupported data source type: {data_source.type}",
                    connection_time=0,
                )

            end_time = datetime.now()
            result.connection_time = (end_time - start_time).total_seconds()

            return result

        except Exception as e:
            logger.error(f"Error testing connection: {e}")
            return ConnectionResult(
                success=False,
                message=str(e),
                connection_time=(datetime.now() - start_time).total_seconds(),
            )

    async def _test_database_connection(
        self, data_source: DataSource
    ) -> ConnectionResult:
        """Test database connection with decryption and retry/backoff."""
        try:
            # Decrypt configuration if stored encrypted
            config = data_source.connection_config or {}
            try:
                config = decrypt_credentials(config)
            except Exception:
                logger.debug("Decrypt skipped/failed for data source config")

            # Retry loop for flaky network/connectivity
            attempts = int(os.getenv("DB_CONN_RETRIES", "3"))
            base_delay = float(os.getenv("DB_CONN_RETRY_BASE_DELAY", "0.5"))

            last_err = None
            for attempt in range(1, attempts + 1):
                try:
                    if data_source.format == "postgresql":
                        # Test PostgreSQL connection
                        conn = psycopg2.connect(
                            host=config.get("host"),
                            port=config.get("port"),
                            database=config.get("database"),
                            user=config.get("username"),
                            password=config.get("password"),
                            connect_timeout=10,
                            sslmode=config.get("ssl_mode", "prefer"),
                        )
                        cursor = conn.cursor()
                        cursor.execute("SELECT version();")
                        version = cursor.fetchone()[0]
                        cursor.close()
                        conn.close()

                        return ConnectionResult(
                            success=True,
                            message="PostgreSQL connection successful",
                            connection_time=0,
                            metadata={"version": version},
                        )

                    elif data_source.format == "mysql":
                        conn = pymysql.connect(
                            host=config.get("host"),
                            port=config.get("port"),
                            database=config.get("database"),
                            user=config.get("username"),
                            password=config.get("password"),
                            connect_timeout=10,
                        )
                        cursor = conn.cursor()
                        cursor.execute("SELECT VERSION();")
                        version = cursor.fetchone()[0]
                        cursor.close()
                        conn.close()

                        return ConnectionResult(
                            success=True,
                            message="MySQL connection successful",
                            connection_time=0,
                            metadata={"version": version},
                        )

                    else:
                        return ConnectionResult(
                            success=False,
                            message=f"Unsupported database format: {data_source.format}",
                            connection_time=0,
                        )

                except Exception as e:
                    last_err = e
                    logger.warning(f"DB test attempt {attempt} failed: {e}")
                    _time.sleep(base_delay * (2 ** (attempt - 1)))

            return ConnectionResult(
                success=False,
                message=f"Database connection failed after {attempts} attempts: {last_err}",
                connection_time=0,
            )

        except Exception as e:
            return ConnectionResult(
                success=False,
                message=f"Database connection failed: {str(e)}",
                connection_time=0,
            )

    async def _test_file_storage_connection(
        self, data_source: DataSource
    ) -> ConnectionResult:
        """Test file storage connection"""
        try:
            config = data_source.connection_config

            if data_source.format == "s3":
                # Test S3 connection
                s3_client = boto3.client(
                    "s3",
                    aws_access_key_id=config["access_key_id"],
                    aws_secret_access_key=config["secret_access_key"],
                    region_name=config["region"],
                )

                # Test bucket access
                s3_client.head_bucket(Bucket=config["bucket"])

                return ConnectionResult(
                    success=True,
                    message="S3 connection successful",
                    connection_time=0,
                    metadata={"bucket": config["bucket"], "region": config["region"]},
                )

            elif data_source.format == "azure_blob":
                # Test Azure Blob connection
                blob_service = BlobServiceClient.from_connection_string(
                    config["connection_string"]
                )

                # Test container access
                container_client = blob_service.get_container_client(
                    config["container"]
                )
                container_client.get_container_properties()

                return ConnectionResult(
                    success=True,
                    message="Azure Blob connection successful",
                    connection_time=0,
                    metadata={"container": config["container"]},
                )

            elif data_source.format == "gcs":
                # Test GCS connection
                gcs_client = gcs.Client.from_service_account_json(
                    config["credentials_path"]
                )

                # Test bucket access
                bucket = gcs_client.bucket(config["bucket"])
                bucket.reload()

                return ConnectionResult(
                    success=True,
                    message="GCS connection successful",
                    connection_time=0,
                    metadata={"bucket": config["bucket"]},
                )

            else:
                return ConnectionResult(
                    success=False,
                    message=f"Unsupported file storage format: {data_source.format}",
                    connection_time=0,
                )

        except Exception as e:
            return ConnectionResult(
                success=False,
                message=f"File storage connection failed: {str(e)}",
                connection_time=0,
            )

    async def _test_api_connection(self, data_source: DataSource) -> ConnectionResult:
        """Test API connection"""
        try:
            config = data_source.connection_config

            # Prepare headers
            headers = config.get("headers", {})
            if config.get("auth_type") == "bearer":
                headers["Authorization"] = f"Bearer {config['api_key']}"
            elif config.get("auth_type") == "api_key":
                headers["X-API-Key"] = config["api_key"]

            # Test API endpoint
            response = requests.get(
                config["base_url"], headers=headers, timeout=config.get("timeout", 30)
            )

            if response.status_code == 200:
                return ConnectionResult(
                    success=True,
                    message="API connection successful",
                    connection_time=0,
                    metadata={
                        "status_code": response.status_code,
                        "response_size": len(response.content),
                    },
                )
            else:
                return ConnectionResult(
                    success=False,
                    message=f"API connection failed with status {response.status_code}",
                    connection_time=0,
                )

        except Exception as e:
            return ConnectionResult(
                success=False,
                message=f"API connection failed: {str(e)}",
                connection_time=0,
            )

    async def _test_streaming_connection(
        self, data_source: DataSource
    ) -> ConnectionResult:
        """Test streaming connection"""
        try:
            config = data_source.connection_config

            if data_source.format == "kafka":
                # Test Kafka connection
                from kafka import KafkaProducer

                producer = KafkaProducer(
                    bootstrap_servers=config["bootstrap_servers"],
                    security_protocol=config["security_protocol"],
                    sasl_mechanism=config["sasl_mechanism"],
                    sasl_plain_username=config["sasl_username"],
                    sasl_plain_password=config["sasl_password"],
                )

                # Test producer
                future = producer.send("test-topic", b"test message")
                record_metadata = future.get(timeout=10)

                producer.close()

                return ConnectionResult(
                    success=True,
                    message="Kafka connection successful",
                    connection_time=0,
                    metadata={
                        "topic": record_metadata.topic,
                        "partition": record_metadata.partition,
                    },
                )

            elif data_source.format == "redis":
                # Test Redis connection
                redis_client = redis.Redis(
                    host=config["host"],
                    port=config["port"],
                    password=config.get("password"),
                    db=config.get("db", 0),
                    ssl=config.get("ssl", False),
                )

                # Test connection
                redis_client.ping()

                return ConnectionResult(
                    success=True,
                    message="Redis connection successful",
                    connection_time=0,
                    metadata={"host": config["host"], "port": config["port"]},
                )

            else:
                return ConnectionResult(
                    success=False,
                    message=f"Unsupported streaming format: {data_source.format}",
                    connection_time=0,
                )

        except Exception as e:
            return ConnectionResult(
                success=False,
                message=f"Streaming connection failed: {str(e)}",
                connection_time=0,
            )

    async def execute_query(self, data_source: DataSource, query: str) -> QueryResult:
        """Execute query on data source"""
        start_time = datetime.now()

        try:
            if data_source.type == "database":
                result = await self._execute_database_query(data_source, query)
            elif data_source.type == "api":
                result = await self._execute_api_query(data_source, query)
            else:
                result = QueryResult(
                    success=False,
                    data=[],
                    columns=[],
                    row_count=0,
                    execution_time=0,
                    error_message=f"Query execution not supported for type: {data_source.type}",
                )

            end_time = datetime.now()
            result.execution_time = (end_time - start_time).total_seconds()

            return result

        except Exception as e:
            logger.error(f"Error executing query: {e}")
            return QueryResult(
                success=False,
                data=[],
                columns=[],
                row_count=0,
                execution_time=(datetime.now() - start_time).total_seconds(),
                error_message=str(e),
            )

    async def _execute_database_query(
        self, data_source: DataSource, query: str
    ) -> QueryResult:
        """Execute database query"""
        try:
            config = data_source.connection_config or {}
            try:
                config = decrypt_credentials(config)
            except Exception:
                logger.debug("Failed to decrypt connection config for query execution; proceeding with raw config")

            if data_source.format == "postgresql":
                # Execute PostgreSQL query
                conn = psycopg2.connect(
                    host=config["host"],
                    port=config["port"],
                    database=config["database"],
                    user=config["username"],
                    password=config["password"],
                    sslmode=config.get("ssl_mode", "prefer"),
                )

                # Execute query
                df = pd.read_sql(query, conn)
                conn.close()

                return QueryResult(
                    success=True,
                    data=df.to_dict("records"),
                    columns=df.columns.tolist(),
                    row_count=len(df),
                    execution_time=0,
                )

            elif data_source.format == "mysql":
                # Execute MySQL query
                conn = pymysql.connect(
                    host=config["host"],
                    port=config["port"],
                    database=config["database"],
                    user=config["username"],
                    password=config["password"],
                    ssl_disabled=False,
                )

                # Execute query
                df = pd.read_sql(query, conn)
                conn.close()

                return QueryResult(
                    success=True,
                    data=df.to_dict("records"),
                    columns=df.columns.tolist(),
                    row_count=len(df),
                    execution_time=0,
                )

            else:
                return QueryResult(
                    success=False,
                    data=[],
                    columns=[],
                    row_count=0,
                    execution_time=0,
                    error_message=f"Unsupported database format: {data_source.format}",
                )

        except Exception as e:
            return QueryResult(
                success=False,
                data=[],
                columns=[],
                row_count=0,
                execution_time=0,
                error_message=str(e),
            )

    async def _execute_api_query(
        self, data_source: DataSource, query: str
    ) -> QueryResult:
        """Execute API query"""
        try:
            config = data_source.connection_config

            # Prepare headers
            headers = config.get("headers", {})
            if config.get("auth_type") == "bearer":
                headers["Authorization"] = f"Bearer {config['api_key']}"
            elif config.get("auth_type") == "api_key":
                headers["X-API-Key"] = config["api_key"]

            # Execute API request
            response = requests.get(
                config["base_url"], headers=headers, timeout=config.get("timeout", 30)
            )

            if response.status_code == 200:
                data = response.json()

                # Convert to list of records if needed
                if isinstance(data, dict):
                    data = [data]
                elif not isinstance(data, list):
                    data = [{"value": data}]

                # Extract columns
                columns = list(data[0].keys()) if data else []

                return QueryResult(
                    success=True,
                    data=data,
                    columns=columns,
                    row_count=len(data),
                    execution_time=0,
                )
            else:
                return QueryResult(
                    success=False,
                    data=[],
                    columns=[],
                    row_count=0,
                    execution_time=0,
                    error_message=f"API request failed with status {response.status_code}",
                )

        except Exception as e:
            return QueryResult(
                success=False,
                data=[],
                columns=[],
                row_count=0,
                execution_time=0,
                error_message=str(e),
            )

    async def get_schema(self, data_source: DataSource) -> Dict[str, Any]:
        """Get schema information from data source"""
        try:
            if data_source.type == "database":
                return await self._get_database_schema(data_source)
            else:
                return {
                    "error": f"Schema retrieval not supported for type: {data_source.type}"
                }

        except Exception as e:
            logger.error(f"Error getting schema: {e}")
            return {"error": str(e)}

    async def _get_database_schema(self, data_source: DataSource) -> Dict[str, Any]:
        """Get database schema"""
        try:
            config = data_source.connection_config

            if data_source.format == "postgresql":
                # Get PostgreSQL schema
                conn = psycopg2.connect(
                    host=config["host"],
                    port=config["port"],
                    database=config["database"],
                    user=config["username"],
                    password=config["password"],
                    sslmode=config.get("ssl_mode", "prefer"),
                )

                # Get tables and columns
                schema_query = """
                SELECT 
                    table_name,
                    column_name,
                    data_type,
                    is_nullable,
                    column_default
                FROM information_schema.columns 
                WHERE table_schema = 'public'
                ORDER BY table_name, ordinal_position;
                """

                df = pd.read_sql(schema_query, conn)
                conn.close()

                # Group by table
                schema = {}
                for _, row in df.iterrows():
                    table_name = row["table_name"]
                    if table_name not in schema:
                        schema[table_name] = []

                    schema[table_name].append(
                        {
                            "column_name": row["column_name"],
                            "data_type": row["data_type"],
                            "is_nullable": row["is_nullable"],
                            "column_default": row["column_default"],
                        }
                    )

                return schema

            else:
                return {
                    "error": f"Schema retrieval not supported for format: {data_source.format}"
                }

        except Exception as e:
            return {"error": str(e)}

    async def create_data_source_from_template(
        self,
        template_name: str,
        template_type: str,
        custom_config: Dict[str, Any] = None,
    ) -> DataSource:
        """Create data source from template"""
        try:
            # Get template
            template = self.templates.get(template_type, {}).get(template_name)
            if not template:
                raise ValueError(f"Template not found: {template_type}.{template_name}")

            # Create data source
            data_source = DataSource(
                name=template["name"],
                type=template["type"],
                format=template["format"],
                description=template["description"],
                connection_config=template["connection_config"],
                is_active=True,
            )

            # Apply custom configuration
            if custom_config:
                data_source.connection_config.update(custom_config)

            return data_source

        except Exception as e:
            logger.error(f"Error creating data source from template: {e}")
            raise


# Global instance
real_data_source_manager = RealDataSourceManager()
