"""
Unified Database Connector Service
Direct SQLAlchemy connections for all supported databases

This service provides direct SQLAlchemy-based connections to supported databases.
It replaces the previous Cube.js-based architecture with simpler, more maintainable
direct connections.

Supported Databases:
    - PostgreSQL (via asyncpg)
    - MySQL (via aiomysql)
    - ClickHouse (via HTTP API)
    - SQL Server (via aioodbc)
    - Snowflake (direct connector)
    - BigQuery (google-cloud SDK)
    - Redshift (via asyncpg)

Features:
    - Connection pooling
    - Credential encryption
    - Schema introspection
    - Query execution
    - Error handling and logging
"""

import logging
import asyncio
import os
import aiohttp
from typing import Dict, List, Any, Optional
from datetime import datetime
from sqlalchemy import create_engine, inspect, text, MetaData
from sqlalchemy.ext.asyncio import create_async_engine, AsyncEngine
from sqlalchemy.pool import QueuePool
from sqlalchemy.engine import URL

# Database drivers
try:
    import psycopg2
except ImportError:
    psycopg2 = None

try:
    import pymysql
except ImportError:
    pymysql = None

try:
    import snowflake.connector
except ImportError:
    snowflake = None

try:
    from google.cloud import bigquery
except ImportError:
    bigquery = None

try:
    import pyodbc
except ImportError:
    pyodbc = None

logger = logging.getLogger(__name__)


