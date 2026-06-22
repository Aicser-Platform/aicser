"""
Complete Data Sources CRUD Operations
Production-ready data source management with full CRUD functionality
"""

import asyncio
from typing import Dict, List, Any, Optional, Union
from datetime import datetime, timezone
import logging
from dataclasses import dataclass, asdict
import json
import uuid

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import select, and_, or_, update, delete, func
from sqlalchemy.orm import selectinload
from fastapi import HTTPException, status

from src.db.session import get_async_session
from src.modules.data.models import DataSource, DataQuery
from src.modules.organizations.models import Organization
from src.modules.project.models import Project
from src.core.real_data_sources import real_data_source_manager
from src.modules.data.utils.credentials import encrypt_credentials, decrypt_credentials
from src.modules.data.utils.masking import merge_incoming_connection_config, public_connection_config
from src.core.metrics import DS_CREATE_COUNTER, DS_UPDATE_COUNTER, DS_DELETE_COUNTER, CONNECTION_TEST_COUNTER
from src.core.edition import is_ee_enabled

logger = logging.getLogger(__name__)


def _public_conn(raw: Any) -> Optional[Dict[str, Any]]:
    if raw is None:
        return None
    return public_connection_config(raw)


@dataclass
class DataSourceCreate:
    """Data source creation request"""
    name: str
    type: str  # database, file_storage, api, streaming
    format: str  # postgresql, mysql, csv, s3, etc.
    description: Optional[str] = None
    connection_config: Dict[str, Any] = None
    project_id: Optional[str] = None
    is_active: bool = True
    # Optional stored schema (e.g. BI catalog / Power BI dataset mirror — no live DB)
    schema: Optional[Dict[str, Any]] = None

@dataclass
class DataSourceUpdate:
    """Data source update request"""
    name: Optional[str] = None
    description: Optional[str] = None
    connection_config: Optional[Dict[str, Any]] = None
    is_active: Optional[bool] = None
    schema: Optional[Dict[str, Any]] = None  # Full schema replacement (e.g. after merging business_metadata)

@dataclass
class DataSourceResponse:
    """Data source response - includes all fields from DataSource model"""
    id: str
    name: str
    type: str
    format: Optional[str] = None
    db_type: Optional[str] = None
    description: Optional[str] = None
    connection_config: Optional[Dict[str, Any]] = None
    project_id: Optional[str] = None
    is_active: bool = True
    created_at: datetime = None  # type: ignore
    updated_at: Optional[datetime] = None
    last_accessed: Optional[datetime] = None
    connection_status: Optional[str] = None
    metadata: Optional[Dict[str, Any]] = None
    
    # Additional fields from model that were missing
    schema: Optional[Dict[str, Any]] = None
    row_count: Optional[int] = None
    size: Optional[int] = None
    file_path: Optional[str] = None
    original_filename: Optional[str] = None
    sample_data: Optional[List[Dict[str, Any]]] = None
    user_id: Optional[str] = None

