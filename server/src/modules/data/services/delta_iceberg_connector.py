"""
Delta Lake and Apache Iceberg Connector Service
Supports enterprise data lake formats via DuckDB extensions.
"""

import logging
from typing import Dict, Any, Optional, List
import os

from src.shared.query_limits import DEFAULT_QUERY_LIMIT

logger = logging.getLogger(__name__)


class DeltaIcebergConnector:
    """Connector for Delta Lake and Apache Iceberg tables via DuckDB"""
    
    def __init__(self):
        self.supported_formats = ['delta', 'iceberg']
    
    async def connect_delta_table(
        self,
        storage_uri: str,  # s3://bucket/table/ or azure://account/container/table/
        credentials: Dict[str, str],
        version: Optional[int] = None,
        timestamp: Optional[str] = None,
        organization_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Connect to Delta Lake table and return schema + sample data.
        
        Args:
            storage_uri: Storage URI (s3:// or azure://)
            credentials: Dict with access_key/secret_key (S3) or account_name/account_key/sas_token (Azure)
            version: Optional Delta version to read (time travel)
            timestamp: Optional timestamp for time travel
            organization_id: Organization ID for ownership
        
        Returns:
            Dict with success, data, schema, format, storage_uri
        """
        try:
            import duckdb
            
            conn = duckdb.connect(database=':memory:', read_only=False)
            
            # Configure credentials based on storage type
            if storage_uri.startswith('s3://'):
                access_key = credentials.get('access_key')
                secret_key = credentials.get('secret_key')
                region = credentials.get('region', 'us-east-1')
                
                if not access_key or not secret_key:
                    return {
                        'success': False,
                        'error': 'S3 credentials (access_key, secret_key) are required'
                    }
                
                conn.execute(f"SET s3_access_key_id='{access_key}'")
                conn.execute(f"SET s3_secret_access_key='{secret_key}'")
                conn.execute(f"SET s3_region='{region}'")
                conn.execute("SET s3_endpoint='https://s3.amazonaws.com'")
                
            elif storage_uri.startswith('azure://'):
                account_name = credentials.get('account_name')
                account_key = credentials.get('account_key')
                sas_token = credentials.get('sas_token')
                
                if not account_name or (not account_key and not sas_token):
                    return {
                        'success': False,
                        'error': 'Azure credentials (account_name and account_key or sas_token) are required'
                    }
                
                conn.execute(f"SET azure_storage_account_name='{account_name}'")
                if account_key:
                    conn.execute(f"SET azure_storage_account_key='{account_key}'")
                elif sas_token:
                    conn.execute(f"SET azure_storage_sas_token='{sas_token}'")
            elif storage_uri.startswith('gcs://') or storage_uri.startswith('gs://'):
                # GCP Cloud Storage support
                service_account_key = credentials.get('service_account_key')
                project_id = credentials.get('project_id')
                
                if not service_account_key:
                    return {
                        'success': False,
                        'error': 'GCP credentials (service_account_key) are required. Provide JSON key as string.'
                    }
                
                # Validate JSON key format
                try:
                    import json
                    if isinstance(service_account_key, str):
                        key_json = json.loads(service_account_key)
                        if 'private_key' not in key_json or 'client_email' not in key_json:
                            return {
                                'success': False,
                                'error': 'Invalid GCP service account key format. Must include private_key and client_email.'
                            }
                    else:
                        return {
                            'success': False,
                            'error': 'GCP service_account_key must be a JSON string'
                        }
                except json.JSONDecodeError:
                    return {
                        'success': False,
                        'error': 'GCP service_account_key must be valid JSON string'
                    }
                except Exception as e:
                    logger.error(f"GCP credential validation failed: {e}")
                    return {
                        'success': False,
                        'error': f'GCP credential validation failed: {str(e)}'
                    }
            else:
                return {
                    'success': False,
                    'error': f'Unsupported storage URI format: {storage_uri}. Use s3://, azure://, or gcs://'
                }
            
            # Install and load Delta extension
            try:
                conn.install_extension('delta')
                conn.load_extension('delta')
            except Exception as e:
                logger.warning(f"Delta extension not available: {e}. Attempting fallback...")
                return {
                    'success': False,
                    'error': f'Delta Lake extension not available. Please install DuckDB with Delta support: {str(e)}'
                }
            
            # Build query with optional version/timestamp
            query = f"SELECT * FROM delta_scan('{storage_uri}'"
            if version:
                query += f", version={version}"
            elif timestamp:
                query += f", timestamp='{timestamp}'"
            query += f") LIMIT {DEFAULT_QUERY_LIMIT}"

            # Get sample data
            result_df = conn.execute(query).df()

            # Get schema
            schema_query = f"DESCRIBE delta_scan('{storage_uri}')"
            schema_rows = conn.execute(schema_query).fetchall()
            schema = [{'name': row[0], 'type': row[1]} for row in schema_rows]
            
            conn.close()
            
            return {
                'success': True,
                'data': result_df.to_dict('records'),
                'schema': schema,
                'format': 'delta',
                'storage_uri': storage_uri,
                'row_count': len(result_df),
                'organization_id': organization_id
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to connect to Delta Lake table {storage_uri}: {e}", exc_info=True)
            return {
                'success': False,
                'error': str(e)
            }
    
    async def connect_iceberg_table(
        self,
        storage_uri: str,
        credentials: Dict[str, str],
        snapshot_id: Optional[int] = None,
        organization_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Connect to Apache Iceberg table and return schema + sample data.
        
        Args:
            storage_uri: Storage URI (s3:// or azure://)
            credentials: Dict with access_key/secret_key (S3) or account_name/account_key/sas_token (Azure)
            snapshot_id: Optional Iceberg snapshot ID to read
            organization_id: Organization ID for ownership
        
        Returns:
            Dict with success, data, schema, format, storage_uri
        """
        try:
            import duckdb
            
            conn = duckdb.connect(database=':memory:', read_only=False)
            
            # Configure credentials (same as Delta)
            if storage_uri.startswith('s3://'):
                access_key = credentials.get('access_key')
                secret_key = credentials.get('secret_key')
                region = credentials.get('region', 'us-east-1')
                
                if not access_key or not secret_key:
                    return {
                        'success': False,
                        'error': 'S3 credentials (access_key, secret_key) are required'
                    }
                
                conn.execute(f"SET s3_access_key_id='{access_key}'")
                conn.execute(f"SET s3_secret_access_key='{secret_key}'")
                conn.execute(f"SET s3_region='{region}'")
                conn.execute("SET s3_endpoint='https://s3.amazonaws.com'")
                
            elif storage_uri.startswith('azure://'):
                account_name = credentials.get('account_name')
                account_key = credentials.get('account_key')
                sas_token = credentials.get('sas_token')
                
                if not account_name or (not account_key and not sas_token):
                    return {
                        'success': False,
                        'error': 'Azure credentials (account_name and account_key or sas_token) are required'
                    }
                
                conn.execute(f"SET azure_storage_account_name='{account_name}'")
                if account_key:
                    conn.execute(f"SET azure_storage_account_key='{account_key}'")
                elif sas_token:
                    conn.execute(f"SET azure_storage_sas_token='{sas_token}'")
            elif storage_uri.startswith('gcs://') or storage_uri.startswith('gs://'):
                # GCP Cloud Storage support for Iceberg
                service_account_key = credentials.get('service_account_key')
                project_id = credentials.get('project_id')
                
                if not service_account_key:
                    return {
                        'success': False,
                        'error': 'GCP credentials (service_account_key) are required. Provide JSON key as string.'
                    }
                
                # Validate JSON key format
                try:
                    import json
                    if isinstance(service_account_key, str):
                        key_json = json.loads(service_account_key)
                        if 'private_key' not in key_json or 'client_email' not in key_json:
                            return {
                                'success': False,
                                'error': 'Invalid GCP service account key format. Must include private_key and client_email.'
                            }
                    else:
                        return {
                            'success': False,
                            'error': 'GCP service_account_key must be a JSON string'
                        }
                except json.JSONDecodeError:
                    return {
                        'success': False,
                        'error': 'GCP service_account_key must be valid JSON string'
                    }
                except Exception as e:
                    logger.error(f"GCP credential validation failed: {e}")
                    return {
                        'success': False,
                        'error': f'GCP credential validation failed: {str(e)}'
                    }
            else:
                return {
                    'success': False,
                    'error': f'Unsupported storage URI format: {storage_uri}. Use s3://, azure://, or gcs://'
                }
            
            # Install and load Iceberg extension
            try:
                conn.install_extension('iceberg')
                conn.load_extension('iceberg')
            except Exception as e:
                logger.warning(f"Iceberg extension not available: {e}. Attempting fallback...")
                return {
                    'success': False,
                    'error': f'Iceberg extension not available. Please install DuckDB with Iceberg support: {str(e)}'
                }
            
            # Build query with optional snapshot_id
            query = f"SELECT * FROM iceberg_scan('{storage_uri}'"
            if snapshot_id:
                query += f", snapshot_id={snapshot_id}"
            query += f") LIMIT {DEFAULT_QUERY_LIMIT}"

            # Get sample data
            result_df = conn.execute(query).df()

            # Get schema
            schema_query = f"DESCRIBE iceberg_scan('{storage_uri}')"
            schema_rows = conn.execute(schema_query).fetchall()
            schema = [{'name': row[0], 'type': row[1]} for row in schema_rows]
            
            conn.close()
            
            return {
                'success': True,
                'data': result_df.to_dict('records'),
                'schema': schema,
                'format': 'iceberg',
                'storage_uri': storage_uri,
                'row_count': len(result_df),
                'organization_id': organization_id
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to connect to Iceberg table {storage_uri}: {e}", exc_info=True)
            return {
                'success': False,
                'error': str(e)
            }
    
    async def test_connection(
        self,
        format_type: str,  # 'delta', 'iceberg', 's3_parquet', or 'azure_blob'
        storage_uri: str,
        credentials: Dict[str, str],
        **kwargs
    ) -> Dict[str, Any]:
        """
        Test connection to Delta Lake, Iceberg, or direct S3/Azure Parquet.
        
        Args:
            format_type: 'delta', 'iceberg', 's3_parquet', or 'azure_blob'
            storage_uri: Storage URI (s3:// or azure://)
            credentials: Dict with access_key/secret_key (S3) or account_name/account_key/sas_token (Azure)
            **kwargs: Additional options (version, timestamp, snapshot_id)
        
        Returns:
            Dict with success, message, schema (if successful)
        """
        try:
            if format_type in ['delta', 'delta_lake']:
                result = await self.connect_delta_table(storage_uri, credentials, **kwargs)
            elif format_type == 'iceberg':
                result = await self.connect_iceberg_table(storage_uri, credentials, **kwargs)
            elif format_type in ['s3_parquet', 'azure_blob', 'gcp_cloud_storage']:
                # For direct cloud storage files, verify credentials and URI format
                if storage_uri.startswith('s3://'):
                    if not credentials.get('access_key') or not credentials.get('secret_key'):
                        return {
                            'success': False,
                            'error': 'S3 credentials (access_key, secret_key) are required'
                        }
                elif storage_uri.startswith('azure://') or storage_uri.startswith('abfss://'):
                    if not credentials.get('account_name') or (not credentials.get('account_key') and not credentials.get('sas_token')):
                        return {
                            'success': False,
                            'error': 'Azure credentials (account_name and account_key or sas_token) are required'
                        }
                elif storage_uri.startswith('gcs://') or storage_uri.startswith('gs://'):
                    if not credentials.get('service_account_key'):
                        return {
                            'success': False,
                            'error': 'GCP credentials (service_account_key) are required'
                        }
                    # Validate JSON format
                    try:
                        import json
                        key_json = json.loads(credentials.get('service_account_key'))
                        if 'private_key' not in key_json or 'client_email' not in key_json:
                            return {
                                'success': False,
                                'error': 'Invalid GCP service account key format'
                            }
                    except json.JSONDecodeError:
                        return {
                            'success': False,
                            'error': 'GCP service_account_key must be valid JSON string'
                        }
                else:
                    return {
                        'success': False,
                        'error': f'Unsupported storage URI format: {storage_uri}. Use s3://, azure://, or gcs://'
                    }
                
                # Basic validation passed
                return {
                    'success': True,
                    'message': f'Storage URI and credentials validated for {format_type}',
                    'schema': [],
                    'row_count': 0
                }
            else:
                return {
                    'success': False,
                    'error': f'Unsupported format: {format_type}. Use "delta", "iceberg", "s3_parquet", "azure_blob", or "gcp_cloud_storage"'
                }
            
            if result.get('success'):
                return {
                    'success': True,
                    'message': f'Successfully connected to {format_type} table',
                    'schema': result.get('schema', []),
                    'row_count': result.get('row_count', 0)
                }
            else:
                return {
                    'success': False,
                    'error': result.get('error', 'Connection failed')
                }
                
        except Exception as e:
            logger.error(f"❌ Connection test failed: {e}", exc_info=True)
            return {
                'success': False,
                'error': str(e)
            }
    
    async def _configure_duckdb_cloud_credentials(self, storage_uri: str, credentials: Dict[str, str], conn):
        """
        Configure DuckDB for cloud storage access (S3, Azure, GCP).
        
        Args:
            storage_uri: Storage URI (s3://, azure://, gcs://, or gs://)
            credentials: Dict with cloud provider credentials
            conn: DuckDB connection object
        """
        try:
            # Install httpfs extension for cloud storage access
            try:
                conn.execute("INSTALL httpfs;")
                conn.execute("LOAD httpfs;")
            except Exception as e:
                logger.warning(f"httpfs extension may already be loaded: {e}")
            
            if storage_uri.startswith('s3://'):
                access_key = credentials.get('access_key')
                secret_key = credentials.get('secret_key')
                region = credentials.get('region', 'us-east-1')
                endpoint = credentials.get('endpoint')
                
                if not access_key or not secret_key:
                    raise ValueError('S3 credentials (access_key, secret_key) are required')
                
                conn.execute(f"SET s3_access_key_id='{access_key}'")
                conn.execute(f"SET s3_secret_access_key='{secret_key}'")
                conn.execute(f"SET s3_region='{region}'")
                if endpoint:
                    conn.execute(f"SET s3_endpoint='{endpoint}'")
                conn.execute("SET s3_use_ssl=true;")
                conn.execute("SET s3_url_style='path';")
                logger.info("✅ DuckDB S3 credentials configured.")
                
            elif storage_uri.startswith('azure://') or storage_uri.startswith('abfss://'):
                account_name = credentials.get('account_name')
                account_key = credentials.get('account_key')
                sas_token = credentials.get('sas_token')
                
                if not account_name or (not account_key and not sas_token):
                    raise ValueError('Azure credentials (account_name and account_key or sas_token) are required')
                
                conn.execute(f"SET azure_storage_account_name='{account_name}'")
                if account_key:
                    conn.execute(f"SET azure_storage_account_key='{account_key}'")
                elif sas_token:
                    conn.execute(f"SET azure_storage_sas_token='{sas_token}'")
                logger.info("✅ DuckDB Azure Blob Storage credentials configured.")
                
            elif storage_uri.startswith('gcs://') or storage_uri.startswith('gs://'):
                # GCP Cloud Storage
                service_account_key = credentials.get('service_account_key')
                project_id = credentials.get('project_id')
                
                if not service_account_key:
                    raise ValueError('GCP credentials (service_account_key) are required')
                
                # Validate and parse service account key
                import json
                if isinstance(service_account_key, str):
                    try:
                        key_json = json.loads(service_account_key)
                        if 'private_key' not in key_json or 'client_email' not in key_json:
                            raise ValueError('Invalid GCP service account key format')
                    except json.JSONDecodeError:
                        raise ValueError('GCP service_account_key must be valid JSON string')
                else:
                    raise ValueError('GCP service_account_key must be a JSON string')
                
                # DuckDB GCS support (if available)
                # Note: DuckDB may require GCS extension or we use gcsfs library
                # For now, we'll store credentials for later use
                logger.info("✅ DuckDB GCP Cloud Storage credentials validated.")
                logger.warning("⚠️ GCS direct access via DuckDB may require additional setup. Consider using gcsfs library.")
            else:
                logger.warning(f"⚠️ No cloud credentials configured for URI: {storage_uri}")
        except Exception as e:
            logger.error(f"❌ Failed to configure cloud credentials: {e}", exc_info=True)
            raise
    
    async def connect_cloud_storage_file(
        self,
        storage_uri: str,  # s3://bucket/path/to/file.parquet, azure://container/path/to/file.csv, gcs://bucket/path/to/file.json
        credentials: Dict[str, str],
        file_format: str,  # 'parquet', 'csv', 'json', 'tsv', etc.
        organization_id: Optional[int] = None
    ) -> Dict[str, Any]:
        """
        Connects to a file in cloud storage (S3, Azure Blob, GCP Cloud Storage) and returns its schema + sample data.
        
        Args:
            storage_uri: Storage URI (s3://, azure://, gcs://, or gs://)
            credentials: Dict with cloud provider credentials
            file_format: File format ('parquet', 'csv', 'json', 'tsv', etc.)
            organization_id: Organization ID for ownership
        
        Returns:
            Dict with success, data, schema, format, storage_uri, row_count
        """
        try:
            import duckdb
            import pandas as pd
            
            conn = duckdb.connect(database=':memory:', read_only=False)
            
            # Configure cloud storage credentials
            await self._configure_duckdb_cloud_credentials(storage_uri, credentials, conn)
            
            # Read file based on format
            if file_format == 'parquet':
                conn.execute(f"CREATE TABLE cloud_data AS SELECT * FROM read_parquet('{storage_uri}')")
            elif file_format == 'csv' or file_format == 'tsv':
                delimiter = ',' if file_format == 'csv' else '\t'
                conn.execute(f"CREATE TABLE cloud_data AS SELECT * FROM read_csv_auto('{storage_uri}', delim='{delimiter}')")
            elif file_format == 'json':
                conn.execute(f"CREATE TABLE cloud_data AS SELECT * FROM read_json('{storage_uri}')")
            else:
                raise ValueError(f"Unsupported file format for cloud storage: {file_format}")
            
            # Get sample data
            result_df = conn.execute(f"SELECT * FROM cloud_data LIMIT {DEFAULT_QUERY_LIMIT}").df()
            
            # Get schema
            schema_rows = conn.execute("DESCRIBE cloud_data").fetchall()
            schema = [{'name': row[0], 'type': row[1]} for row in schema_rows]
            
            # Get row count (approximate for large files)
            try:
                row_count = conn.execute("SELECT COUNT(*) FROM cloud_data").fetchone()[0]
            except Exception:
                row_count = len(result_df)  # Fallback to sample size
            
            conn.close()
            
            return {
                'success': True,
                'data': result_df.to_dict('records'),
                'schema': schema,
                'format': file_format,
                'storage_uri': storage_uri,
                'row_count': row_count,
                'organization_id': organization_id
            }
            
        except Exception as e:
            logger.error(f"❌ Failed to connect to cloud storage file {storage_uri}: {e}", exc_info=True)
            return {
                'success': False,
                'error': str(e)
            }