class DatabaseConnectorService:
    """Unified service for database connections using SQLAlchemy"""
    
    def __init__(self):
        self.active_engines = {}  # Cache of active SQLAlchemy engines
        
        # Database configuration
        self.database_configs = {
            'postgresql': {
                'driver': 'postgresql+asyncpg',
                'sync_driver': 'postgresql+psycopg2',
                'default_port': 5432,
                'connection_string': '{driver}://{username}:{password}@{host}:{port}/{database}',
            },
            'mysql': {
                'driver': 'mysql+aiomysql',
                'sync_driver': 'mysql+pymysql',
                'default_port': 3306,
                'connection_string': '{driver}://{username}:{password}@{host}:{port}/{database}',
            },
            'sqlserver': {
                'driver': 'mssql+aioodbc',
                'sync_driver': 'mssql+pyodbc',
                'default_port': 1433,
                'connection_string': '{driver}://{username}:{password}@{host}:{port}/{database}',
            },
            'snowflake': {
                'driver': 'snowflake',
                'default_port': 443,
                'connection_string': 'snowflake://{username}:{password}@{account}/{database}/{schema}?warehouse={warehouse}',
            },
            'bigquery': {
                'driver': 'bigquery',
                'default_port': None,
                'connection_string': 'bigquery://{project_id}/{dataset}',
            },
            'redshift': {
                'driver': 'postgresql+asyncpg',
                'sync_driver': 'postgresql+psycopg2',
                'default_port': 5439,
                'connection_string': '{driver}://{username}:{password}@{host}:{port}/{database}',
            },
            'clickhouse': {
                'driver': 'clickhouse+asynch',
                'sync_driver': 'clickhouse+native',
                'default_port': 8123,
                'connection_string': '{driver}://{username}:{password}@{host}:{port}/{database}',
                'http_api': True,  # ClickHouse also supports HTTP API
            },
            'duckdb': {
                'driver': 'duckdb',
                'default_port': None,
                'connection_string': 'duckdb:///{path}',
                'file_based': True,
            },
            # IoT / time-series — connected via HTTP API, not SQLAlchemy driver
            'influxdb': {
                'driver': 'influxdb_http',
                'default_port': 8086,
                'connection_string': 'http://{host}:{port}',
                'http_api': True,
            },
            'prometheus_source': {
                'driver': 'prometheus_http',
                'default_port': 9090,
                'connection_string': 'http://{host}:{port}',
                'http_api': True,
            },
            'opensearch': {
                'driver': 'opensearch_http',
                'default_port': 9200,
                'connection_string': 'http://{host}:{port}',
                'http_api': True,
            },
            'elasticsearch': {
                'driver': 'elasticsearch_http',
                'default_port': 9200,
                'connection_string': 'http://{host}:{port}',
                'http_api': True,
            },
        }
    
    async def test_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Test database connection using appropriate method for each database type"""
        try:
            db_type = config.get('type', '').lower()
            
            if db_type not in self.database_configs:
                return {
                    'success': False,
                    'error': f'Unsupported database type: {db_type}'
                }
            
            logger.info("Testing %s connection (host redacted)", db_type)
            
            # Use HTTP API for ClickHouse
            if db_type == 'clickhouse':
                return await self._test_clickhouse_http(config)
            # DuckDB: file-based, test via native library
            if db_type == 'duckdb':
                return await self._test_duckdb_connection(config)
            # Use direct driver test for other databases
            return await self._test_direct_connection(config)
            
        except Exception as e:
            logger.error(f"❌ Connection test failed: {str(e)}")
            return {
                'success': False,
                'error': f'Connection test failed: {str(e)}'
            }
    
    async def _test_direct_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Test database connection using direct drivers"""
        try:
            db_type = config.get('type', '').lower()
            host = config.get('host')
            port = config.get('port', self.database_configs[db_type]['default_port'])
            database = config.get('database')
            username = config.get('username')
            password = config.get('password')
            
            # PostgreSQL / Redshift
            if db_type in ['postgresql', 'redshift']:
                if not psycopg2:
                    return {'success': False, 'error': 'psycopg2 not installed'}
                
                # Get SSL mode from config if provided
                ssl_mode = config.get('ssl_mode', 'prefer')
                
                # Build connection parameters
                conn_params = {
                    'host': host,
                    'port': port,
                    'database': database,
                    'user': username,
                    'password': password,
                    'connect_timeout': 10
                }
                
                # Add SSL mode if specified
                if ssl_mode and ssl_mode != 'disable':
                    conn_params['sslmode'] = ssl_mode
                
                conn = psycopg2.connect(**conn_params)
                conn.close()
                
            # MySQL
            elif db_type == 'mysql':
                if not pymysql:
                    return {'success': False, 'error': 'pymysql not installed'}
                
                # Get SSL mode from config if provided
                ssl_mode = config.get('ssl_mode', 'prefer')
                
                # Build connection parameters
                conn_params = {
                    'host': host,
                    'port': port,
                    'database': database,
                    'user': username,
                    'password': password,
                    'connect_timeout': 10
                }
                
                # Handle SSL mode for MySQL
                # PyMySQL doesn't support sslmode parameter directly
                # It uses ssl_disabled (bool) or ssl (dict) parameters
                # ssl_mode values: 'disable', 'prefer', 'require', 'verify-ca', 'verify-identity'
                if ssl_mode == 'disable':
                    # Explicitly disable SSL
                    conn_params['ssl_disabled'] = True
                elif ssl_mode in ['require', 'verify-ca', 'verify-identity']:
                    # For require/verify modes, enable SSL with appropriate verification
                    # PyMySQL's ssl parameter accepts a dict with SSL options
                    ssl_dict = {}
                    if ssl_mode in ['verify-ca', 'verify-identity']:
                        # For verify modes, we'd need CA certs, but for now use basic SSL
                        # In production, you'd want to pass actual cert paths
                        ssl_dict['check_hostname'] = (ssl_mode == 'verify-identity')
                    conn_params['ssl'] = ssl_dict if ssl_dict else {}
                # 'prefer' mode: don't set ssl_disabled or ssl, let pymysql negotiate SSL if available
                # This is the default behavior - pymysql will use SSL if server supports it
                
                conn = pymysql.connect(**conn_params)
                cursor = conn.cursor()
                cursor.execute("SELECT VERSION()")
                cursor.fetchone()
                cursor.close()
                conn.close()
            
            # SQL Server
            elif db_type == 'sqlserver':
                if not pyodbc:
                    return {'success': False, 'error': 'pyodbc not installed'}
                
                # Host required (when app runs in Docker, use service name e.g. sqlserver not localhost)
                if not host:
                    return {
                        'success': False,
                        'error': "SQL Server host is required. When the app runs in Docker, use host 'sqlserver' (service name), not 'localhost'."
                    }
                
                # Get ODBC driver from config or use default (never None — unixODBC would try to open lib 'None')
                odbc_driver = config.get('driver') or 'ODBC Driver 18 for SQL Server'
                conn_timeout = config.get('connection_timeout', 30)
                if not isinstance(conn_timeout, (int, float)) or conn_timeout < 5:
                    conn_timeout = 30
                conn_timeout = min(int(conn_timeout), 120)
                
                # Build connection string for SQL Server
                # Format: DRIVER={driver};SERVER=host,port;DATABASE=database;UID=username;PWD=password
                conn_str_parts = [
                    f"DRIVER={{{odbc_driver}}}",
                    f"SERVER={host},{port}",
                    f"DATABASE={database}",
                    f"UID={username}",
                    f"PWD={password}",
                    f"Connection Timeout={conn_timeout}"
                ]
                
                # Add additional connection options if provided
                if config.get('trust_server_certificate', True):  # Default to True for containerized SQL Server
                    conn_str_parts.append("TrustServerCertificate=yes")
                if config.get('encrypt'):
                    conn_str_parts.append(f"Encrypt={config.get('encrypt')}")
                
                conn_str = ";".join(conn_str_parts) + ";"
                
                conn = pyodbc.connect(conn_str)
                cursor = conn.cursor()
                cursor.execute("SELECT @@VERSION")
                cursor.fetchone()
                cursor.close()
                conn.close()
                
            # Snowflake
            elif db_type == 'snowflake':
                if not snowflake:
                    return {'success': False, 'error': 'snowflake-connector-python not installed'}
                
                import snowflake.connector
                conn = snowflake.connector.connect(
                    account=config.get('account'),
                    user=username,
                    password=password,
                    database=database,
                    warehouse=config.get('warehouse', 'COMPUTE_WH'),
                    schema=config.get('schema', 'PUBLIC')
                )
                conn.close()
                
            # BigQuery
            elif db_type == 'bigquery':
                if not bigquery:
                    return {'success': False, 'error': 'google-cloud-bigquery not installed'}
                
                from google.cloud import bigquery
                client = bigquery.Client(project=config.get('project_id'))
                # Test with simple query
                query = "SELECT 1"
                client.query(query).result()
                
            else:
                return {
                    'success': False,
                    'error': f'Direct connection test not implemented for {db_type}'
                }
            
            logger.info(f"✅ {db_type} connection test successful")
            return {
                'success': True,
                'message': f'{db_type} connection successful',
                'connection_info': {
                    'type': db_type,
                    'host': host,
                    'port': port,
                    'database': database,
                    'status': 'connected'
                }
            }
            
        except Exception as e:
            logger.error(f"❌ Direct connection test failed: {str(e)}")
            return {
                'success': False,
                'error': f'Connection failed: {str(e)}'
            }

    async def _test_duckdb_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Test DuckDB connection (file path). Path in config.database or config.host."""
        try:
            path = (config.get('database') or config.get('host') or '').strip()
            if not path:
                return {
                    'success': False,
                    'error': 'DuckDB requires a file path (use Database field for path to .duckdb file)',
                }
            # :memory: is valid for testing
            if path != ':memory:' and not os.path.isfile(path):
                return {
                    'success': False,
                    'error': f'DuckDB file not found: {path}',
                }
            import duckdb
            conn = await asyncio.to_thread(duckdb.connect, path, read_only=True)
            conn.close()
            return {'success': True, 'message': 'DuckDB connection successful', 'connection_info': {}}
        except Exception as e:
            logger.error(f"DuckDB connection test failed: {e}")
            return {'success': False, 'error': str(e)}

    async def _get_duckdb_schema(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Get DuckDB schema (tables and columns) via native library."""
        try:
            path = (config.get('database') or config.get('host') or '').strip()
            if not path:
                return {'success': False, 'error': 'DuckDB path required', 'tables': [], 'schemas': [], 'total_rows': 0}
            import duckdb
            conn = await asyncio.to_thread(duckdb.connect, path, read_only=True)
            try:
                # DuckDB: list tables from information_schema
                tables_sql = """
                    SELECT table_schema, table_name
                    FROM information_schema.tables
                    WHERE table_schema NOT IN ('information_schema', 'pg_catalog')
                    ORDER BY table_schema, table_name
                """
                tables_rows = await asyncio.to_thread(conn.execute, tables_sql)
                table_list = tables_rows.fetchall()
                tables = []
                schemas = set()
                for schema_name, table_name in table_list:
                    cols_sql = f"""
                        SELECT column_name, data_type, is_nullable
                        FROM information_schema.columns
                        WHERE table_schema = ? AND table_name = ?
                        ORDER BY ordinal_position
                    """
                    cols_rows = await asyncio.to_thread(conn.execute, cols_sql, [schema_name, table_name])
                    columns = [
                        {'name': row[0], 'type': str(row[1]), 'nullable': str(row[2]).upper() == 'YES'}
                        for row in cols_rows.fetchall()
                    ]
                    count_sql = f'SELECT COUNT(*) FROM "{schema_name}"."{table_name}"'
                    try:
                        count_rows = await asyncio.to_thread(conn.execute, count_sql)
                        row_count = count_rows.fetchone()[0] or 0
                    except Exception:
                        row_count = 0
                    tables.append({
                        'schema': schema_name,
                        'name': table_name,
                        'columns': columns,
                        'rowCount': int(row_count),
                    })
                    schemas.add(schema_name)
                total_rows = sum(t.get('rowCount', 0) for t in tables)
                return {
                    'success': True,
                    'tables': tables,
                    'schemas': list(schemas),
                    'total_rows': total_rows,
                }
            finally:
                conn.close()
        except Exception as e:
            logger.error(f"DuckDB schema failed: {e}")
            return {
                'success': False,
                'error': str(e),
                'tables': [],
                'schemas': [],
                'total_rows': 0,
            }

    async def _test_clickhouse_http(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Test ClickHouse connection via HTTP API"""
        try:
            host = config.get('host')
            port = config.get('port', 8123)
            database = config.get('database')
            username = config.get('username')
            password = config.get('password')
            
            http_url = f"http://{host}:{port}"
            query = "SELECT 1 FORMAT JSON"
            
            async with aiohttp.ClientSession() as session:
                auth = aiohttp.BasicAuth(username, password) if username else None
                async with session.post(f"{http_url}/", data=query, auth=auth, timeout=aiohttp.ClientTimeout(total=10)) as resp:
                    if resp.status == 200:
                        logger.info(f"✅ ClickHouse HTTP connection successful")
                        return {
                            'success': True,
                            'message': 'ClickHouse connection successful',
                            'connection_info': {
                                'type': 'clickhouse',
                                'host': host,
                                'port': port,
                                'database': database,
                                'status': 'connected'
                            }
                        }
                    else:
                        error_text = await resp.text()
                        return {
                            'success': False,
                            'error': f'ClickHouse HTTP error {resp.status}: {error_text}'
                        }
                        
        except Exception as e:
            logger.error(f"❌ ClickHouse HTTP test failed: {str(e)}")
            return {
                'success': False,
                'error': f'ClickHouse connection failed: {str(e)}'
            }
    
    async def create_connection(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Create and cache database connection engine"""
        try:
            db_type = config.get('type', '').lower()
            connection_id = config.get('id') or f"{db_type}_{config.get('database')}_{int(datetime.now().timestamp())}"
            
            # Test connection first
            test_result = await self.test_connection(config)
            if not test_result.get('success'):
                return test_result
            
            # For ClickHouse, we use HTTP API (no engine needed)
            if db_type == 'clickhouse':
                self.active_engines[connection_id] = {
                    'type': 'clickhouse_http',
                    'config': config,
                    'created_at': datetime.now()
                }
                return {
                    'success': True,
                    'connection_id': connection_id,
                    'message': 'ClickHouse connection created (HTTP API)'
                }
            
            # Create SQLAlchemy engine for other databases
            connection_string = self._build_connection_string(config)
            pool_size = config.get('pool_size') or config.get('min_connections', 5)
            max_conn = config.get('max_connections', 10)
            max_overflow = config.get('max_overflow')
            if max_overflow is None and isinstance(max_conn, (int, float)):
                max_overflow = max(0, int(max_conn) - int(pool_size))
            if max_overflow is None:
                max_overflow = 10
            pool_recycle = config.get('pool_recycle', 3600)
            try:
                # Create async engine with connection pooling (user config or defaults)
                engine = create_async_engine(
                    connection_string,
                    poolclass=QueuePool,
                    pool_size=int(pool_size) if pool_size is not None else 5,
                    max_overflow=int(max_overflow),
                    pool_pre_ping=True,
                    pool_recycle=int(pool_recycle),
                )
                
                # Store engine
                self.active_engines[connection_id] = {
                    'engine': engine,
                    'config': config,
                    'type': db_type,
                    'created_at': datetime.now()
                }
                
                logger.info(f"✅ SQLAlchemy engine created for {db_type}")
                return {
                    'success': True,
                    'connection_id': connection_id,
                    'message': f'{db_type} connection engine created'
                }
                
            except Exception as engine_error:
                logger.error(f"❌ Engine creation failed: {str(engine_error)}")
                return {
                    'success': False,
                    'error': f'Failed to create connection engine: {str(engine_error)}'
                }
                
        except Exception as e:
            logger.error(f"❌ Connection creation failed: {str(e)}")
            return {
                'success': False,
                'error': f'Connection creation failed: {str(e)}'
            }
    
    def _build_connection_string(self, config: Dict[str, Any]) -> str:
        """Build SQLAlchemy connection string"""
        db_type = config.get('type', '').lower()
        db_config = self.database_configs.get(db_type)
        
        if not db_config:
            raise ValueError(f'Unsupported database type: {db_type}')
        
        # Build connection string based on database type
        if db_type in ['postgresql', 'mysql', 'redshift']:
            return db_config['connection_string'].format(
                driver=db_config['driver'],
                username=config.get('username'),
                password=config.get('password'),
                host=config.get('host'),
                port=config.get('port', db_config['default_port']),
                database=config.get('database')
            )
        elif db_type == 'snowflake':
            return db_config['connection_string'].format(
                username=config.get('username'),
                password=config.get('password'),
                account=config.get('account'),
                database=config.get('database'),
                schema=config.get('schema', 'PUBLIC'),
                warehouse=config.get('warehouse', 'COMPUTE_WH')
            )
        elif db_type == 'bigquery':
            return db_config['connection_string'].format(
                project_id=config.get('project_id'),
                dataset=config.get('dataset', 'default')
            )
        elif db_type == 'sqlserver':
            base_uri = db_config['connection_string'].format(
                driver=db_config['sync_driver'],  # Use sync driver (mssql+pyodbc) for queries
                username=config.get('username'),
                password=config.get('password'),
                host=config.get('host'),
                port=config.get('port', db_config['default_port']),
                database=config.get('database')
            )
            
            query_params = []
            
            # ODBC Driver (default to Driver 18; never None)
            odbc_driver = (config.get('driver') or 'ODBC Driver 18 for SQL Server').strip() or 'ODBC Driver 18 for SQL Server'
            odbc_driver_encoded = odbc_driver.replace(' ', '+')
            query_params.append(f"driver={odbc_driver_encoded}")
            
            # TrustServerCertificate (default to yes for containerized SQL Server)
            trust_cert = config.get('trust_server_certificate', True)
            if trust_cert:
                query_params.append("TrustServerCertificate=yes")
            conn_timeout = config.get("connection_timeout")
            if isinstance(conn_timeout, (int, float)) and conn_timeout > 0:
                query_params.append(f"Connection+Timeout={int(conn_timeout)}")

            # Add query parameters if any
            if query_params:
                base_uri = f"{base_uri}?{'&'.join(query_params)}"
            
            return base_uri
        elif db_type == 'duckdb':
            path = (config.get('database') or config.get('host') or ':memory:').strip()
            return f"duckdb:///{path}"
        else:
            raise ValueError(f'Connection string builder not implemented for {db_type}')
    
    async def get_schema(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Get database schema using appropriate method"""
        try:
            db_type = config.get('type', '').lower()
            
            logger.info(f"🔍 Getting schema for {db_type} database")
            
            # Use HTTP API for ClickHouse
            if db_type == 'clickhouse':
                return await self._get_clickhouse_schema_http(config)
            # DuckDB: file-based, use native library for schema
            if db_type == 'duckdb':
                return await self._get_duckdb_schema(config)
            # Use SQLAlchemy Inspector for other databases
            return await self._get_schema_sqlalchemy(config)
            
        except Exception as e:
            logger.error(f"❌ Schema retrieval failed: {str(e)}")
            return {
                'success': False,
                'error': f'Schema retrieval failed: {str(e)}'
            }
    
    async def _get_clickhouse_schema_http(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Get ClickHouse schema via HTTP API"""
        try:
            host = config.get('host')
            port = config.get('port', 8123)
            # Use the connection's database (canonical: top-level then custom_fields) so schema matches the data source
            database = (config.get('database') or config.get('db') or config.get('catalog') or '').strip()
            if not database and isinstance(config.get('custom_fields'), dict):
                database = (config['custom_fields'].get('database') or config['custom_fields'].get('db') or config['custom_fields'].get('catalog') or '').strip()
            database = database or 'default'
            username = config.get('username')
            password = config.get('password')
            logger.info("ClickHouse schema fetch (database from connection config)")
            
            http_url = f"http://{host}:{port}"
            query = f"SELECT name, engine FROM system.tables WHERE database = '{database}' FORMAT JSON"
            
            async with aiohttp.ClientSession() as session:
                auth = aiohttp.BasicAuth(username, password) if username else None
                async with session.post(f"{http_url}/", data=query, auth=auth) as resp:
                    if resp.status == 200:
                        data = await resp.json()
                        tables = []
                        schemas = set()
                        
                        for table in data.get('data', []):
                            table_name = table.get('name')
                            
                            # Skip internal ClickHouse tables
                            if table_name.startswith('.inner_id.') or table_name.startswith('.'):
                                continue
                            
                            # Get columns for each table
                            cols_query = f"DESCRIBE TABLE {database}.{table_name} FORMAT JSON"
                            async with session.post(f"{http_url}/", data=cols_query, auth=auth) as cols_resp:
                                if cols_resp.status == 200:
                                    cols_data = await cols_resp.json()
                                    columns = []
                                    for col in cols_data.get('data', []):
                                        columns.append({
                                            'name': col.get('name', ''),
                                            'type': str(col.get('type', '')),
                                            'nullable': col.get('default_kind') != 'DEFAULT'
                                        })
                                    
                                    # Get row count for table
                                    count_query = f"SELECT count() as row_count FROM {database}.{table_name} FORMAT JSON"
                                    row_count = 0
                                    try:
                                        async with session.post(f"{http_url}/", data=count_query, auth=auth) as count_resp:
                                            if count_resp.status == 200:
                                                count_data = await count_resp.json()
                                                if count_data.get('data') and len(count_data['data']) > 0:
                                                    row_count_val = count_data['data'][0].get('row_count', 0)
                                                    row_count = int(row_count_val) if row_count_val is not None else 0
                                    except Exception as count_error:
                                        logger.debug(f"Row count fetch failed for {table_name}: {count_error}")
                                    
                                    # Fetch 2 sample rows so LLM sees actual value formats
                                    sample_data = []
                                    try:
                                        sample_query = f"SELECT * FROM {database}.{table_name} LIMIT 2 FORMAT JSON"
                                        async with session.post(f"{http_url}/", data=sample_query, auth=auth) as sample_resp:
                                            if sample_resp.status == 200:
                                                sample_json = await sample_resp.json()
                                                sample_data = sample_json.get("data", [])[:2]
                                    except Exception as sample_err:
                                        logger.debug(f"Sample data fetch skipped for {table_name}: {sample_err}")

                                    table_entry = {
                                        'schema': database,
                                        'name': table_name,
                                        'columns': columns,
                                        'rowCount': int(row_count),
                                    }
                                    if sample_data:
                                        table_entry['sample_data'] = sample_data
                                    tables.append(table_entry)
                                    schemas.add(database)
                        
                        total_rows = sum(int(t.get('rowCount', 0)) for t in tables)
                        
                        logger.info(f"✅ Retrieved schema for {len(tables)} ClickHouse tables")
                        return {
                            'success': True,
                            'tables': tables,
                            'schemas': list(schemas),
                            'total_rows': total_rows
                        }
                    else:
                        error_text = await resp.text()
                        return {
                            'success': False,
                            'error': f'ClickHouse HTTP error {resp.status}: {error_text}'
                        }
                        
        except Exception as e:
            logger.error(f"❌ ClickHouse schema fetch failed: {str(e)}")
            return {
                'success': False,
                'error': f"ClickHouse schema retrieval failed: {str(e)}"
            }
    
    async def _get_schema_sqlalchemy(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Get database schema using SQLAlchemy Inspector"""
        try:
            db_type = config.get('type', '').lower()
            
            # Build connection string for sync engine (Inspector needs sync)
            db_config = self.database_configs.get(db_type)
            if not db_config:
                return {
                    'success': False,
                    'error': f'Unsupported database type: {db_type}'
                }
            
            # Use sync driver for inspection
            sync_driver = db_config.get('sync_driver', db_config['driver'])
            config_copy = config.copy()
            config_copy['driver'] = sync_driver
            
            # Build sync connection string
            if db_type in ['postgresql', 'mysql', 'redshift']:
                connection_string = db_config['connection_string'].replace(
                    db_config['driver'], sync_driver
                ).format(
                    driver=sync_driver,
                    username=config.get('username'),
                    password=config.get('password'),
                    host=config.get('host'),
                    port=config.get('port', db_config['default_port']),
                    database=config.get('database')
                )
            elif db_type == 'sqlserver':
                # SQL Server connection string with ODBC driver; URL-encode password so @ and : don't break the URI
                from urllib.parse import quote_plus
                odbc_driver = (config.get('driver') or 'ODBC Driver 18 for SQL Server').strip() or 'ODBC Driver 18 for SQL Server'
                odbc_driver_encoded = odbc_driver.replace(' ', '+')
                user = config.get('username', '')
                password = config.get('password', '')
                user_enc = quote_plus(user) if user else ''
                password_enc = quote_plus(password) if password else ''
                
                # Build query parameters
                query_params = [f"driver={odbc_driver_encoded}"]
                trust_cert = config.get('trust_server_certificate', True)
                if trust_cert:
                    query_params.append("TrustServerCertificate=yes")
                
                connection_string = (
                    f"mssql+pyodbc://{user_enc}:{password_enc}"
                    f"@{config.get('host')}:{config.get('port', 1433)}/{config.get('database')}"
                    f"?{'&'.join(query_params)}"
                )
            else:
                return {
                    'success': False,
                    'error': f'Schema retrieval not yet implemented for {db_type}'
                }
            
            # Create sync engine and inspect
            engine = create_engine(
                connection_string,
                pool_pre_ping=True,
                pool_recycle=300,
                echo=False,
            )
            inspector = inspect(engine)
            
            tables = []
            schemas_list = inspector.get_schema_names()
            
            # Filter out system schemas
            system_schemas = {
                'postgresql': ['information_schema', 'pg_catalog', 'pg_toast'],
                'mysql': ['information_schema', 'performance_schema', 'mysql', 'sys'],
                'redshift': ['information_schema', 'pg_catalog', 'pg_toast'],
                'sqlserver': ['information_schema', 'sys', 'guest']
            }
            excluded_schemas = system_schemas.get(db_type, ['information_schema', 'sys'])

            # Fetch row counts in a single bulk query using database statistics
            row_count_map: Dict[tuple, int] = {}
            try:
                with engine.connect() as conn:
                    if db_type in ('postgresql', 'redshift'):
                        # Use both pg_class.reltuples (planner estimate, updated by ANALYZE)
                        # and pg_stat_user_tables.n_live_tup (autovacuum estimate) –
                        # take the max so freshly-loaded tables show their row count
                        rc_result = conn.execute(text(
                            "SELECT n.nspname AS schemaname, c.relname AS tablename, "
                            "GREATEST(COALESCE(c.reltuples, 0)::bigint, "
                            "         COALESCE(s.n_live_tup, 0)::bigint) AS row_count "
                            "FROM pg_class c "
                            "JOIN pg_namespace n ON n.oid = c.relnamespace "
                            "LEFT JOIN pg_stat_user_tables s "
                            "  ON s.schemaname = n.nspname AND s.relname = c.relname "
                            "WHERE c.relkind = 'r' "
                            "AND n.nspname NOT IN ('information_schema', 'pg_catalog', 'pg_toast')"
                        ))
                        for row in rc_result:
                            row_count_map[(row[0], row[1])] = int(row[2]) if row[2] is not None else 0
                    elif db_type == 'mysql':
                        rc_result = conn.execute(text(
                            "SELECT TABLE_SCHEMA, TABLE_NAME, TABLE_ROWS "
                            "FROM information_schema.TABLES "
                            "WHERE table_type = 'BASE TABLE'"
                        ))
                        for row in rc_result:
                            row_count_map[(row[0], row[1])] = int(row[2]) if row[2] is not None else 0
                    elif db_type == 'sqlserver':
                        rc_result = conn.execute(text(
                            "SELECT s.name AS schemaname, t.name AS tablename, "
                            "SUM(p.rows) AS row_count "
                            "FROM sys.tables t "
                            "JOIN sys.schemas s ON t.schema_id = s.schema_id "
                            "JOIN sys.partitions p ON t.object_id = p.object_id "
                            "WHERE p.index_id IN (0, 1) "
                            "GROUP BY s.name, t.name"
                        ))
                        for row in rc_result:
                            row_count_map[(row[0], row[1])] = int(row[2]) if row[2] is not None else 0
            except Exception as rc_error:
                logger.warning(f"⚠️ Bulk row count fetch failed (will show 0): {rc_error}")
            
            for schema_name in schemas_list:
                if schema_name.lower() not in [s.lower() for s in excluded_schemas]:
                    try:
                        table_names = inspector.get_table_names(schema=schema_name)
                        for table_name in table_names:
                            columns = []
                            try:
                                for col in inspector.get_columns(table_name, schema=schema_name):
                                    columns.append({
                                        'name': col['name'],
                                        'type': str(col['type']),
                                        'nullable': col.get('nullable', True),
                                        'primary_key': col.get('primary_key', False)
                                    })
                            except Exception as col_error:
                                logger.warning(f"Failed to get columns for {schema_name}.{table_name}: {col_error}")
                                columns = []

                            # Mark primary key columns using Inspector
                            try:
                                pk_info = inspector.get_pk_constraint(table_name, schema=schema_name)
                                pk_cols = set(pk_info.get("constrained_columns", []))
                                for col in columns:
                                    if col.get("name") in pk_cols:
                                        col["is_primary_key"] = True
                            except Exception:
                                pass

                            # Mark foreign key columns
                            try:
                                fk_list = inspector.get_foreign_keys(table_name, schema=schema_name)
                                fk_cols = set()
                                for fk in fk_list:
                                    fk_cols.update(fk.get("constrained_columns", []))
                                for col in columns:
                                    if col.get("name") in fk_cols:
                                        col["is_foreign_key"] = True
                            except Exception:
                                pass

                            row_count = row_count_map.get((schema_name, table_name), 0)
                            tables.append({
                                'schema': schema_name,
                                'name': table_name,
                                'columns': columns,
                                'rowCount': row_count
                            })
                    except Exception as table_error:
                        logger.warning(f"Failed to get tables for schema {schema_name}: {table_error}")
                        continue
            
            # Fetch row count per table for SQLAlchemy-backed DBs (SQL Server, PostgreSQL, MySQL, Redshift)
            def _quote_ident(db_t: str, schema: str, table: str) -> str:
                if db_t == 'sqlserver':
                    return f"[{schema}].[{table}]"
                if db_t == 'mysql':
                    return f"`{schema}`.`{table}`"
                # postgresql, redshift: double-quote
                return f'"{schema}"."{table}"'
            
            total_rows = 0
            with engine.connect() as conn:
                for t in tables:
                    try:
                        quoted = _quote_ident(db_type, t['schema'], t['name'])
                        q = text(f"SELECT COUNT(*) AS cnt FROM {quoted}")
                        row = conn.execute(q).scalar()
                        cnt = int(row) if row is not None else 0
                        t['rowCount'] = cnt
                        total_rows += cnt
                    except Exception as count_err:
                        logger.debug(f"Row count failed for {t['schema']}.{t['name']}: {count_err}")
                # Fetch 2 sample rows per table so the LLM sees actual value formats
                for t in tables:
                    try:
                        quoted = _quote_ident(db_type, t['schema'], t['name'])
                        sample_q = text(f"SELECT * FROM {quoted} LIMIT 2")
                        sample_result = conn.execute(sample_q)
                        col_names = list(sample_result.keys())
                        sample_rows = [
                            {col_names[i]: str(val) if val is not None else None for i, val in enumerate(row)}
                            for row in sample_result.fetchall()
                        ]
                        if sample_rows:
                            t['sample_data'] = sample_rows
                    except Exception as sample_err:
                        logger.debug(f"Sample data skipped for {t['schema']}.{t['name']}: {sample_err}")
            
            engine.dispose()
            
            total_rows = sum(t.get('rowCount', 0) for t in tables)
            logger.info(f"✅ Retrieved schema for {len(tables)} tables, {total_rows} total rows")
            return {
                'success': True,
                'tables': tables,
                'schemas': list(set(t['schema'] for t in tables)),
                'total_rows': total_rows
            }
            
        except Exception as e:
            logger.error(f"❌ SQLAlchemy schema fetch failed: {str(e)}")
            return {
                'success': False,
                'error': f'Schema retrieval failed: {str(e)}'
            }
    
    async def execute_query(self, connection_id: str, query: str, params: Optional[Dict] = None) -> Dict[str, Any]:
        """Execute query on database connection"""
        try:
            if connection_id not in self.active_engines:
                return {
                    'success': False,
                    'error': f'Connection {connection_id} not found'
                }
            
            connection = self.active_engines[connection_id]
            
            # ClickHouse HTTP API
            if connection.get('type') == 'clickhouse_http':
                return await self._execute_clickhouse_query(connection['config'], query)
            
            # SQLAlchemy execution
            engine = connection.get('engine')
            if not engine:
                return {
                    'success': False,
                    'error': 'No engine found for connection'
                }
            
            start_time = datetime.now()
            
            async with engine.begin() as conn:
                if params:
                    result = await conn.execute(text(query), params)
                else:
                    result = await conn.execute(text(query))
                
                # Convert result to list of dictionaries
                if result.returns_rows:
                    columns = list(result.keys())
                    data = [dict(row._mapping) for row in result.fetchall()]
                else:
                    columns = []
                    data = []
                
                execution_time = (datetime.now() - start_time).total_seconds()
                
                logger.info(f"✅ Query executed: {len(data)} rows in {execution_time:.2f}s")
                return {
                    'success': True,
                    'data': data,
                    'columns': columns,
                    'row_count': len(data),
                    'execution_time': execution_time
                }
                
        except Exception as e:
            logger.error(f"❌ Query execution failed: {str(e)}")
            return {
                'success': False,
                'error': f'Query execution failed: {str(e)}'
            }
    
    async def _execute_clickhouse_query(self, config: Dict[str, Any], query: str) -> Dict[str, Any]:
        """Execute query on ClickHouse via HTTP API"""
        try:
            host = config.get('host')
            port = config.get('port', 8123)
            username = config.get('username')
            password = config.get('password')
            
            http_url = f"http://{host}:{port}"
            # Add FORMAT JSON to query if not present
            if 'FORMAT' not in query.upper():
                query += ' FORMAT JSON'
            
            start_time = datetime.now()
            
            async with aiohttp.ClientSession() as session:
                auth = aiohttp.BasicAuth(username, password) if username else None
                async with session.post(f"{http_url}/", data=query, auth=auth) as resp:
                    if resp.status == 200:
                        result_data = await resp.json()
                        data = result_data.get('data', [])
                        
                        # Extract columns from first row
                        columns = list(data[0].keys()) if data else []
                        
                        execution_time = (datetime.now() - start_time).total_seconds()
                        
                        logger.info(f"✅ ClickHouse query executed: {len(data)} rows in {execution_time:.2f}s")
                        return {
                            'success': True,
                            'data': data,
                            'columns': columns,
                            'row_count': len(data),
                            'execution_time': execution_time
                        }
                    else:
                        error_text = await resp.text()
                        return {
                            'success': False,
                            'error': f'ClickHouse query error {resp.status}: {error_text}'
                        }
                        
        except Exception as e:
            logger.error(f"❌ ClickHouse query failed: {str(e)}")
            return {
                'success': False,
                'error': f'ClickHouse query failed: {str(e)}'
            }
    
    def get_supported_databases(self) -> List[str]:
        """Get list of supported database types"""
        return list(self.database_configs.keys())
    
    async def close_connection(self, connection_id: str) -> Dict[str, Any]:
        """Close and remove connection"""
        try:
            if connection_id in self.active_engines:
                connection = self.active_engines[connection_id]
                
                # Dispose engine if it exists
                if 'engine' in connection:
                    await connection['engine'].dispose()
                
                del self.active_engines[connection_id]
                
                logger.info(f"✅ Connection {connection_id} closed")
                return {
                    'success': True,
                    'message': f'Connection {connection_id} closed'
                }
            else:
                return {
                    'success': False,
                    'error': f'Connection {connection_id} not found'
                }
                
        except Exception as e:
            logger.error(f"❌ Failed to close connection: {str(e)}")
            return {
                'success': False,
                'error': f'Failed to close connection: {str(e)}'
            }