class DataSourcesCRUD:
    """Complete CRUD operations for data sources"""
    
    def __init__(self):
        self.real_data_manager = real_data_source_manager
    
    async def create_data_source(
        self,
        data_source_data: DataSourceCreate,
        user_id: str,
        session: Optional[AsyncSession] = None
    ) -> DataSourceResponse:
        """Create a new data source"""
        try:
            # Generate unique ID
            data_source_id = str(uuid.uuid4())
            
            # Create data source
            # Metadata can be used for other non-standard fields if needed
            metadata = {}

            # Encrypt sensitive fields in connection_config before storing
            conn_cfg = data_source_data.connection_config or {}
            try:
                conn_cfg = encrypt_credentials(conn_cfg)
            except Exception:
                conn_cfg = data_source_data.connection_config or {}

            # DB expects user_id as UUID; convert short test ids (e.g. "1") to a deterministic UUID
            user_id_val = user_id
            try:
                uuid.UUID(user_id_val)
            except (ValueError, TypeError):
                user_id_val = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"test-user-{user_id}"))

            # project_id required for data_sources table; resolve from create payload or leave for caller to set
            project_id_val = None
            if getattr(data_source_data, "project_id", None):
                try:
                    project_id_val = uuid.UUID(str(data_source_data.project_id))
                except (ValueError, TypeError):
                    pass
            if not project_id_val and session:
                # Fallback: first project for user (e.g. when creating via POST /sources with no project_id)
                from src.modules.project.service import ProjectService
                try:
                    projects, _ = await ProjectService.get_user_projects(user_id_val)
                    if projects:
                        project_id_val = projects[0].id
                except Exception:
                    pass
            if project_id_val is None and is_ee_enabled():
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="project_id is required. Select a project or create one first.",
                )

            data_source = DataSource(
                id=data_source_id,
                name=data_source_data.name,
                type=data_source_data.type,
                format=data_source_data.format,
                description=data_source_data.description,
                connection_config=conn_cfg,
                user_id=user_id_val,
                project_id=project_id_val,
                is_active=data_source_data.is_active,
                created_at=datetime.now(timezone.utc),
                updated_at=datetime.now(timezone.utc),
                schema=getattr(data_source_data, "schema", None),
            )
            
            session.add(data_source)
            await session.flush()
            
            # Test connection if provided
            connection_status = "unknown"
            if data_source_data.connection_config:
                try:
                    test_result = await self.real_data_manager.test_connection(data_source)
                    connection_status = "connected" if test_result.success else "failed"
                except Exception as e:
                    logger.warning(f"Connection test failed: {e}")
                    connection_status = "failed"
            
            # Get schema if it's a database
            metadata = {}
            if data_source_data.type == "database" and connection_status == "connected":
                try:
                    schema = await self.real_data_manager.get_schema(data_source)
                    metadata = {"schema": schema}
                except Exception as e:
                    logger.warning(f"Schema retrieval failed: {e}")
            
            await session.commit()
            
            return DataSourceResponse(
                id=data_source.id,
                name=data_source.name,
                type=data_source.type,
                format=data_source.format,
                db_type=data_source.db_type,
                description=data_source.description,
                connection_config=_public_conn(data_source.connection_config),
                project_id=data_source_data.project_id,
                is_active=data_source.is_active,
                created_at=data_source.created_at,
                updated_at=data_source.updated_at,
                last_accessed=data_source.last_accessed,
                connection_status=connection_status,
                metadata=metadata,
                schema=data_source.schema,
                row_count=data_source.row_count,
                size=data_source.size,
                file_path=data_source.file_path,
                original_filename=data_source.original_filename,
                sample_data=data_source.sample_data,
                user_id=data_source.user_id
            )
            
        except Exception as e:
            await session.rollback()
            logger.error(f"Error creating data source: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to create data source: {str(e)}"
            )
    
    async def get_data_source(
        self,
        data_source_id: str,
        user_id: str,
        session: AsyncSession
    ) -> Optional[DataSourceResponse]:
        """Get a data source by ID"""
        try:
            result = await session.execute(
                select(DataSource).where(
                    and_(
                        DataSource.id == data_source_id,
                        DataSource.user_id == user_id
                    )
                )
            )
            data_source = result.scalar_one_or_none()
            
            if not data_source:
                return None
            
            # Test connection status and fetch schema (only when retrieving a specific data source)
            connection_status = "unknown"
            metadata = {}
            fetched_schema = None
            if data_source.connection_config:
                try:
                    test_result = await self.real_data_manager.test_connection(data_source)
                    connection_status = "connected" if test_result.success else "failed"
                    
                    # Get schema if connected
                    if connection_status == "connected" and data_source.type == "database":
                        fetched_schema = await self.real_data_manager.get_schema(data_source)
                        metadata = {"schema": fetched_schema}
                except Exception as e:
                    logger.warning(f"Connection test failed: {e}")
                    connection_status = "failed"
            try:
                DS_CREATE_COUNTER.inc()
            except Exception:
                pass

            # Use fetched schema if available, otherwise fall back to model's schema
            schema_to_return = fetched_schema if fetched_schema is not None else data_source.schema

            return DataSourceResponse(
                id=data_source.id,
                name=data_source.name,
                type=data_source.type,
                format=data_source.format,
                db_type=data_source.db_type,
                description=data_source.description,
                connection_config=_public_conn(data_source.connection_config),
                project_id=None,  # Would need to join with project_data_source table
                is_active=data_source.is_active,
                created_at=data_source.created_at,
                updated_at=data_source.updated_at,
                last_accessed=data_source.last_accessed,
                connection_status=connection_status,
                metadata=metadata,
                schema=schema_to_return,  # Use fetched schema if available
                row_count=data_source.row_count,
                size=data_source.size,
                file_path=data_source.file_path,
                original_filename=data_source.original_filename,
                sample_data=data_source.sample_data,
                user_id=data_source.user_id
            )
            
        except Exception as e:
            logger.error(f"Error getting data source: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to get data source: {str(e)}"
            )
    
    async def list_data_sources(
        self,
        project_id: str,
        user_id: Optional[str] = None,
        data_source_type: Optional[str] = None,
        is_active: Optional[bool] = None,
        session: Optional[AsyncSession] = None
    ) -> List[DataSourceResponse]:
        """List data sources for a project."""
        try:
            # Convert project_id to UUID if it's a string
            from uuid import UUID
            if isinstance(project_id, str):
                try:
                    project_id_uuid = UUID(project_id)
                except ValueError:
                    raise ValueError(f"Invalid project_id format: {project_id}. Must be a valid UUID.")
            else:
                project_id_uuid = project_id
            
            # Build query - filter by project_id
            query = select(DataSource).where(DataSource.project_id == project_id_uuid)
            
            if data_source_type:
                query = query.where(DataSource.type == data_source_type)
            
            if is_active is not None:
                query = query.where(DataSource.is_active == is_active)
            
            # Order by created_at desc
            query = query.order_by(DataSource.created_at.desc())
            
            result = await session.execute(query)
            data_sources = result.scalars().all()
            
            # Convert to response objects
            # NOTE: Connection testing is NOT performed during listing for performance.
            # Connection testing and schema fetching only happen when a specific data source is retrieved.
            responses = []
            for data_source in data_sources:
                responses.append(DataSourceResponse(
                    id=data_source.id,
                    name=data_source.name,
                    type=data_source.type,
                    format=data_source.format,
                    db_type=data_source.db_type,
                    description=data_source.description,
                    connection_config=_public_conn(data_source.connection_config),
                    project_id=str(data_source.project_id),
                    is_active=data_source.is_active,
                    created_at=data_source.created_at,
                    updated_at=data_source.updated_at,
                    last_accessed=data_source.last_accessed,
                    connection_status=None,  # Not tested during listing
                    metadata={},  # Empty metadata during listing
                    schema=None,  # Not fetched during listing
                    row_count=data_source.row_count,
                    size=data_source.size,
                    file_path=data_source.file_path,
                    original_filename=data_source.original_filename,
                    sample_data=data_source.sample_data,
                    user_id=user_id  # Pass user_id from parameter
                ))
            
            return responses
            
        except Exception as e:
            logger.error(f"Error listing data sources: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to list data sources: {str(e)}"
            )
    
    async def update_data_source(
        self,
        data_source_id: str,
        update_data: DataSourceUpdate,
        user_id: str,
        session: Optional[AsyncSession] = None
    ) -> DataSourceResponse:
        """Update a data source"""
        try:
            # Normalize user_id to UUID so ownership check matches create (e.g. test token "1" -> same UUID)
            try:
                uuid.UUID(user_id)
            except (ValueError, TypeError):
                user_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"test-user-{user_id}"))
            # Get existing data source
            result = await session.execute(
                select(DataSource).where(
                    and_(
                        DataSource.id == data_source_id,
                        DataSource.user_id == user_id
                    )
                )
            )
            data_source = result.scalar_one_or_none()
            
            if not data_source:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Data source not found"
                )
            return await self._apply_data_source_update(data_source, update_data, session)
            
        except HTTPException:
            raise
        except Exception as e:
            await session.rollback()
            logger.error(f"Error updating data source: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to update data source: {str(e)}"
            )

    async def update_data_source_by_id(
        self,
        data_source_id: str,
        update_data: DataSourceUpdate,
        session: Optional[AsyncSession] = None
    ) -> DataSourceResponse:
        """Update a data source by id only. Call only after API has verified access (creator or project member)."""
        if session is None:
            raise ValueError("session is required for update_data_source_by_id")
        result = await session.execute(select(DataSource).where(DataSource.id == data_source_id))
        data_source = result.scalar_one_or_none()
        if not data_source:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail="Data source not found"
            )
        return await self._apply_data_source_update(data_source, update_data, session)

    async def _apply_data_source_update(
        self,
        data_source,
        update_data: DataSourceUpdate,
        session: AsyncSession
    ) -> DataSourceResponse:
        """Apply update_data to an already-fetched data_source and commit."""
        if update_data.name is not None:
            data_source.name = update_data.name
        if update_data.description is not None:
            data_source.description = update_data.description
        if update_data.connection_config is not None:
            raw = data_source.connection_config
            if isinstance(raw, dict):
                existing = dict(raw) if raw else {}
            elif isinstance(raw, str) and raw.strip():
                try:
                    existing = json.loads(raw) or {}
                except Exception:
                    existing = {}
            else:
                existing = {}
            # Decrypt existing so we merge plain values; otherwise we'd re-encrypt already-encrypted values (double-encrypt) and schema fetch would fail
            try:
                existing = decrypt_credentials(existing)
            except Exception:
                pass
            merged = merge_incoming_connection_config(existing, update_data.connection_config)
            try:
                merged = encrypt_credentials(merged)
            except Exception:
                pass
            data_source.connection_config = merged
        if update_data.is_active is not None:
            data_source.is_active = update_data.is_active
        if update_data.schema is not None:
            data_source.schema = update_data.schema
        data_source.updated_at = datetime.now(timezone.utc)
        await session.flush()
        connection_status = "unknown"
        metadata = {}
        if data_source.connection_config:
            try:
                test_result = await self.real_data_manager.test_connection(data_source)
                connection_status = "connected" if test_result.success else "failed"
                if connection_status == "connected" and data_source.type == "database":
                    schema = await self.real_data_manager.get_schema(data_source)
                    metadata = {"schema": schema}
            except Exception as e:
                logger.warning(f"Connection test failed: {e}")
                connection_status = "failed"
        await session.commit()
        try:
            DS_UPDATE_COUNTER.inc()
        except Exception:
            pass
        return DataSourceResponse(
            id=data_source.id,
            name=data_source.name,
            type=data_source.type,
            format=data_source.format,
            db_type=data_source.db_type,
            description=data_source.description,
            connection_config=_public_conn(data_source.connection_config),
            project_id=None,
            is_active=data_source.is_active,
            created_at=data_source.created_at,
            updated_at=data_source.updated_at,
            last_accessed=data_source.last_accessed,
            connection_status=connection_status,
            metadata=metadata,
            schema=data_source.schema,
            row_count=data_source.row_count,
            size=data_source.size,
            file_path=data_source.file_path,
            original_filename=data_source.original_filename,
            sample_data=data_source.sample_data,
            user_id=data_source.user_id
        )
    
    async def delete_data_source(
        self,
        data_source_id: str,
        user_id: str,
        session: Optional[AsyncSession] = None
    ) -> bool:
        """Delete a data source"""
        try:
            # Get existing data source
            result = await session.execute(
                select(DataSource).where(
                    and_(
                        DataSource.id == data_source_id,
                        DataSource.user_id == user_id
                    )
                )
            )
            data_source = result.scalar_one_or_none()
            
            if not data_source:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Data source not found"
                )
            
            # Soft delete by setting is_active to False
            data_source.is_active = False
            data_source.updated_at = datetime.now(timezone.utc)
            
            await session.commit()
            try:
                DS_DELETE_COUNTER.inc()
            except Exception:
                pass

            return True
            
        except HTTPException:
            raise
        except Exception as e:
            await session.rollback()
            logger.error(f"Error deleting data source: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to delete data source: {str(e)}"
            )
    
    async def test_connection(
        self,
        data_source_id: str,
        user_id: str,
        session: Optional[AsyncSession] = None
    ) -> Dict[str, Any]:
        """Test data source connection"""
        try:
            # Get data source
            result = await session.execute(
                select(DataSource).where(
                    and_(
                        DataSource.id == data_source_id,
                        DataSource.user_id == user_id
                    )
                )
            )
            data_source = result.scalar_one_or_none()
            
            if not data_source:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Data source not found"
                )
            
            # Test connection
            test_result = await self.real_data_manager.test_connection(data_source)
            
            # Update last accessed time
            data_source.last_accessed = datetime.now(timezone.utc)
            await session.commit()
            
            return {
                "success": test_result.success,
                "message": test_result.message,
                "connection_time": test_result.connection_time,
                "metadata": test_result.metadata
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error testing connection: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to test connection: {str(e)}"
            )
    
    async def execute_query(
        self,
        data_source_id: str,
        query: str,
        user_id: str,
        session: Optional[AsyncSession] = None
    ) -> Dict[str, Any]:
        """Execute query on data source"""
        try:
            # Get data source
            result = await session.execute(
                select(DataSource).where(
                    and_(
                        DataSource.id == data_source_id,
                        DataSource.user_id == user_id
                    )
                )
            )
            data_source = result.scalar_one_or_none()
            
            if not data_source:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Data source not found"
                )
            
            # Execute query
            query_result = await self.real_data_manager.execute_query(data_source, query)
            
            # Update last accessed time
            data_source.last_accessed = datetime.now(timezone.utc)
            await session.commit()
            
            return {
                "success": query_result.success,
                "data": query_result.data,
                "columns": query_result.columns,
                "row_count": query_result.row_count,
                "execution_time": query_result.execution_time,
                "error_message": query_result.error_message
            }
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error executing query: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to execute query: {str(e)}"
            )
    
    async def get_schema(
        self,
        data_source_id: str,
        user_id: str,
        session: Optional[AsyncSession] = None
    ) -> Dict[str, Any]:
        """Get data source schema"""
        try:
            # Get data source
            result = await session.execute(
                select(DataSource).where(
                    and_(
                        DataSource.id == data_source_id,
                        DataSource.user_id == user_id
                    )
                )
            )
            data_source = result.scalar_one_or_none()
            
            if not data_source:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Data source not found"
                )
            
            # Get schema
            schema = await self.real_data_manager.get_schema(data_source)
            
            # Update last accessed time
            data_source.last_accessed = datetime.now(timezone.utc)
            await session.commit()
            
            return schema
            
        except HTTPException:
            raise
        except Exception as e:
            logger.error(f"Error getting schema: {e}")
            raise HTTPException(
                status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
                detail=f"Failed to get schema: {str(e)}"
            )

# Global instance
data_sources_crud = DataSourcesCRUD()
