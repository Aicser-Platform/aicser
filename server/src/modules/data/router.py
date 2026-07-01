"""
Data Connectivity API
FastAPI endpoints for universal data connectivity
"""

import asyncio
import logging
import json
import re
import os
import tempfile
from typing import List, Dict, Any, Optional, Union
from datetime import datetime, timezone
import time
from fastapi import APIRouter, UploadFile, File, HTTPException, Form, Depends, status, Request
from pydantic import BaseModel, Field
from sqlalchemy.ext.asyncio import AsyncSession
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer
from src.modules.authentication.helpers import extract_user_payload
from src.db.session import get_async_session
from src.core.edition import is_ee_enabled
from .services.data_connectivity_service import DataConnectivityService
from .services.database_connector_service import DatabaseConnectorService
from .services.data_retention_service import DataRetentionService
from src.modules.data.services.multi_engine_query_service import (
    MultiEngineQueryService,
    QueryEngine,
    get_multi_engine_query_service,
    invalidate_api_response_cache,
)
from src.modules.data.cube_feature import is_external_cube_enabled
from src.modules.data.services.upload_datasource_storage_service import UploadDatasourceStorageService
from src.modules.authentication.rbac.guard import require_permission, user_id_from_payload, data_rbac_guard

# EE-only services. Keep these out of the CE import path because several of
# them pull in large AI/connector stacks during module import.
if is_ee_enabled():
    try:
        from ee.modules.authentication.rbac.rbac_service import RBACService
    except ImportError:
        RBACService = None  # type: ignore

    try:
        from ee.modules.data.services.intelligent_data_modeling_service import IntelligentDataModelingService
    except ImportError:
        IntelligentDataModelingService = None  # type: ignore

    try:
        from ee.modules.data.services.enterprise_connectors_service import EnterpriseConnectorsService, ConnectionConfig, ConnectorType
    except ImportError:
        EnterpriseConnectorsService = None  # type: ignore
        ConnectionConfig = None  # type: ignore
        ConnectorType = None  # type: ignore

    try:
        from ee.modules.data.services.delta_iceberg_connector import DeltaIcebergConnector
    except ImportError:
        DeltaIcebergConnector = None  # type: ignore
else:
    RBACService = None  # type: ignore
    IntelligentDataModelingService = None  # type: ignore
    EnterpriseConnectorsService = None  # type: ignore
    ConnectionConfig = None  # type: ignore
    ConnectorType = None  # type: ignore
    DeltaIcebergConnector = None  # type: ignore
import sqlalchemy as sa

try:
    from src.modules.data.services.cube_modeling_service import cube_modeling_service
except ImportError:
    cube_modeling_service = None  # Optional: Cube.js modeling not installed
from src.modules.authentication.deps.auth_bearer import current_user_payload
from src.modules.data.schemas import DataSourceUpdate, BusinessMetadataUpdate
from src.modules.data.services.data_sources_crud import DataSourcesCRUD
from src.modules.project.service import ProjectService
# OrganizationService removed - organization context removed
from src.modules.pricing.feature_gate import (
    get_organization_plan,
    get_user_organization_id,
    org_has_plan_feature,
    require_plan_feature,
)
from src.modules.pricing.rate_limiter import RateLimiter
from src.shared.query_limits import (
    DEFAULT_PAGE_LIMIT,
    DEFAULT_LIST_PAGE_LIMIT,
    MAX_DATA_SOURCES_CHECK,
    DEFAULT_PREVIEW_ROWS_REQUEST,
    PREVIEW_ROWS,
)

# Helper: resolve columns from normalized schema (tables[].columns) or legacy (schema.columns)
def _schema_columns(schema: Optional[Dict[str, Any]]) -> List[Dict[str, Any]]:
    if not schema or not isinstance(schema, dict):
        return []
    tables = schema.get("tables")
    if isinstance(tables, list) and tables and isinstance(tables[0], dict):
        return tables[0].get("columns") or []
    return schema.get("columns") or []


def _ce_can_read_data_source(row: Any, user_id: str) -> bool:
    """CE read access: creator-owned sources plus shared/sample sources."""
    if is_ee_enabled():
        return False
    owner_id = getattr(row, "user_id", None)
    return owner_id is None or str(owner_id) == user_id


# logger should be available for functions defined below
logger = logging.getLogger(__name__)


# verify_project_access function removed - organization/RBAC context removed

logger = logging.getLogger(__name__)

router = APIRouter()


def _require_external_cube() -> None:
    if not is_external_cube_enabled():
        raise HTTPException(
            status_code=503,
            detail="External Cube.js is disabled. Set AICSER_EXTERNAL_CUBE_ENABLED=true to enable.",
        )

# Service Instantiations
data_service = DataConnectivityService()
data_crud_service = DataSourcesCRUD()
# ProjectService uses static methods - no instantiation needed
# organization_service removed - organization context removed
database_connector = DatabaseConnectorService()
intelligent_data_modeling_service = (
    IntelligentDataModelingService() if IntelligentDataModelingService else None
)
multi_engine_service = get_multi_engine_query_service()
enterprise_connectors_service = (
    EnterpriseConnectorsService() if EnterpriseConnectorsService else None
)
delta_iceberg_connector = DeltaIcebergConnector() if DeltaIcebergConnector else None


async def _resolve_upload_project_id(user_id: str, requested_project_id: Optional[str]) -> str:
    """Resolve a real project id for upload storage.

    CE can reach upload before onboarding has provisioned org/project rows, while
    file_storage still has a projects FK in many dev databases. Create the same
    default org/project shape the onboarding flow would create.
    """
    import uuid
    from src.db.session import async_session

    if requested_project_id:
        try:
            requested_project_uuid = uuid.UUID(str(requested_project_id))
        except (TypeError, ValueError):
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="Invalid project_id format",
            )
        async with async_session() as db:
            existing_project = await db.execute(
                sa.text(
                    """
                    SELECT id
                    FROM projects
                    WHERE id = :project_id
                      AND is_active = true
                      AND is_deleted = false
                    LIMIT 1
                    """
                ),
                {"project_id": requested_project_uuid},
            )
            row = existing_project.fetchone()
            if row and row.id:
                return str(row.id)
        logger.warning(
            "Requested upload project_id %s does not exist; resolving a default project",
            requested_project_id,
        )

    try:
        user_projects, _ = await ProjectService.get_user_projects(user_id)
        if user_projects:
            project_id = str(user_projects[0].id)
            logger.info("📁 Resolved upload project_id from first user project: %s", project_id)
            return project_id
    except Exception as project_err:
        logger.warning("Could not resolve user project through ProjectService: %s", project_err)

    user_uuid = uuid.UUID(user_id)
    async with async_session() as db:
        existing = await db.execute(
            sa.text(
                """
                SELECT p.id
                FROM projects p
                JOIN user_roles ur ON ur.organization_id = p.organization_id
                WHERE ur.user_id = :user_id
                  AND ur.is_active = true
                  AND ur.is_deleted = false
                  AND p.is_active = true
                  AND p.is_deleted = false
                ORDER BY p.created_at ASC
                LIMIT 1
                """
            ),
            {"user_id": user_uuid},
        )
        row = existing.fetchone()
        if row and row.id:
            project_id = str(row.id)
            logger.info("📁 Resolved upload project_id from existing membership: %s", project_id)
            return project_id

        existing_source_project = await db.execute(
            sa.text(
                """
                SELECT project_id
                FROM data_sources
                WHERE user_id = :user_id
                  AND project_id IS NOT NULL
                ORDER BY created_at ASC
                LIMIT 1
                """
            ),
            {"user_id": user_uuid},
        )
        row = existing_source_project.fetchone()
        if row and row.project_id:
            project_id = str(row.project_id)
            logger.info("📁 Reusing upload project_id from existing user data source: %s", project_id)
            return project_id

    async with async_session() as db:
        org_result = await db.execute(
            sa.text(
                """
                INSERT INTO organizations (name, description, is_active, is_deleted)
                VALUES (:name, :description, true, false)
                RETURNING id
                """
            ),
            {"name": "My Workspace", "description": "Default workspace"},
        )
        org_row = org_result.fetchone()
        organization_id = org_row.id

        project_result = await db.execute(
            sa.text(
                """
                INSERT INTO projects (organization_id, name, is_private, is_active, is_deleted)
                VALUES (:organization_id, :name, true, true, false)
                RETURNING id
                """
            ),
            {"organization_id": organization_id, "name": "My Project"},
        )
        project_row = project_result.fetchone()
        project_id = str(project_row.id)

        try:
            org_role = await db.execute(
                sa.text(
                    """
                    SELECT id FROM roles
                    WHERE name = 'org_owner'
                      AND scope = 'organization'
                      AND is_active = true
                      AND is_deleted = false
                    LIMIT 1
                    """
                )
            )
            org_role_row = org_role.fetchone()
            if org_role_row:
                await db.execute(
                    sa.text(
                        """
                        INSERT INTO user_roles
                            (user_id, role_id, organization_id, assigned_by, is_active, is_deleted)
                        VALUES (:user_id, :role_id, :organization_id, :assigned_by, true, false)
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {
                        "user_id": user_uuid,
                        "role_id": org_role_row.id,
                        "organization_id": organization_id,
                        "assigned_by": user_uuid,
                    },
                )

            project_role = await db.execute(
                sa.text(
                    """
                    SELECT id FROM roles
                    WHERE name = 'project_owner'
                      AND scope = 'project'
                      AND is_active = true
                      AND is_deleted = false
                    LIMIT 1
                    """
                )
            )
            project_role_row = project_role.fetchone()
            if project_role_row:
                await db.execute(
                    sa.text(
                        """
                        INSERT INTO user_roles
                            (user_id, role_id, organization_id, project_id, assigned_by, is_active, is_deleted)
                        VALUES (:user_id, :role_id, :organization_id, :project_id, :assigned_by, true, false)
                        ON CONFLICT DO NOTHING
                        """
                    ),
                    {
                        "user_id": user_uuid,
                        "role_id": project_role_row.id,
                        "organization_id": organization_id,
                        "project_id": project_id,
                        "assigned_by": user_uuid,
                    },
                )
        except Exception as role_err:
            logger.warning("Default upload project created without role assignment: %s", role_err)

        await db.commit()
        logger.info("📁 Provisioned default upload project_id: %s", project_id)
        return project_id

    raise HTTPException(
        status_code=status.HTTP_400_BAD_REQUEST,
        detail="project_id is required for file upload. Select or create a project first.",
    )


async def enforce_data_source_limit(user_id: str, organization_id: Optional[str] = None) -> str:
    """
    Enforce data source creation limit based on the organization's subscription plan.
    Raises HTTPException(403) if the limit is reached.
    Returns the resolved organization_id.
    """
    if not user_id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Authentication required",
        )

    # CE has no subscription limits — skip plan checks entirely
    if not is_ee_enabled():
        return organization_id

    org_id = organization_id

    try:
        from src.db.session import async_session as _async_session
        from src.modules.billing.models import OrganizationSubscription, SubscriptionPlan
        from src.modules.data.models import DataSource
        from src.modules.project.models import Project
        from src.modules.pricing.plans import PLAN_CONFIGS
        from src.modules.pricing.usage_tracker import resolve_organization_id
        from sqlalchemy import select, and_, func as sa_func, or_ as _or
        from datetime import datetime as _dt, timezone as _tz

        async with _async_session() as db:
            # Resolve real organization UUID from user_roles when token lacks org claims
            if not org_id or (isinstance(org_id, str) and org_id.startswith("user-")):
                resolved = await resolve_organization_id(user_id, db)
                if resolved:
                    org_id = resolved
                else:
                    logger.warning(f"No org found for user {user_id}, using free plan limits")
                    org_id = None

            # Count active NON-sample data sources for the organization
            if org_id:
                ds_count_stmt = (
                    select(sa_func.count())
                    .select_from(DataSource)
                    .join(Project, DataSource.project_id == Project.id)
                    .where(
                        and_(
                            Project.organization_id == org_id,
                            DataSource.is_active == True,
                            DataSource.type != "sample_duckdb",
                        )
                    )
                )
            else:
                ds_count_stmt = (
                    select(sa_func.count())
                    .select_from(DataSource)
                    .where(
                        and_(
                            DataSource.user_id == user_id,
                            DataSource.type != "sample_duckdb",
                        )
                    )
                )
            result = await db.execute(ds_count_stmt)
            current_count = result.scalar() or 0

            # Get plan limits from active subscription (including canceled-in-period)
            max_ds = PLAN_CONFIGS['free']['max_data_sources']  # default
            if org_id:
                _now = _dt.now(_tz.utc)
                plan_stmt = (
                    select(SubscriptionPlan.limits)
                    .join(OrganizationSubscription, OrganizationSubscription.plan_id == SubscriptionPlan.id)
                    .where(
                        and_(
                            OrganizationSubscription.organization_id == org_id,
                            _or(
                                OrganizationSubscription.status.in_(['active', 'trialing']),
                                and_(
                                    OrganizationSubscription.status == 'canceled',
                                    OrganizationSubscription.ends_at != None,
                                    OrganizationSubscription.ends_at > _now,
                                ),
                            )
                        )
                    )
                )
                result = await db.execute(plan_stmt)
                limits = result.scalar_one_or_none()
                if limits:
                    max_ds = limits.get('max_data_sources', max_ds)

            # Check limit (-1 = unlimited)
            if max_ds != -1 and current_count >= max_ds:
                logger.warning(
                    f"⛔ Data source limit reached for org {org_id}: {current_count}/{max_ds}"
                )
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail={
                        "error": "data_source_limit_reached",
                        "message": f"Data source limit reached ({current_count}/{max_ds}). Please upgrade your plan to add more data sources.",
                        "current": current_count,
                        "limit": max_ds,
                    }
                )

            logger.info(f"✅ Data source limit check passed: {current_count}/{max_ds} for org {org_id}")

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Error checking data source limit for org {org_id}: {e}")
        # Fail open — don't block user on limit check failure

    return org_id


@router.post("/retention/cleanup")
async def cleanup_file_data_retention(
    request: Dict[str, Any],
    db: sa.ext.asyncio.AsyncSession = Depends(get_async_session),
):
    """
    Cleanup file-based data sources based on plan data_history_days.

    Body:
      { "organization_id": Optional[int] }

    Intended for admin/cron use.
    """
    try:
        org_id = request.get("organization_id")
        if org_id is not None:
            try:
                org_id = int(org_id)
            except (TypeError, ValueError):
                raise HTTPException(
                    status_code=status.HTTP_400_BAD_REQUEST,
                    detail="organization_id must be an integer",
                )

        retention_service = DataRetentionService(db)
        affected = await retention_service.cleanup_expired_file_sources(
            organization_id=org_id
        )
        return {
            "success": True,
            "affected": affected,
            "organization_id": org_id,
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Data retention cleanup failed: {e}", exc_info=True)
        raise HTTPException(status_code=500, detail=str(e))


# Request/Response Models
# Provider-specific params (also in connection_config): SQL Server: trust_server_certificate, driver;
# Snowflake: warehouse, schema, account; BigQuery: project_id, dataset; Redshift/PostgreSQL/MySQL: ssl_mode;
# All: connection_timeout, min_connections, max_connections (pool), ssl_cert, ssl_key, ssl_ca.
class DatabaseConnectionRequest(BaseModel):
    type: str
    host: Optional[str] = None
    port: Optional[int] = None
    database: Optional[str] = None
    username: Optional[str] = None
    password: Optional[str] = None
    name: Optional[str] = None
    uri: Optional[str] = None
    ssl_mode: Optional[str] = 'prefer'
    connection_type: Optional[str] = 'manual'  # 'manual', 'uri', or 'advanced'
    
    # Enterprise Security Features
    ssl_cert: Optional[str] = None
    ssl_key: Optional[str] = None
    ssl_ca: Optional[str] = None
    
    # SSH Tunnel Configuration
    ssh_host: Optional[str] = None
    ssh_port: Optional[int] = None
    ssh_username: Optional[str] = None
    ssh_password: Optional[str] = None
    ssh_key_path: Optional[str] = None
    
    # Connection Pool & Performance
    min_connections: Optional[int] = 1
    max_connections: Optional[int] = 10
    connection_timeout: Optional[int] = 30
    statement_timeout: Optional[int] = 300
    query_timeout: Optional[int] = 60
    
    # Database-specific options
    charset: Optional[str] = None
    compression: Optional[str] = None
    secure: Optional[str] = None
    trust_server_certificate: Optional[bool] = True  # SQL Server: default True for dev/Docker
    driver: Optional[str] = None  # SQL Server: ODBC driver name

    # NoSQL
    connection_string: Optional[str] = None  # MongoDB URI
    auth_source: Optional[str] = None  # MongoDB auth database
    keyspace: Optional[str] = None  # Cassandra keyspace
    datacenter: Optional[str] = None  # Cassandra local_dc
    region: Optional[str] = None  # DynamoDB/AWS region
    endpoint: Optional[str] = None  # DynamoDB optional endpoint URL
    access_key_id: Optional[str] = None  # DynamoDB/AWS (or accessKey from UI)
    secret_access_key: Optional[str] = None  # DynamoDB/AWS (or secretKey from UI)
    table_name: Optional[str] = None  # DynamoDB optional default table

    # Custom fields for non-standard databases
    custom_fields: Optional[Dict[str, Any]] = None

    # Project ownership
    project_id: Optional[str] = None


class DatabaseTestResponse(BaseModel):
    success: bool
    message: str
    connection_info: Optional[Dict[str, Any]] = None
    error: Optional[str] = None


class DataSourceCreateRequest(BaseModel):
    name: str
    type: str  # 'file', 'database', 'warehouse', 'api'
    description: Optional[str] = None
    business_context: Optional[str] = None
    config: Dict[str, Any]
    metadata: Optional[Dict[str, Any]] = None


class DataSourceQueryRequest(BaseModel):
    filters: Optional[List[Dict[str, Any]]] = None
    sort: Optional[Dict[str, str]] = None
    offset: Optional[int] = 0
    limit: Optional[int] = DEFAULT_PAGE_LIMIT


class ChatToChartRequest(BaseModel):
    data_source_id: str
    natural_language_query: str
    options: Optional[Dict[str, Any]] = None


class DataModelingRequest(BaseModel):
    data: List[Dict[str, Any]]
    file_metadata: Dict[str, Any]
    user_context: Optional[Dict[str, Any]] = None


class ModelingFeedbackRequest(BaseModel):
    modeling_id: str
    feedback: Dict[str, Any]


class CubeQueryRequest(BaseModel):
    query: Dict[str, Any]
    cube_name: Optional[str] = None


# Database connection endpoints
@router.post("/database/test")
async def test_database_connection(request: DatabaseConnectionRequest):
    """Test database connection without storing credentials. Returns 200 on success, 400 when the test fails."""
    try:
        logger.info(f"🔌 Testing database connection: {request.type}")

        connection_config = request.model_dump()
        result = await data_service.test_database_connection(connection_config)

        if result.get("success"):
            return DatabaseTestResponse(
                success=True,
                message="Database connection successful",
                connection_info=result.get("connection_info"),
            )
        # Connection test failed: return 400 so HTTP status reflects failure
        error_msg = result.get("error") or "Unknown error"
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=error_msg,
        )
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Database connection test failed: %s", str(e))
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(e),
        )


@router.post("/database/connect")
async def connect_database(request: DatabaseConnectionRequest, current_token: Union[str, dict] = Depends(JWTCookieBearer())):
    """Connect and store database connection with user ownership"""
    try:
        # Extract user ID from JWT token
        # JWTCookieBearer returns dict payload when possible, or token string
        try:
            if isinstance(current_token, dict):
                user_payload = current_token
            else:
                # If it's a string token, decode it
                user_payload = extract_user_payload(current_token)
            
            # Extract user_id from various possible fields
            user_id = str(user_payload.get('id') or user_payload.get('user_id') or user_payload.get('sub') or '')
            
            logger.info(f"🔍 Extracted user_id: {user_id} from payload keys: {list(user_payload.keys()) if isinstance(user_payload, dict) else 'not dict'}")
        except Exception as e:
            logger.error(f"❌ Failed to extract user_id from token: {str(e)}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
            user_id = ''

        if not user_id:
            logger.warning('connect_database attempted without authenticated user')
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Authentication required')

        # RBAC: verify user has data:connect permission
        await require_permission(
            user_id,
            "data:connect",
            organization_id=str(user_payload.get("organization_id") or user_payload.get("org_id") or "") or None,
            project_id=str(user_payload.get("project_id") or "") or None,
        )

        # Enforce data source limit based on plan
        org_id = str(user_payload.get('organization_id') or user_payload.get('org_id') or f"user-{user_id}")
        await enforce_data_source_limit(user_id, org_id)

        logger.info(f"🔌 Connecting to database: {request.type} for user {user_id}")
        
        # Handle URI-based connection
        if request.uri:
            logger.info("🔌 Database connection request via URI")
            # Parse URI and merge with request
            parsed_config = data_service._parse_database_uri(request.uri)
            # Merge with request, keeping name and type from request if provided
            connection_config = {
                **parsed_config,
                **{k: v for k, v in request.model_dump().items() if v is not None and k != 'uri'},
                'name': request.name or parsed_config.get('name') or f"{parsed_config.get('type')}_connection"
            }
        else:
            # Convert Pydantic model to dictionary; merge custom_fields so database/db from UI is top-level
            connection_config = request.model_dump()
            if connection_config.get("custom_fields") and isinstance(connection_config["custom_fields"], dict):
                for k, v in connection_config["custom_fields"].items():
                    if v is not None and connection_config.get(k) is None:
                        connection_config[k] = v
                del connection_config["custom_fields"]
        
        # Test connection first
        test_result = await data_service.test_database_connection(connection_config)
        if not test_result['success']:
            raise HTTPException(status_code=400, detail=f"Connection failed: {test_result.get('error')}")

        # CE has no project system — store by user_id only; EE requires an explicit project_id
        resolved_project_id = None if not is_ee_enabled() else connection_config.get('project_id')

        # Store the connection via service with user ownership
        # NOTE: Pass plain credentials - store_database_connection will validate and encrypt them
        connection_result = await data_service.store_database_connection(
            connection_config, user_id=user_id, project_id=resolved_project_id
        )
        if not connection_result or not connection_result.get('success'):
            err = (connection_result or {}).get('error') if isinstance(connection_result, dict) else 'Unknown error'
            raise HTTPException(status_code=500, detail=f"Failed to store connection: {err}")

        data_source_id = connection_result.get('data_source_id')
        if not data_source_id:
            raise HTTPException(status_code=500, detail="Missing data_source_id in connection result")

        return {
            "success": True,
            "message": "Database connected successfully",
            "data_source_id": data_source_id,
            "data_source": {
                "id": data_source_id,
                "name": connection_config.get('name') or f"{connection_config.get('type')}_connection",
                "type": "database",
                "db_type": connection_config.get('type'),
                "status": "connected",
                "connection_info": connection_result.get('connection_info', {})
            },
            "connection_info": connection_result.get('connection_info')
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Database connection failed: {str(e)}")
        import traceback
        error_trace = traceback.format_exc()
        logger.error(f"Full traceback: {error_trace}")
        raise HTTPException(status_code=500, detail=f"Database connection failed: {str(e)}")


@router.get("/sources")
async def get_data_sources(
    offset: int = 0,
    limit: int = DEFAULT_LIST_PAGE_LIMIT,
    project_id: Optional[str] = None,
    current_token: Union[str, dict] = Depends(JWTCookieBearer())
):
    """Get data sources for user's projects with authentication"""
    try:
        # Extract user ID from JWT token (JWTCookieBearer returns dict payload)
        user_id = None
        if isinstance(current_token, dict):
            user_id = str(current_token.get('id') or current_token.get('user_id') or current_token.get('sub') or '')
        if not user_id:
            logger.warning('get_data_sources attempted without authenticated user')
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Authentication required')

        from src.db.session import async_session
        from src.modules.data.models import DataSource
        from sqlalchemy import select, or_
        
        async with async_session() as db:
            if not is_ee_enabled():
                from uuid import UUID, uuid5, NAMESPACE_DNS
                from src.modules.data.services.data_sources_crud import DataSourceResponse

                try:
                    user_uuid = UUID(user_id)
                except (TypeError, ValueError):
                    user_uuid = uuid5(NAMESPACE_DNS, f"test-user-{user_id}")

                query = select(DataSource).where(
                    DataSource.is_active == True,
                    or_(
                        DataSource.user_id == user_uuid,
                        DataSource.user_id.is_(None),
                    ),
                )
                if project_id:
                    try:
                        project_uuid = UUID(project_id)
                        query = query.where(
                            or_(
                                DataSource.project_id == project_uuid,
                                DataSource.project_id.is_(None),
                            )
                        )
                    except ValueError:
                        raise HTTPException(
                            status_code=status.HTTP_400_BAD_REQUEST,
                            detail=f"Invalid project_id format: {project_id}",
                        )

                result = await db.execute(query.order_by(DataSource.created_at.desc()))
                data_sources = result.scalars().all()
                accessible_sources = [
                    DataSourceResponse(
                        id=ds.id,
                        name=ds.name,
                        type=ds.type,
                        format=ds.format,
                        db_type=ds.db_type,
                        description=ds.description,
                        connection_config=ds.connection_config,
                        project_id=str(ds.project_id) if ds.project_id else None,
                        is_active=ds.is_active,
                        created_at=ds.created_at.isoformat() if ds.created_at else None,
                        updated_at=ds.updated_at.isoformat() if ds.updated_at else None,
                        last_accessed=ds.last_accessed.isoformat() if ds.last_accessed else None,
                        connection_status="active" if ds.is_active else "inactive",
                        metadata={},
                        schema=ds.schema,
                        row_count=ds.row_count,
                        size=ds.size,
                        file_path=ds.file_path,
                        original_filename=ds.original_filename,
                        sample_data=ds.sample_data,
                        user_id=str(ds.user_id) if ds.user_id else None,
                    )
                    for ds in data_sources
                ]

                logger.info(f"✅ Found {len(accessible_sources)} CE data sources")
                return {
                    "success": True,
                    "data_sources": accessible_sources,
                }

            # Get user's projects
            user_projects, _ = await ProjectService.get_user_projects(user_id)
            project_ids = [str(p.id) for p in user_projects]
            
            logger.info(f"🔍 GET /sources - User {user_id} has {len(project_ids)} projects")
            
            if project_id:
                logger.info(f"📂 Filtering by project_id: {project_id}")
                # Return sources from this project if user is a member
                
                # Verify user has access to the requested project
                if project_id not in project_ids:
                    logger.warning(f"❌ User {user_id} not authorized for project {project_id}")
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to access this project"
                    )
                
                # Convert project_id to UUID
                from uuid import UUID
                try:
                    project_id_uuid = UUID(project_id)
                except ValueError:
                    raise HTTPException(
                        status_code=status.HTTP_400_BAD_REQUEST,
                        detail=f"Invalid project_id format: {project_id}"
                    )
                
                # Query sources in this project
                query = select(DataSource).where(
                    DataSource.is_active == True,
                    DataSource.project_id == project_id_uuid
                ).order_by(DataSource.created_at.desc())
                
                result = await db.execute(query)
                data_sources = result.scalars().all()
                
                # Convert to DataSourceResponse format
                from src.modules.data.services.data_sources_crud import DataSourceResponse
                accessible_sources = [
                    DataSourceResponse(
                        id=ds.id,
                        name=ds.name,
                        type=ds.type,
                        format=ds.format,
                        db_type=ds.db_type,
                        description=ds.description,
                        connection_config=ds.connection_config,
                        project_id=str(ds.project_id) if ds.project_id else None,
                        is_active=ds.is_active,
                        created_at=ds.created_at.isoformat() if ds.created_at else None,
                        updated_at=ds.updated_at.isoformat() if ds.updated_at else None,
                        last_accessed=ds.last_accessed.isoformat() if ds.last_accessed else None,
                        connection_status="active" if ds.is_active else "inactive",  # Derived from is_active
                        metadata={},  # Not stored in DB, return empty dict
                        schema=ds.schema,
                        row_count=ds.row_count,
                        size=ds.size,
                        file_path=ds.file_path,
                        original_filename=ds.original_filename,
                        sample_data=ds.sample_data,
                        user_id=str(ds.user_id) if ds.user_id else None
                    )
                    for ds in data_sources
                ]
                
                logger.info(f"✅ Found {len(accessible_sources)} data sources for project {project_id}")
            else:
                # Get all data sources from user's accessible projects
                from uuid import UUID
                project_uuids = [UUID(pid) for pid in project_ids]
                
                query = select(DataSource).where(
                    DataSource.is_active == True,
                    DataSource.project_id.in_(project_uuids)
                ).order_by(DataSource.created_at.desc())
                
                result = await db.execute(query)
                data_sources = result.scalars().all()
                
                # Convert to DataSourceResponse format
                from src.modules.data.services.data_sources_crud import DataSourceResponse
                accessible_sources = [
                    DataSourceResponse(
                        id=ds.id,
                        name=ds.name,
                        type=ds.type,
                        format=ds.format,
                        db_type=ds.db_type,
                        description=ds.description,
                        connection_config=ds.connection_config,
                        project_id=str(ds.project_id) if ds.project_id else None,
                        is_active=ds.is_active,
                        created_at=ds.created_at.isoformat() if ds.created_at else None,
                        updated_at=ds.updated_at.isoformat() if ds.updated_at else None,
                        last_accessed=ds.last_accessed.isoformat() if ds.last_accessed else None,
                        connection_status="active" if ds.is_active else "inactive",  # Derived from is_active
                        metadata={},  # Not stored in DB, return empty dict
                        schema=ds.schema,
                        row_count=ds.row_count,
                        size=ds.size,
                        file_path=ds.file_path,
                        original_filename=ds.original_filename,
                        sample_data=ds.sample_data,
                        user_id=str(ds.user_id) if ds.user_id else None
                    )
                    for ds in data_sources
                ]
                
                logger.info(f"✅ Found {len(accessible_sources)} total data sources")

        return {
            "success": True,
            "data_sources": accessible_sources
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to get data sources: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sources/test-google-sheet")
async def test_google_sheet_connection(request: Request):
    """Test Google Sheet URL (fetch CSV export). Body: sheet_url, gid? (optional). No auth required for test."""
    try:
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        sheet_url = (body.get("sheet_url") or "").strip()
        if not sheet_url:
            return {"success": False, "error": "sheet_url is required"}
        connection_config = {"sheet_url": sheet_url}
        if body.get("gid") not in (None, ""):
            connection_config["gid"] = str(body.get("gid")).strip()
        data_source = {"connection_config": connection_config}
        result = await data_service.get_google_sheets_schema(data_source)
        if result.get("success"):
            tables = (result.get("schema") or {}).get("tables") or []
            row_count = result.get("data_source", {}).get("row_count", 0)
            return {
                "success": True,
                "message": f"Connected. {len(tables)} table(s), {row_count} row(s) available.",
            }
        return {"success": False, "error": result.get("error", "Failed to connect to sheet")}
    except Exception as e:
        logger.warning("test_google_sheet_connection failed: %s", e)
        return {"success": False, "error": str(e)}


@router.post("/sources")
async def create_data_source(
    request: Request,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Create a data source (any type: database, api, file, etc.). Body: name, type, connection_config, description?, project_id?.
    If project_id is omitted, the user's first project is used. Used by the frontend for API and other types."""
    try:
        user_id = None
        if isinstance(current_token, dict):
            user_id = str(current_token.get("id") or current_token.get("user_id") or current_token.get("sub") or "")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Authentication required")
        if len(user_id) < 32 or "-" not in user_id:
            import uuid
            user_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"test-user-{user_id}"))
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        name = body.get("name") or "Unnamed"
        ds_type = body.get("type") or "file"
        description = body.get("description")
        config = body.get("config") or body.get("connection_config") or {}
        project_id = body.get("project_id")
        format_val = body.get("format") or (ds_type if ds_type != "file" else "api" if ds_type == "api" else "file")
        from src.modules.data.services.data_sources_crud import DataSourceCreate as CRUDDataSourceCreate
        from src.db.session import async_session
        create_data = CRUDDataSourceCreate(
            name=name,
            type=ds_type,
            format=format_val,
            description=description,
            connection_config=config,
            project_id=project_id,
            is_active=True,
        )
        async with async_session() as db:
            result = await data_crud_service.create_data_source(
                data_source_data=create_data,
                user_id=user_id,
                session=db,
            )
        # Data source is created with project_id set in CRUD; no separate project link needed
        return {
            "success": True,
            "data_source": {
                "id": result.id,
                "name": result.name,
                "type": result.type,
                "format": result.format,
                "description": result.description,
                "connection_config": result.connection_config,
                "is_active": result.is_active,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Create data source failed: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/upload")
async def upload_file(
    file: UploadFile = File(...),
    name: Optional[str] = Form(default=None),
    include_preview: bool = Form(default=False),
    sheet_name: Optional[str] = Form(default=None),
    delimiter: Optional[str] = Form(default=','),
    header_row: Optional[int] = Form(default=None),
    preview_only: bool = Form(default=False),  # Preview-only mode (doesn't save to database)
    upload_with_prompt: bool = Form(default=False),  # Whether file is uploaded with a prompt (enables in-memory storage)
    project_id: Optional[str] = Form(default=None),  # Project ID for file ownership
    current_token: Union[str, dict] = Depends(JWTCookieBearer())
):
    """Upload and process data file using the data service (requires authentication)
    
    Parameters:
        file: The file to upload (required)
        name: Optional name for the data source. If not provided, uses filename
        include_preview: Whether to include data preview in response
        sheet_name: Optional sheet name for Excel files
        delimiter: CSV delimiter (default: ',')
    """
    try:
        # Extract user ID from JWT token
        user_id = None
        if isinstance(current_token, dict):
            user_id = str(current_token.get('id') or current_token.get('user_id') or current_token.get('sub') or '')

        if not user_id:
            logger.warning('get_data_source attempted without authenticated user')
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Authentication required')

        # RBAC: verify user has data:upload permission
        upload_payload = current_token if isinstance(current_token, dict) else {}
        await require_permission(
            user_id,
            "data:upload",
            organization_id=str(upload_payload.get("organization_id") or upload_payload.get("org_id") or "") or None,
            project_id=str(project_id or "") or None,
        )

        # Enforce data source limit based on plan.
        # enforce_data_source_limit also resolves the real org_id from user_roles when the
        # token lacks it, and returns the resolved value — so capture it here.
        upload_org_id = None
        if isinstance(current_token, dict):
            upload_org_id = str(current_token.get('organization_id') or current_token.get('org_id') or '')
        if not upload_org_id:
            upload_org_id = f"user-{user_id}"
        upload_org_id = await enforce_data_source_limit(user_id, upload_org_id) or upload_org_id

        # DEBUG: Log file object details
        logger.info(f"📁 File upload request received")
        logger.info(f"📁 Project ID: {project_id}")
        logger.info(f"📁 File object: {file}")
        logger.info(f"📁 File type: {type(file)}")
        logger.info(f"📁 File filename: {file.filename if file else 'None'}")
        logger.info(f"📁 File size: {file.size if file and hasattr(file, 'size') else 'Unknown'}")
        logger.info(f"📁 User ID: {user_id}")

        # CE has no project system — store uploads by user_id only
        project_id = None if not is_ee_enabled() else await _resolve_upload_project_id(user_id, project_id)
        
        # Validate file - check if file is None or missing
        if file is None:
            logger.error("❌ File is None - FastAPI didn't receive the file field")
            raise HTTPException(status_code=400, detail="File field is missing from request. Ensure the FormData field name is 'file'.")
        
        if not file.filename:
            logger.error(f"❌ File filename is empty. File object: {file}")
            raise HTTPException(status_code=400, detail="No file provided or file has no filename")
        
        # Auto-generate name from filename if not provided
        if not name or name.strip() == '':
            # Remove extension and clean up the name
            name = file.filename.rsplit('.', 1)[0] if '.' in file.filename else file.filename
            # Clean up common patterns (e.g., remove timestamps, UUIDs)
            name = name.replace('file_', '').replace('_', ' ').strip()
            if not name:
                name = 'Uploaded File'
            logger.info(f"📁 Auto-generated data source name from filename: {name}")
        
        # Stream the upload directly to a temp file — avoids holding large files in memory.
        import shutil as _shutil
        file_extension = file.filename.rsplit('.', 1)[-1].lower() if '.' in file.filename else 'tmp'
        tmp_upload = tempfile.NamedTemporaryFile(delete=False, suffix=f".{file_extension}")
        try:
            await asyncio.to_thread(_shutil.copyfileobj, file.file, tmp_upload)
        finally:
            tmp_upload.close()

        tmp_upload_path = tmp_upload.name
        file_size = os.path.getsize(tmp_upload_path)

        if file_size == 0:
            os.unlink(tmp_upload_path)
            raise HTTPException(status_code=400, detail="File is empty")

        # Prepare options for the service
        options = {
            'include_data': include_preview,
            'sheet_name': sheet_name,
            'delimiter': delimiter,
            'header_row': header_row,
            'user_id': user_id,               # Keep user_id for ownership tracking
            'project_id': project_id,         # Pass project_id for file storage
            'organization_id': upload_org_id if upload_org_id and not str(upload_org_id).startswith("user-") else None,
            'upload_with_prompt': upload_with_prompt,  # Pass upload_with_prompt flag
            'name': name,                     # Pass name to service
            'preview_only': preview_only,    # Explicitly set preview_only flag
        }
        
        # Prevent duplicate display names (case-insensitive) for this project
        try:
            from src.db.session import async_session
            async with async_session() as db:
                # existing = await data_crud_service.list_data_sources(
                #     project_id=project_id,
                #     user_id=user_id,
                #     session=db
                # )
                existing = await data_service.get_data_sources(
                    # project_id=project_id,
                    # user_id=user_id,
                    0,
                    MAX_DATA_SOURCES_CHECK
                )
                # Check for name conflicts in the same project
                if any((ds.name or '').lower() == name.lower() for ds in existing):
                    raise HTTPException(status_code=400, detail="A data source with this name already exists. Please rename your file or choose a different name.")
        except HTTPException:
            raise
        except Exception as e:
            logger.warning(f"Failed to check for duplicate names: {str(e)}")
            pass

        # Use the data service to handle the upload
        try:
            if preview_only:
                options['preview_only'] = True
            result = await data_service.upload_file_from_path(
                tmp_file_path=tmp_upload_path,
                filename=file.filename,
                file_size=file_size,
                options=options,
            )
        finally:
            # Clean up the streamed temp file
            try:
                os.unlink(tmp_upload_path)
            except Exception:
                pass

        if preview_only:
            if result.get('success') and result.get('data_source'):
                return {
                    "success": True,
                    "data_source": {
                        "preview_data": result['data_source'].get('preview_data', []),
                        "sheets": result['data_source'].get('sheets', []),
                        "schema": result['data_source'].get('schema', []),
                        "row_count": result['data_source'].get('row_count', 0),
                    },
                    "message": "Preview generated successfully"
                }
            else:
                raise HTTPException(status_code=400, detail=result.get('error', 'Preview generation failed'))

        if result['success']:
            data_source = result['data_source']
            if 'user_id' not in data_source:
                data_source['user_id'] = user_id
            return {
                "success": True,
                "data_source": data_source,
                "message": f"File uploaded successfully: {result['data_source'].get('row_count', 0)} rows processed"
            }
        else:
            raise HTTPException(
                status_code=400,
                detail=f"File upload failed: {result.get('error', 'Unknown error')}"
            )

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ File upload failed: {str(e)}")
        import traceback
        error_trace = traceback.format_exc()
        logger.error(f"Full traceback: {error_trace}")
        raise HTTPException(status_code=500, detail=f"File upload failed: {str(e)}")



# Get data source endpoint
@router.get("/sources/{data_source_id}")
async def get_data_source(
    data_source_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
):
    """Get data source information - REQUIRES AUTHENTICATION and ownership verification"""
    try:
        # Extract user ID from JWT token - CRITICAL for security
        user_id = None
        if isinstance(current_token, dict):
            user_id = str(current_token.get('id') or current_token.get('user_id') or current_token.get('sub') or '')

        if not user_id:
            logger.warning('get_data_source attempted without authenticated user')
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Authentication required')

        logger.info(f"🔍 GET /sources/{data_source_id} - User ID: {user_id}")

        # Get data source and verify user has access via project membership
        from src.db.session import async_session
        from src.modules.data.models import DataSource
        from sqlalchemy import select
        
        async with async_session() as db:
            # First, get the data source
            query = select(DataSource).where(
                DataSource.id == data_source_id,
                DataSource.is_active == True
            )
            result = await db.execute(query)
            data_source = result.scalar_one_or_none()
            
            if not data_source:
                logger.warning(f"❌ Data source {data_source_id} not found")
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Data source not found"
                )
            
            logger.info(f"📊 Data source found - id: {data_source.id}, project_id: {data_source.project_id}")
            
            # Allow if user created this data source (creator ownership)
            creator_ok = (
                getattr(data_source, "user_id", None) is not None
                and str(data_source.user_id) == user_id
            )
            if creator_ok:
                logger.info(f"✅ Access granted for data source {data_source_id} (creator)")
            elif not is_ee_enabled():
                # CE: only the creator may access; no project role system
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Not authorized to access this data source",
                )
            else:
                # EE: verify user has access via project membership
                user_projects, _ = await ProjectService.get_user_projects(user_id)
                project_ids = [str(p.id) for p in user_projects]
                logger.info(f"👤 User {user_id} has access to {len(user_projects)} projects: {project_ids[:3]}...")
                user_has_project_access = (
                    data_source.project_id is not None
                    and str(data_source.project_id) in project_ids
                )
                if not user_has_project_access:
                    logger.warning(
                        "Data source project_id=%s not in user projects (count=%s)",
                        data_source.project_id,
                        len(project_ids),
                    )
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to access this data source",
                    )
                logger.info(f"✅ Access granted for data source {data_source_id} (project member)")
        
        # Get full data source info from service (now that we've verified ownership)
        result = await data_service.get_data_source(data_source_id)
        
        if result['success']:
            return {
                "success": True,
                "data_source": result['data_source']
            }
        else:
            raise HTTPException(status_code=404, detail=result['error'])
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Get data source failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Query data source endpoint (deprecated — use POST /data/query/execute)
@router.post("/sources/{data_source_id}/query", deprecated=True)
async def query_data_source(
    data_source_id: str,
    request: DataSourceQueryRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session)
):
    """Query data from data source. Deprecated: prefer POST /data/query/execute."""
    try:
        # Extract user ID from JWT token - CRITICAL for security
        try:
            user_payload = extract_user_payload(current_token)
            user_id = str(user_payload.get('id') or user_payload.get('user_id') or user_payload.get('sub') or '')
        except Exception:
            user_id = ''

        if not user_id:
            logger.warning('query_data_source attempted without authenticated user')
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Authentication required')

        # Get data source and verify user has access via project membership
        from src.db.session import async_session
        from src.modules.data.models import DataSource
        from sqlalchemy import select
        
        async with async_session() as db:
            # First, get the data source
            query = select(DataSource).where(
                DataSource.id == data_source_id,
                DataSource.is_active == True
            )
            result = await db.execute(query)
            data_source = result.scalar_one_or_none()
            
            if not data_source:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Data source not found"
                )
            
            if is_ee_enabled():
                # Verify user has access to the project
                user_projects, _ = await ProjectService.get_user_projects(user_id)
                project_ids = [str(p.id) for p in user_projects]
                
                if str(data_source.project_id) not in project_ids:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to query this data source"
                    )
            elif data_source.user_id is not None and str(data_source.user_id) != user_id:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Not authorized to query this data source"
                )
        
        logger.info(f"🔍 Data source query: {data_source_id} (user: {user_id})")
        
        query = {
            'filters': request.filters or [],
            'sort': request.sort,
            'offset': request.offset,
            'limit': request.limit
        }
        
        result = await data_service.query_data_source(data_source_id, query)
        
        if result['success']:
            return {
                "success": True,
                "data": result['data'],
                "total_rows": result.get('total_rows', len(result['data'])),
                "offset": result.get('offset', 0),
                "limit": result.get('limit', len(result['data'])),
                "schema": result.get('schema'),
                "deprecated": True,
                "redirect_to": "/api/data/query/execute",
            }
        else:
            raise HTTPException(status_code=400, detail=result['error'])
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Data source query failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Update data source endpoint (edit existing connection). Support both PUT and PATCH (some proxies allow PATCH only).
@router.put("/sources/{data_source_id}")
@router.patch("/sources/{data_source_id}")
async def update_data_source(
    data_source_id: str,
    request: Request,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Update an existing data source (name, description, connection_config, is_active). Requires ownership."""
    try:
        user_id = None
        if isinstance(current_token, dict):
            user_id = str(current_token.get("id") or current_token.get("user_id") or current_token.get("sub") or "")

        if not user_id:
            logger.warning("update_data_source attempted without authenticated user")
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Authentication required")

        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}

        from src.modules.data.services.data_connectivity_service import _normalize_connection_config
        from src.modules.data.services.data_sources_crud import DataSourceUpdate as CRUDDataSourceUpdate

        name = body.get("name")
        description = body.get("description")
        connection_config = body.get("connection_config")
        is_active = body.get("is_active")

        if connection_config is not None and isinstance(connection_config, dict):
            connection_config = _normalize_connection_config(connection_config)
            # Parse URI for host/port/database/type; do not overwrite password/username if user set them in the form
            uri_raw = connection_config.get("uri") or connection_config.get("connection_string")
            if uri_raw and isinstance(uri_raw, str) and uri_raw.strip():
                try:
                    parsed = data_service._parse_database_uri(uri_raw.strip())
                    if parsed:
                        for key in ("host", "port", "database", "username", "password", "type"):
                            if key not in parsed or parsed[key] in (None, ""):
                                continue
                            if key in ("password", "username"):
                                # Prefer form value over URI so user can correct password without editing the URI
                                if (connection_config.get(key) or "").strip():
                                    continue
                            connection_config[key] = parsed[key]
                except Exception:
                    pass

        update_data = CRUDDataSourceUpdate(
            name=name,
            description=description,
            connection_config=connection_config,
            is_active=is_active,
        )

        # Verify access (creator or project member) same as get_data_source, then update by id
        from src.db.session import async_session
        from src.modules.data.models import DataSource
        from sqlalchemy import select

        async with async_session() as db:
            row = (await db.execute(
                select(DataSource).where(
                    DataSource.id == data_source_id,
                    DataSource.is_active == True,
                )
            )).scalar_one_or_none()
            if not row:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Data source not found",
                )
            creator_ok = (
                getattr(row, "user_id", None) is not None
                and str(row.user_id) == user_id
            )
            if not creator_ok:
                if not is_ee_enabled():
                    # CE: no project role system — only the creator may update
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to update this data source",
                    )
                # EE: allow any project member to update
                user_projects, _ = await ProjectService.get_user_projects(user_id)
                project_ids = [str(p.id) for p in user_projects]
                if not (row.project_id is not None and str(row.project_id) in project_ids):
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to update this data source",
                    )
            updated = await data_crud_service.update_data_source_by_id(
                data_source_id=data_source_id,
                update_data=update_data,
                session=db,
            )

        # Invalidate caches so schema fetch and next reads use updated connection config (e.g. new password)
        try:
            data_service.invalidate_data_source_cache(data_source_id)
        except Exception:
            pass
        try:
            invalidate_api_response_cache(data_source_id)
        except Exception:
            pass
        try:
            from src.modules.ai.services.langgraph_orchestrator import LangGraphMultiAgentOrchestrator
            LangGraphMultiAgentOrchestrator.invalidate_schema_cache(data_source_id)
        except Exception as inv_err:
            logger.debug("Schema cache invalidation skipped: %s", inv_err)
        try:
            from src.core.cache import cache
            if cache:
                cache.delete(f"ds:{data_source_id}")
        except Exception:
            pass
        if connection_config is not None:
            from src.modules.data.services.pool_invalidation import dispose_direct_sql_pool_for_data_source
            dispose_direct_sql_pool_for_data_source(data_source_id)
        # Invalidate SQL feedback cache so stale NL→SQL pairs don't surface after reconnect/schema change
        try:
            from src.modules.ai.utils.sql_feedback_store import invalidate_for_data_source as _inv_feedback
            _inv_feedback(data_source_id)
        except Exception:
            pass

        return {
            "success": True,
            "data_source": {
                "id": updated.id,
                "name": updated.name,
                "type": updated.type,
                "format": getattr(updated, "format", None),
                "db_type": getattr(updated, "db_type", None),
                "description": getattr(updated, "description", None),
                "connection_config": getattr(updated, "connection_config", None),
                "is_active": updated.is_active,
                "created_at": updated.created_at.isoformat() if updated.created_at else None,
                "updated_at": updated.updated_at.isoformat() if updated.updated_at else None,
                "connection_status": getattr(updated, "connection_status", None),
                "metadata": getattr(updated, "metadata", None),
                "schema": getattr(updated, "schema", None),
                "row_count": getattr(updated, "row_count", None),
                "size": getattr(updated, "size", None),
                "project_id": str(updated.project_id) if getattr(updated, "project_id", None) else None,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Update data source failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.patch("/sources/{data_source_id}/business-metadata")
async def patch_business_metadata(
    data_source_id: str,
    body: BusinessMetadataUpdate,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Update business_metadata (measures, dimensions, column_descriptions) for a data source. Merges into schema and invalidates AI schema cache."""
    try:
        user_id = None
        if isinstance(current_token, dict):
            user_id = str(current_token.get("id") or current_token.get("user_id") or current_token.get("sub") or "")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Authentication required")
        import uuid as uuid_mod
        try:
            uuid_mod.UUID(user_id)
        except (ValueError, TypeError):
            user_id = str(uuid_mod.uuid5(uuid_mod.NAMESPACE_DNS, f"test-user-{user_id}"))

        from sqlalchemy import select
        from src.modules.data.models import DataSource
        from src.modules.data.services.data_sources_crud import DataSourceUpdate as CRUDDataSourceUpdate

        from src.db.session import async_session

        async with async_session() as db:
            q = select(DataSource).where(
                DataSource.id == data_source_id,
                DataSource.is_active == True,
            )
            result = await db.execute(q)
            data_source = result.scalar_one_or_none()
            if not data_source:
                raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Data source not found")

            current_schema = dict(data_source.schema) if isinstance(data_source.schema, dict) else {}
            bm = dict(current_schema.get("business_metadata") or {})
            if body.measures is not None:
                bm["measures"] = body.measures
            if body.dimensions is not None:
                bm["dimensions"] = body.dimensions
            if body.column_descriptions is not None:
                bm["column_descriptions"] = body.column_descriptions
            if body.ontology_mapping is not None:
                bm["ontology_mapping"] = body.ontology_mapping
            current_schema["business_metadata"] = bm

            updated = await data_crud_service.update_data_source(
                data_source_id=data_source_id,
                update_data=CRUDDataSourceUpdate(schema=current_schema),
                user_id=user_id,
                session=db,
            )

        try:
            from src.modules.ai.services.langgraph_orchestrator import LangGraphMultiAgentOrchestrator
            LangGraphMultiAgentOrchestrator.invalidate_schema_cache(data_source_id)
        except Exception as inv_err:
            logger.debug("Schema cache invalidation skipped: %s", inv_err)
        try:
            from src.core.cache import cache
            if cache:
                cache.delete(f"ds:{data_source_id}")
        except Exception:
            pass
        # Rebuild schema index for Schema RAG when business_metadata (e.g. column_descriptions) changes.
        try:
            from src.modules.ai.services.schema_index_service import build_schema_index_for_data_source
            result = await build_schema_index_for_data_source(db, data_source_id, current_schema)
            logger.debug("Schema index rebuilt after business-metadata patch: %s", result)
        except Exception as idx_err:
            logger.warning("Schema index build after business-metadata patch failed: %s", idx_err)
        # Invalidate SQL feedback cache — business metadata (table/column descriptions) changes the semantic contract
        try:
            from src.modules.ai.utils.sql_feedback_store import invalidate_for_data_source as _inv_fb
            _inv_fb(data_source_id)
        except Exception:
            pass

        return {
            "success": True,
            "business_metadata": bm,
            "data_source": {"id": updated.id, "schema": getattr(updated, "schema", current_schema)},
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("PATCH business-metadata failed: %s", e)
        raise HTTPException(status_code=500, detail=str(e))


# Create data source under project path (frontend and Docker tests call this)
@router.post("/api/organizations/{organization_id}/projects/{project_id}/data-sources")
async def create_data_source_via_project_path(
    organization_id: str,
    project_id: str,
    request: Request,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Create a data source and optionally link to project. Returns { success, data_source: { id, ... } }."""
    try:
        user_id = None
        if isinstance(current_token, dict):
            user_id = str(current_token.get("id") or current_token.get("user_id") or current_token.get("sub") or "")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Authentication required")

        # Enforce data source limit based on plan
        await enforce_data_source_limit(user_id, organization_id)

        # DB expects user_id as UUID; convert short test ids (e.g. "1") to a deterministic UUID
        if len(user_id) < 32 or "-" not in user_id:
            import uuid
            user_id = str(uuid.uuid5(uuid.NAMESPACE_DNS, f"test-user-{user_id}"))
        try:
            body = await request.json()
        except Exception:
            body = {}
        if not isinstance(body, dict):
            body = {}
        name = body.get("name") or "Unnamed"
        ds_type = body.get("type") or "file"
        description = body.get("description")
        config = body.get("config") or body.get("connection_config") or {}
        # CRUD expects format (e.g. csv, postgresql)
        format_val = body.get("format") or (ds_type if ds_type != "file" else "file")
        from src.modules.data.services.data_sources_crud import DataSourceCreate as CRUDDataSourceCreate
        from src.db.session import async_session
        create_data = CRUDDataSourceCreate(
            name=name,
            type=ds_type,
            format=format_val,
            description=description,
            connection_config=config,
            project_id=project_id,
            is_active=True,
        )
        async with async_session() as db:
            result = await data_crud_service.create_data_source(
                data_source_data=create_data,
                user_id=user_id,
                session=db,
            )
        # Optionally link to project (project_data_sources table)
        try:
            await project_service.add_data_source_to_project(
                project_id, str(result.id), ds_type, user_id
            )
        except Exception as link_err:
            logger.debug("Project link skipped: %s", link_err)
        return {
            "success": True,
            "data_source": {
                "id": result.id,
                "name": result.name,
                "type": result.type,
                "format": result.format,
                "description": result.description,
                "connection_config": result.connection_config,
                "is_active": result.is_active,
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("Create data source via project path failed: %s", str(e))
        raise HTTPException(status_code=500, detail=str(e))


# Alias for frontend URL: PUT/PATCH /data/api/organizations/{org}/projects/{proj}/data-sources/{id}
@router.put("/api/organizations/{organization_id}/projects/{project_id}/data-sources/{data_source_id}")
@router.patch("/api/organizations/{organization_id}/projects/{project_id}/data-sources/{data_source_id}")
async def update_data_source_via_project_path(
    organization_id: str,
    project_id: str,
    data_source_id: str,
    request: Request,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Update data source (same as PUT /sources/{id}). Exposed under project path for frontend compatibility."""
    return await update_data_source(data_source_id, request, current_token)


# Delete data source endpoint
@router.delete("/sources/{data_source_id}")
async def delete_data_source(data_source_id: str, current_token: Union[str, dict] = Depends(JWTCookieBearer())):
    """Delete data source with project-based access check"""
    try:
        # Extract user ID from JWT token
        user_id = None
        if isinstance(current_token, dict):
            user_id = str(current_token.get('id') or current_token.get('user_id') or current_token.get('sub') or '')

        if not user_id:
            logger.warning('delete_data_source attempted without authenticated user')
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Authentication required')

        # Verify user has access to the data source via project membership, then soft-delete (is_active=False)
        from src.db.session import async_session
        from src.modules.data.models import DataSource
        from sqlalchemy import select

        async with async_session() as db:
            # Get the data source
            query = select(DataSource).where(
                DataSource.id == data_source_id,
                DataSource.is_active == True
            )
            result = await db.execute(query)
            data_source = result.scalar_one_or_none()

            if not data_source:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Data source not found"
                )

            # CE: owner-only check (no org/project roles exist)
            if not is_ee_enabled():
                if getattr(data_source, "user_id", None) is None or str(data_source.user_id) != user_id:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to delete this data source",
                    )
            else:
                # EE: verify user has access via project membership
                user_projects, _ = await ProjectService.get_user_projects(user_id)
                project_ids = [str(p.id) for p in user_projects]
                if str(data_source.project_id) not in project_ids:
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Not authorized to delete this data source",
                    )

            # Soft-delete; list filters is_active == True so it disappears
            data_source.is_active = False
            data_source.updated_at = datetime.now(timezone.utc)
            await db.commit()

        from src.modules.data.services.pool_invalidation import dispose_direct_sql_pool_for_data_source
        dispose_direct_sql_pool_for_data_source(data_source_id)

        return {"success": True, "message": "Data source deleted successfully"}
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Delete data source failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Integrated chat-to-chart workflow endpoint (LangGraph single entry path)
@router.post("/chat-to-chart")
async def chat_to_chart_workflow(
    request: ChatToChartRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer())
):
    """
    Integrated chat-to-chart workflow using LangGraph orchestrator (single entry path).

    Uses the same AI workflow as /api/ai/analyze: route → nl2sql → validate → execute → unified chart+insights.
    Response shape is kept for backward compatibility with existing callers.
    """
    import uuid
    try:
        logger.info(f"💬 Chat-to-chart request: \"{request.natural_language_query}\" for data source {request.data_source_id}")

        try:
            user_payload = extract_user_payload(current_token)
            user_id = str(user_payload.get('id') or user_payload.get('sub') or '')
            organization_id = str(user_payload.get('organization_id') or 'default-org')
        except Exception:
            user_id = ''
            organization_id = 'default-org'

        if not user_id:
            logger.warning('chat_to_chart_workflow attempted without authenticated user')
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Authentication required')

        from src.modules.ai.services.langgraph_orchestrator import LangGraphMultiAgentOrchestrator
        from src.modules.ai.services.litellm_service import LiteLLMService
        from src.db.session import async_session, get_sync_session

        litellm_service = LiteLLMService()
        orchestrator = LangGraphMultiAgentOrchestrator(
            async_session_factory=async_session,
            sync_session_factory=get_sync_session,
            litellm_service=litellm_service,
            data_service=data_service,
            multi_query_service=get_multi_engine_query_service(),
        )

        conversation_id = str(uuid.uuid4())

        result = await orchestrator.execute(
            query=request.natural_language_query,
            conversation_id=conversation_id,
            user_id=user_id,
            organization_id=organization_id,
            project_id=None,
            data_source_id=request.data_source_id,
            analysis_mode="standard",
        )

        em = result.get("execution_metadata") or {}
        chart_type = em.get("chart_type") or "bar"
        if result.get("echarts_config") and isinstance(result["echarts_config"], dict):
            series = result["echarts_config"].get("series") or []
            if series and isinstance(series, list) and len(series) > 0:
                s0 = series[0] if isinstance(series[0], dict) else {}
                if s0.get("type") in ("line", "bar", "pie", "scatter"):
                    chart_type = s0.get("type", chart_type)

        response = {
            "success": result.get("success", True),
            "natural_language_query": request.natural_language_query,
            "data_source": {"id": request.data_source_id},
            "analytics": {"query_analysis": em.get("reasoning_steps", [])},
            "chart": {
                "type": chart_type,
                "config": result.get("echarts_config") or result.get("chart_config") or {},
                "data_analysis": {"query_result": result.get("query_result"), "insights": result.get("insights")},
            },
            "result": result.get("message") or result.get("narration") or "",
            "metadata": em,
            "routing_decision": {},
            "timestamp": datetime.now().isoformat(),
        }

        logger.info("✅ Chat-to-chart workflow completed successfully")
        return response

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Chat-to-chart workflow failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Database connectors endpoint
@router.get("/supported-databases")
async def get_supported_databases():
    """Get supported database types from Cube.js"""
    try:
        result = await data_service.get_supported_databases()
        
        return {
            "success": True,
            "supported_databases": result['supported_databases'],
            "cube_integration": True
        }
        
    except Exception as e:
        logger.error(f"❌ Get supported databases failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Intelligent Data Modeling endpoints
@router.post("/intelligent-modeling")
async def intelligent_data_modeling(request: DataModelingRequest):
    """
    AI-powered intelligent data modeling workflow
    
    This endpoint:
    1. Analyzes data with AI (LiteLLM)
    2. Generates Cube.js schema (YAML + visual)
    3. Provides user approval workflow
    4. Learns from feedback for continuous improvement
    """
    try:
        logger.info(f"🧠 Intelligent modeling request for: {request.file_metadata.get('name')}")
        
        result = await intelligent_data_modeling_service.analyze_and_model_data(
            data=request.data,
            file_metadata=request.file_metadata,
            user_context=request.user_context
        )
        
        return {
            "success": result.get('success', False),
            "modeling_result": result,
            "workflow_type": "intelligent_data_modeling",
            "ai_enhanced": not result.get('data_analysis', {}).get('ai_analysis', {}).get('fallback', False)
        }
        
    except Exception as e:
        logger.error(f"❌ Intelligent modeling failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/modeling-feedback")
async def submit_modeling_feedback(request: ModelingFeedbackRequest):
    """Submit user feedback for continuous learning"""
    try:
        logger.info(f"📝 Processing modeling feedback: {request.modeling_id}")
        
        result = await intelligent_data_modeling_service.process_user_feedback(
            modeling_id=request.modeling_id,
            feedback=request.feedback
        )
        
        return result
        
    except Exception as e:
        logger.error(f"❌ Feedback processing failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/modeling-patterns")
async def get_learned_patterns():
    """Get learned patterns from user feedback"""
    try:
        return {
            "success": True,
            "learned_patterns": intelligent_data_modeling_service.learned_patterns,
            "feedback_count": len(intelligent_data_modeling_service.feedback_history),
            "learning_confidence": min(len(intelligent_data_modeling_service.feedback_history) / 10, 1.0)
        }
    except Exception as e:
        logger.error(f"❌ Get patterns failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Cube.js Integration endpoints (via MultiEngineQueryService.CubeEngine HTTP client)
@router.get("/cube/status")
async def get_cube_status():
    """Get Cube.js connection status via CubeEngine HTTP client"""
    if not is_external_cube_enabled():
        return {"success": False, "cube_status": "disabled", "message": "Set AICSER_EXTERNAL_CUBE_ENABLED=true to use external Cube.js"}
    try:
        cube_url = os.getenv("CUBE_API_URL", "")
        if not cube_url:
            return {"success": False, "cube_status": "not_configured", "message": "CUBE_API_URL not set"}
        import httpx
        async with httpx.AsyncClient(timeout=5.0) as client:
            resp = await client.get(f"{cube_url}/cubejs-api/v1/meta")
            return {
                "success": resp.status_code == 200,
                "cube_status": "connected" if resp.status_code == 200 else "unreachable",
                "cube_url": cube_url,
                "http_status": resp.status_code,
            }
    except Exception as e:
        logger.error(f"Cube status check failed: {e}")
        return {"success": False, "cube_status": "error", "message": str(e)}


@router.post("/cube/connect")
async def connect_to_cube():
    """Verify Cube.js connectivity (idempotent health check)"""
    return await get_cube_status()


@router.get("/cube/metadata")
async def get_cube_metadata():
    """Get Cube.js cubes/views metadata via REST API"""
    _require_external_cube()
    try:
        cube_url = os.getenv("CUBE_API_URL", "")
        cube_secret = os.getenv("CUBE_API_SECRET", "")
        if not cube_url:
            raise HTTPException(status_code=503, detail="Cube.js not configured (CUBE_API_URL not set)")
        import httpx
        headers = {"Authorization": f"Bearer {cube_secret}"} if cube_secret else {}
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(f"{cube_url}/cubejs-api/v1/meta", headers=headers)
            if resp.status_code != 200:
                raise HTTPException(status_code=resp.status_code, detail=f"Cube meta returned {resp.status_code}")
            return {"success": True, "meta": resp.json()}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cube metadata failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cube/query")
async def execute_cube_query(
    request: CubeQueryRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer())
):
    """Execute query against Cube.js (Enterprise plan only)"""
    _require_external_cube()
    try:
        # Extract organization_id from token
        user_id = None
        organization_id = None
        if isinstance(current_token, dict):
            user_id = current_token.get('id') or current_token.get('user_id') or current_token.get('sub')
            organization_id = current_token.get('organization_id')
        elif isinstance(current_token, str):
            user_payload = extract_user_payload(current_token)
            user_id = user_payload.get('id') or user_payload.get('user_id') or user_payload.get('sub')
            organization_id = user_payload.get('organization_id')
        
        # Check if organization has Enterprise plan (Cube.js access)
        if organization_id:
            from src.db.session import async_session
            async with async_session() as db:
                from src.modules.organizations.models import Organization
                result = await db.execute(
                    sa.text("SELECT plan_type FROM organizations WHERE id = :org_id"),
                    {"org_id": int(organization_id) if isinstance(organization_id, (int, str)) and str(organization_id).isdigit() else organization_id}
                )
                org_row = result.fetchone()
                if org_row and org_row.plan_type != 'enterprise':
                    raise HTTPException(
                        status_code=status.HTTP_403_FORBIDDEN,
                        detail="Cube.js Analytics is available on Enterprise plan only. Please upgrade to access this feature."
                    )
        
        logger.info("Cube.js query request")

        cube_url = os.getenv("CUBE_API_URL", "")
        cube_secret = os.getenv("CUBE_API_SECRET", "")
        if not cube_url:
            raise HTTPException(status_code=503, detail="Cube.js not configured (CUBE_API_URL not set)")
        import httpx
        headers = {"Authorization": f"Bearer {cube_secret}"} if cube_secret else {}
        payload = {"query": request.query} if isinstance(request.query, dict) else {"query": request.query}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{cube_url}/cubejs-api/v1/load", json=payload, headers=headers)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=f"Cube query returned {resp.status_code}: {resp.text[:200]}")
        result = resp.json()
        return {"success": True, "data": result.get("data", []), "query": request.query}
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Cube query failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cube/suggestions")
async def get_cube_suggestions(query: str):
    """Get cube name suggestions matching a query string from Cube metadata"""
    try:
        meta_resp = await get_cube_metadata()
        cubes = meta_resp.get("meta", {}).get("cubes", [])
        q = query.lower()
        suggestions = [
            {"name": c["name"], "title": c.get("title", c["name"])}
            for c in cubes
            if q in c["name"].lower() or q in c.get("title", "").lower()
        ][:10]
        return {"success": True, "suggestions": suggestions, "query": query}
    except Exception as e:
        logger.error(f"Cube suggestions failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cube/{cube_name}/preview")
async def get_cube_preview(cube_name: str, limit: int = PREVIEW_ROWS):
    """Get preview data from a Cube by executing a simple select query"""
    try:
        cube_url = os.getenv("CUBE_API_URL", "")
        cube_secret = os.getenv("CUBE_API_SECRET", "")
        if not cube_url:
            raise HTTPException(status_code=503, detail="Cube.js not configured")
        import httpx
        headers = {"Authorization": f"Bearer {cube_secret}"} if cube_secret else {}
        payload = {"query": {"dimensions": [f"{cube_name}.id"], "limit": min(limit, 100)}}
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(f"{cube_url}/cubejs-api/v1/load", json=payload, headers=headers)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=f"Cube preview failed: {resp.text[:200]}")
        data = resp.json().get("data", [])
        return {"success": True, "cube_name": cube_name, "data": data, "row_count": len(data)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cube preview failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


# Health check endpoint
@router.get("/health")
async def health_check():
    """Health check for data connectivity service"""
    return {
        "success": True,
        "service": "data_connectivity",
        "status": "healthy",
        "supported_formats": ["csv", "xlsx", "xls", "json", "tsv", "parquet", "parq", "snappy"],
        "max_file_size_mb": 50.0,
        "cube_integration": True,
        "litellm_integration": True,
        "intelligent_modeling": True
    }


# Get uploaded data endpoint
@router.get("/sources/{data_source_id}/data")
async def get_data_source_data(
    data_source_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer())
):
    """Get data from uploaded data source - REQUIRES AUTHENTICATION and ownership verification"""
    try:
        # Extract user ID from JWT token - CRITICAL for security
        try:
            user_payload = extract_user_payload(current_token)
            user_id = str(user_payload.get('id') or user_payload.get('user_id') or user_payload.get('sub') or '')
        except Exception:
            user_id = ''

        if not user_id:
            logger.warning('get_data_source_data attempted without authenticated user')
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Authentication required')

        # Get data source and verify user has access via project membership
        from src.db.session import async_session
        from src.modules.data.models import DataSource
        from sqlalchemy import select
        
        async with async_session() as db:
            # First, get the data source
            query = select(DataSource).where(
                DataSource.id == data_source_id,
                DataSource.is_active == True
            )
            result = await db.execute(query)
            data_source_db = result.scalar_one_or_none()
            
            if not data_source_db:
                raise HTTPException(
                    status_code=status.HTTP_404_NOT_FOUND,
                    detail="Data source not found"
                )
            
            # Verify user has access to the project
            user_projects, _ = await ProjectService.get_user_projects(user_id)
            project_ids = [str(p.id) for p in user_projects]
            
            if str(data_source_db.project_id) not in project_ids:
                raise HTTPException(
                    status_code=status.HTTP_403_FORBIDDEN,
                    detail="Not authorized to access this data source"
                )
        
        logger.info(f"📊 Getting data for data source: {data_source_id} (user: {user_id})")
        
        # Get data source information from the service (now that we've verified ownership)
        data_source_info = await data_service.get_data_source(data_source_id)
        if not data_source_info['success']:
            raise HTTPException(status_code=404, detail="Data source not found")
        
        data_source = data_source_info['data_source']
        
        # For file-based sources, check if file exists and load data
        if data_source['type'] == 'file':
            # If a transient in-memory sample was provided at creation, return it
            if data_source.get('data'):
                return {
                    "success": True,
                    "data_source_id": data_source_id,
                    "data": data_source.get('data', []),
                    "metadata": {
                        "filename": data_source['name'],
                        "columns": _schema_columns(data_source.get('schema')),
                        "row_count": len(data_source.get('data', [])),
                        "file_path": data_source.get('file_path'),
                        "format": data_source.get('format')
                    }
                }
            
            # Try to load from edition-specific datasource storage.
            object_key = data_source.get('file_path')  # Now it's object_key
            if object_key:
                try:
                    storage_service = UploadDatasourceStorageService()
                    
                    project_id_for_storage = (
                        data_source.get('project_id')
                        or (str(data_source_db.project_id) if data_source_db and data_source_db.project_id else None)
                    )
                    if not project_id_for_storage:
                        raise ValueError("project_id missing for datasource file retrieval")

                    file_content = await storage_service.get_file(object_key, project_id_for_storage)
                    
                    # Process based on format
                    import tempfile
                    file_format = data_source.get('format', 'csv')
                    schema_obj = data_source.get('schema') if isinstance(data_source.get('schema'), dict) else {}
                    storage_format = ((schema_obj.get('storage') or {}).get('format') if isinstance(schema_obj, dict) else None)
                    blob_file_format = (storage_format or file_format or 'csv').lower()
                    with tempfile.NamedTemporaryFile(delete=False, suffix=f".{blob_file_format}") as tmp:
                        tmp.write(file_content)
                        tmp_path = tmp.name
                    
                    try:
                        if blob_file_format == 'csv':
                            import pandas as pd
                            df = pd.read_csv(tmp_path)
                            data = df.to_dict('records')
                        elif blob_file_format in ['xlsx', 'xls']:
                            import pandas as pd
                            df = pd.read_excel(tmp_path)
                            data = df.to_dict('records')
                        elif blob_file_format == 'json':
                            import json
                            with open(tmp_path, 'r') as f:
                                data = json.load(f)
                        elif blob_file_format == 'parquet':
                            import pandas as pd
                            df = pd.read_parquet(tmp_path)
                            data = df.to_dict('records')
                        else:
                            raise HTTPException(status_code=400, detail=f"Unsupported format: {blob_file_format}")
                        
                        return {
                            "success": True,
                            "data_source_id": data_source_id,
                            "data": data,
                            "metadata": {
                                "filename": data_source['name'],
                                "columns": _schema_columns(data_source.get('schema')),
                                "row_count": len(data),
                                "file_path": object_key,
                                "format": file_format
                            }
                        }
                    finally:
                        if os.path.exists(tmp_path):
                            os.unlink(tmp_path)
                except Exception as e:
                    logger.error(f"Failed to load from datasource storage: {e}")
                    # Fall through to sample_data fallback
            
            # Fallback to sample_data
            sample_data = data_source.get('sample_data', [])
            if sample_data:
                return {
                    "success": True,
                    "data_source_id": data_source_id,
                    "data": sample_data,
                    "metadata": {
                        "filename": data_source['name'],
                        "columns": _schema_columns(data_source.get('schema')),
                        "row_count": len(sample_data),
                        "file_path": object_key,
                        "format": data_source.get('format')
                    }
                }
            
            raise HTTPException(status_code=400, detail="No data available for this data source")
        
        # For Google Sheets: fetch CSV export and return rows for data panel preview
        if data_source["type"] == "google_sheets":
            result = await data_service.get_google_sheets_data(data_source, limit=5000)
            if not result.get("success"):
                raise HTTPException(
                    status_code=400,
                    detail=result.get("error", "Failed to load Google Sheet data"),
                )
            data = result.get("data", [])
            schema = data_source.get("schema") or {}
            return {
                "success": True,
                "data_source_id": data_source_id,
                "data": data,
                "metadata": {
                    "filename": data_source.get("name", "Google Sheet"),
                    "columns": _schema_columns(schema),
                    "row_count": result.get("row_count", len(data)),
                    "format": "csv",
                    "type": "google_sheets",
                },
            }
        
        # For database sources, return connection info
        elif data_source['type'] == 'database':
            return {
                "success": True,
                "data_source_id": data_source_id,
                "data": data_source.get('sample_data', []),  # return sample when present
                "metadata": {
                    "type": "database",
                    "db_type": data_source.get('db_type'),
                    "connection_info": data_source.get('connection_info', {})
                }
            }
        # Allow demo_* ids to return embedded sample data
        elif data_source_id.startswith('demo_'):
            demo = await data_service.get_data_source_by_id(data_source_id)
            if demo:
                return {
                    "success": True,
                    "data_source_id": data_source_id,
                    "data": demo.get('sample_data', []),
                    "metadata": {
                        "type": demo.get('type', 'file'),
                        "columns": _schema_columns(demo.get('schema')),
                        "row_count": len(demo.get('sample_data', []))
                    }
                }
            raise HTTPException(status_code=404, detail="Demo data not available")
        
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported data source type: {data_source['type']}")
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to get data source data: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Cube.js Data Modeling endpoints
@router.post("/cube-modeling/analyze")
async def analyze_data_source_for_cube(request: Dict[str, Any]):
    """Analyze data source and generate Cube.js schema with YAML"""
    try:
        start_ts = time.time()
        data_source_id = request.get('data_source_id')
        # Use print to ensure visible in container logs regardless of logger level
        print(f"ENTRY /cube-modeling/analyze ts={start_ts} request={data_source_id}")
        logger.info(f"/cube-modeling/analyze entry: ts={start_ts}")
        connection_info = request.get('connection_info')
        
        if not data_source_id:
            raise HTTPException(status_code=400, detail="data_source_id is required")
        
        # Allow caller to pass inline sample data to analyze directly
        sample_data = request.get('sample_data') if isinstance(request, dict) else None
        if sample_data:
            data = sample_data
        else:
            # Get data from uploaded source or database. Prefer in-memory sample if present.
            data = []
            if not connection_info:
                # First try to read any in-memory sample stored in the data service registry
                try:
                    ds_info = await data_service.get_data_source(data_source_id)
                    if ds_info.get('success'):
                        ds = ds_info.get('data_source', {})
                        if ds and ds.get('data'):
                            data = ds.get('data', [])
                except Exception:
                    logger.debug(f"No in-memory sample data for {data_source_id}")

                # If still empty, try to load from persisted file on disk
                if not data:
                    try:
                        data_response = await get_data_source_data(data_source_id)
                        if data_response.get('success'):
                            data = data_response.get('data', [])
                    except Exception:
                        logger.warning(f"Could not load data for {data_source_id}")
            else:
                # For database connections, we would query the database; for now, return a small sample
                data = [
                    {"id": 1, "name": "Product A", "sales": 1000, "created_at": "2024-01-01"},
                    {"id": 2, "name": "Product B", "sales": 1500, "created_at": "2024-01-02"}
                ]
        
        print(f"PRE-ANALYZE /cube-modeling/analyze data_rows={len(data) if data else 0} connection_info={bool(connection_info)}")
        logger.info(f"/cube-modeling/analyze: data_source_id={data_source_id} collected {len(data) if data else 0} rows; connection_info_present={bool(connection_info)}")

        # Analyze with Cube.js modeling service (optional)
        if not cube_modeling_service:
            raise HTTPException(status_code=503, detail="Cube.js modeling service is not available")
        mid_ts = time.time()
        logger.info(f"/cube-modeling/analyze calling analyzer: ts={mid_ts}")
        result = await cube_modeling_service.analyze_data_source(
            data_source_id=data_source_id,
            data=data,
            connection_info=connection_info
        )
        end_ts = time.time()
        print(f"EXIT /cube-modeling/analyze ts={end_ts} duration={end_ts-start_ts:.3f} analyzer_duration={end_ts-mid_ts:.3f} success={bool(result and result.get('success'))}")
        logger.info(f"/cube-modeling/analyze exit: ts={end_ts} duration={end_ts-start_ts:.3f}s analyzer_duration={end_ts-mid_ts:.3f}s result_success={bool(result and result.get('success'))}")
        
        return result
        
    except Exception as e:
        import traceback
        traceback.print_exc()
        logger.exception(f"❌ Cube modeling analysis failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/cube-modeling/deploy")
async def deploy_cube_schema(request: Dict[str, Any]):
    """Deploy generated Cube.js schema to server"""
    try:
        data_source_id = request.get('data_source_id')
        yaml_schema = request.get('yaml_schema')
        
        if not data_source_id or not yaml_schema:
            raise HTTPException(status_code=400, detail="data_source_id and yaml_schema are required")
        if not cube_modeling_service:
            raise HTTPException(status_code=503, detail="Cube.js modeling service is not available")
        result = await cube_modeling_service.deploy_schema_to_cube(
            data_source_id=data_source_id,
            yaml_schema=yaml_schema
        )
        
        return result
        
    except Exception as e:
        logger.error(f"❌ Cube schema deployment failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Warehouse connection endpoint - PRIMARY endpoint
@router.post("/cube-modeling/connect-warehouse")
async def connect_enterprise_warehouse_legacy(request: Dict[str, Any], current_token: Union[str, dict] = Depends(JWTCookieBearer())):
    """Connect to enterprise data warehouse (Snowflake, BigQuery, Redshift, ClickHouse, etc.)
    
    This endpoint is an alias for backward compatibility. Use /warehouses/connect instead.
    """
    try:
        # Extract user ID from JWT token
        try:
            if isinstance(current_token, dict):
                user_payload = current_token
            else:
                user_payload = extract_user_payload(current_token)
            
            user_id = str(user_payload.get('id') or user_payload.get('user_id') or user_payload.get('sub') or '')
            logger.info(f"🔍 Extracted user_id: {user_id} from payload keys: {list(user_payload.keys()) if isinstance(user_payload, dict) else 'not dict'}")
        except Exception as e:
            logger.error(f"❌ Failed to extract user_id from token: {str(e)}")
            import traceback
            logger.error(f"Full traceback: {traceback.format_exc()}")
            user_id = ''

        if not user_id:
            logger.warning('connect_warehouse attempted without authenticated user')
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail='Authentication required')

        wh_org_id = str(user_payload.get('organization_id') or user_payload.get('org_id') or f"user-{user_id}")
        await enforce_data_source_limit(user_id, wh_org_id)

        # SECURITY: Never log request body or connection_config (may contain credentials).
        connection_config = request.get('connection_config', request)
        _has_conn = isinstance(request, dict) and 'connection_config' in request
        logger.info("Warehouse connect request received (connection_config present=%s)", _has_conn)
        
        # Parse URI/connection_string so database (and host/port/user) are always in config (root fix for "default" in SQL)
        # Frontend sends connection_config: { type, uri, name } for warehouses - we must parse so stored config has database
        uri_raw = connection_config.get('uri') or connection_config.get('connection_string') if isinstance(connection_config, dict) else None
        if uri_raw and isinstance(uri_raw, str) and uri_raw.strip():
            try:
                parsed = data_service._parse_database_uri(uri_raw.strip())
                if parsed:
                    # Merge parsed fields into connection_config so database/host/port are stored and used everywhere
                    connection_config = dict(connection_config) if isinstance(connection_config, dict) else {}
                    for key in ('host', 'port', 'database', 'username', 'password', 'type', 'ssl_mode'):
                        if key in parsed and parsed[key] not in (None, ''):
                            connection_config[key] = parsed[key]
                    if connection_config.get('database'):
                        logger.info("Parsed database from URI for warehouse connect (value redacted)")
            except Exception as parse_err:
                logger.warning("Could not parse warehouse URI (non-fatal): %s", parse_err)
        elif connection_config == request:
            if 'uri' in request:
                parsed = data_service._parse_database_uri(request['uri'])
                connection_config = parsed
                if 'name' in request:
                    connection_config['name'] = request['name']
            elif 'connection_string' in request:
                parsed = data_service._parse_database_uri(request['connection_string'])
                connection_config = parsed
                if 'name' in request:
                    connection_config['name'] = request['name']
        
        if not connection_config:
            raise HTTPException(status_code=400, detail="connection_config or connection details are required")
        
        if not isinstance(connection_config, dict):
            raise HTTPException(status_code=400, detail="connection_config must be a dictionary")
        
        # Normalize database type - handle ClickHouse and other variations
        db_type = connection_config.get('type', '').lower().strip()
        # Map aliases and variations
        type_mapping = {
            'postgres': 'postgresql',
            'mssql': 'sqlserver',
            'ms sql': 'sqlserver',
            'ms sql server': 'sqlserver',
            'clickhouse+native': 'clickhouse',
            'clickhouse+http': 'clickhouse'
        }
        db_type = type_mapping.get(db_type, db_type)
        connection_config['type'] = db_type
        
        # Test connection first
        test_result = await data_service.test_database_connection(connection_config)
        if not test_result.get('success'):
            raise HTTPException(status_code=400, detail=f"Connection test failed: {test_result.get('error', 'Unknown error')}")
        
        # Store the connection via service with user ownership
        # NOTE: Pass plain credentials - store_database_connection will validate and encrypt them
        project_id = request.get('project_id') if isinstance(request, dict) else None
        connection_result = await data_service.store_database_connection(
            connection_config, user_id=user_id, project_id=project_id
        )
        if not connection_result or not connection_result.get('success'):
            err = (connection_result or {}).get('error') if isinstance(connection_result, dict) else 'Unknown error'
            raise HTTPException(status_code=500, detail=f"Failed to store connection: {err}")
        
        data_source_id = connection_result.get('data_source_id')
        if not data_source_id:
            raise HTTPException(status_code=500, detail="Missing data_source_id in connection result")

        # Trigger schema fetch + schema index build in background (Schema RAG) so index is ready without user refresh
        import asyncio
        async def _build_schema_index_after_connect():
            try:
                schema_result = await data_service.get_database_schema(data_source_id)
                if schema_result.get("success") and schema_result.get("schema", {}).get("tables"):
                    logger.info("Schema index built after connect: data_source_id=%s", data_source_id)
            except Exception as bg_err:
                logger.debug("Background schema index build after connect skipped: %s", bg_err)
        asyncio.create_task(_build_schema_index_after_connect())

        # Also try Cube.js modeling (optional, don't fail if this fails)
        cube_result = None
        if cube_modeling_service:
            try:
                cube_result = await cube_modeling_service.connect_enterprise_warehouse(connection_config)
            except Exception as cube_error:
                logger.warning(f"⚠️ Cube.js modeling integration failed (non-critical): {str(cube_error)}")
        
        return {
            "success": True,
            "message": "Warehouse connected successfully",
            "data_source_id": data_source_id,
            "data_source": {
                "id": data_source_id,
                "name": connection_config.get('name') or f"{connection_config.get('type')}_warehouse",
                "type": "database",
                "db_type": connection_config.get('type'),
                "status": "connected",
                "connection_info": connection_result.get('connection_info', {})
            },
            "connection_info": connection_result.get('connection_info'),
            "cube_modeling": cube_result if cube_result else None
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Enterprise warehouse connection failed: {str(e)}")
        import traceback
        error_trace = traceback.format_exc()
        logger.error(f"Full traceback: {error_trace}")
        raise HTTPException(status_code=500, detail=f"Warehouse connection failed: {str(e)}")


@router.post("/warehouse/test")
async def test_warehouse_connection(request: Dict[str, Any]):
    """Test warehouse connection without storing credentials"""
    try:
        # Handle both formats: {connection_config: {...}} or direct {...}
        connection_config = request.get('connection_config', request)
        
        # If connection_config is the same as request, try to parse URI if present
        if connection_config == request:
            # If connection_config is the same as request, try to parse URI if present
            if 'uri' in request:
                # Parse connection string
                parsed = data_service._parse_database_uri(request['uri'])
                connection_config = parsed
            elif 'connection_string' in request:
                parsed = data_service._parse_database_uri(request['connection_string'])
                connection_config = parsed
        
        # Validate connection_config has required fields
        if not connection_config or (isinstance(connection_config, dict) and len(connection_config) == 0):
            raise HTTPException(status_code=400, detail="connection_config or connection details are required")
        
        # Ensure we have at least type and connection info
        if 'type' not in connection_config and not any(k in connection_config for k in ['uri', 'connection_string', 'host']):
            raise HTTPException(status_code=400, detail="Connection config must include type or connection details")
        
        # Test the connection using the data connectivity service
        result = await data_service.test_database_connection(connection_config)
        
        # Return same format as /database/test endpoint for consistency
        if result['success']:
            return DatabaseTestResponse(
                success=True,
                message="Warehouse connection successful",
                connection_info=result.get('connection_info')
            )
        else:
            return DatabaseTestResponse(
                success=False,
                message="Warehouse connection failed",
                error=result.get('error', 'Unknown error')
            )
        
    except HTTPException:
        # Re-raise HTTP exceptions
        raise
    except ValueError as e:
        logger.error(f"❌ Warehouse connection validation failed: {str(e)}", exc_info=True)
        raise HTTPException(status_code=400, detail=f"Invalid connection configuration: {str(e)}")
    except Exception as e:
        import traceback
        error_trace = traceback.format_exc()
        logger.error(f"❌ Warehouse connection test failed: {str(e)}", exc_info=True)
        logger.error(f"Full traceback: {error_trace}")


# Warehouse connection endpoint - PRIMARY endpoint (must be before parameterized routes)
@router.post("/warehouses/connect")
async def connect_warehouse(request: Dict[str, Any], current_token: Union[str, dict] = Depends(JWTCookieBearer())):
    """Connect to enterprise data warehouse (Snowflake, BigQuery, Redshift, ClickHouse, etc.)
    
    This is the PRIMARY endpoint. /cube-modeling/connect-warehouse is an alias for backward compatibility.
    """
    logger.info("🎯 /warehouses/connect CALLED - delegating to connect_enterprise_warehouse_legacy")
    logger.info(f"  - Request keys: {list(request.keys())}")
    logger.info(f"  - Request body: {json.dumps(request, default=str, indent=2)}")
    # Delegate to the implementation
    return await connect_enterprise_warehouse_legacy(request, current_token)


@router.get("/cube-modeling/types")
async def get_modeling_types():
    """Get available data modeling types"""
    try:
        return {
            "success": True,
            "modeling_types": [
                {
                    "type": "star_schema",
                    "name": "Star Schema",
                    "description": "Central fact table with dimension tables - ideal for OLAP",
                    "use_cases": ["Business Intelligence", "Data Warehousing", "Analytics"],
                    "complexity": "medium",
                    "performance": "high"
                },
                {
                    "type": "snowflake_schema", 
                    "name": "Snowflake Schema",
                    "description": "Normalized dimension tables - reduces data redundancy",
                    "use_cases": ["Large Data Warehouses", "Complex Hierarchies"],
                    "complexity": "high",
                    "performance": "medium"
                },
                {
                    "type": "flat_table",
                    "name": "Flat Table",
                    "description": "Single denormalized table - simple but may have redundancy",
                    "use_cases": ["Small Datasets", "Simple Analytics", "Prototyping"],
                    "complexity": "low", 
                    "performance": "medium"
                },
                {
                    "type": "time_series",
                    "name": "Time Series",
                    "description": "Optimized for time-based analysis and trending",
                    "use_cases": ["IoT Data", "Metrics Tracking", "Financial Analysis"],
                    "complexity": "medium",
                    "performance": "high"
                },
                {
                    "type": "event_stream",
                    "name": "Event Stream",
                    "description": "Real-time event processing and aggregation",
                    "use_cases": ["Real-time Analytics", "User Behavior", "Monitoring"],
                    "complexity": "high",
                    "performance": "very_high"
                }
            ]
        }
        
    except Exception as e:
        logger.error(f"❌ Get modeling types failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

# Removed duplicate cube-status endpoint - using /cube/status for consistency

@router.post("/cube-deploy")
async def deploy_cube_schema(request: dict):
    """Deploy Cube.js schema to real server"""
    try:
        data_source = request.get('data_source')
        schema = request.get('schema')
        
        if not data_source or not schema:
            raise HTTPException(status_code=400, detail="Missing data_source or schema")
        
        # Cube.js is no longer supported
        raise HTTPException(
            status_code=501,
            detail="Cube.js deployment has been removed. Schema deployment is no longer available."
        )
        
        if False:
            return {
                "success": True,
                "deployment": deployment_result,
                "message": "Cube.js schema deployed successfully"
            }
        else:
            raise HTTPException(
                status_code=400, 
                detail=f"Deployment failed: {deployment_result.get('error', 'Unknown error')}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Cube.js deployment failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/dash-studio/query-editor/generate-chart")
async def generate_chart_from_cube(request: Dict[str, Any]):
    """Run a Cube.js query and return a simple ECharts option for preview.

    Expected payload: { "query": {...}, "chart_type": "bar" }
    """
    try:
        query = request.get("query") if isinstance(request, dict) else None
        chart_type = request.get("chart_type", "bar") if isinstance(request, dict) else "bar"
        if not query:
            raise HTTPException(status_code=400, detail="query is required")

        # Cube.js is no longer supported (not deployed)
        # This endpoint is deprecated
        raise HTTPException(
            status_code=501,
            detail="Cube.js integration has been removed. Please use direct database queries instead."
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to generate chart from Cube: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/dash-studio/query-editor/preview-from-rows")
async def preview_chart_from_rows(request: Dict[str, Any]):
    """Convert tabular rows (from any engine) to an ECharts option server-side.

    Payload: { rows: [...], chart_type: 'bar' }
    """
    try:
        rows = request.get('rows') if isinstance(request, dict) else None
        chart_type = request.get('chart_type', 'bar') if isinstance(request, dict) else 'bar'
        if not rows or not isinstance(rows, list):
            raise HTTPException(status_code=400, detail='rows (array) is required')

        # Cube.js is no longer supported (not deployed)
        # This endpoint needs to be reimplemented with a different charting library
        raise HTTPException(
            status_code=501,
            detail="Cube.js chart conversion has been removed. Please use client-side charting instead."
        )

    except HTTPException:
        raise
    except Exception as e:
        logger.exception(f"Failed to convert rows to chart: {e}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/cube-cubes")
async def get_deployed_cubes():
    """Get list of deployed cubes from real Cube.js server"""
    try:
        # Cube.js is no longer supported
        raise HTTPException(
            status_code=501,
            detail="Cube.js has been removed. No cubes are available."
        )
        
        if cubes_result['success']:
            return {
                "success": True,
                "cubes": cubes_result['cubes'],
                "total_cubes": cubes_result['total_cubes']
            }
        else:
            raise HTTPException(
                status_code=400, 
                detail=f"Failed to get cubes: {cubes_result.get('error', 'Unknown error')}"
            )
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to get deployed cubes: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/{data_source_id}/insights")
async def generate_data_insights(data_source_id: str):
    """Generate AI-powered insights for a data source"""
    try:
        logger.info(f"🔍 Generating AI insights for data source: {data_source_id}")
        
        # Get the data source
        data_source = await data_service.get_data_source(data_source_id)
        if not data_source:
            raise HTTPException(status_code=404, detail="Data source not found")
        
        # Generate insights using AI
        insights = await data_service.generate_data_insights(data_source_id)
        
        return {
            "success": True,
            "insights": insights,
            "data_source_id": data_source_id
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to generate insights: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sources/{data_source_id}/snapshots")
async def create_data_source_snapshot(data_source_id: str, request: Dict[str, Any]):
    """Alias endpoint to create a snapshot for a data source that delegates to /api/queries/snapshots."""
    try:
        # Build payload expected by queries API
        payload = {
            'data_source_id': data_source_id,
            'sql': request.get('sql'),
            'name': request.get('name'),
            'preview_rows': request.get('preview_rows', DEFAULT_PREVIEW_ROWS_REQUEST)
        }

        # Call into queries module by importing its function
        from src.modules.queries import api as queries_api
        # Use the same dependencies as queries endpoint (JWTCookieBearer/get_async_session handled there)
        # Directly delegate to create_snapshot handler
        return await queries_api.create_snapshot(payload, organization_id=request.get('organization_id'), project_id=request.get('project_id'))
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to create snapshot alias: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))

@router.get("/sources/{data_source_id}/schema")
async def get_data_source_schema(
    data_source_id: str,
    refresh: bool = False,
    current_token: Union[str, dict] = Depends(JWTCookieBearer())
):
    """Get schema information for a specific data source. Requires authentication and ownership (creator or project member)."""
    try:
        logger.info("Fetching schema for data source: %s", data_source_id)
        user_id = None
        if isinstance(current_token, dict):
            user_id = str(current_token.get("id") or current_token.get("user_id") or current_token.get("sub") or "")
        if not user_id:
            raise HTTPException(status_code=status.HTTP_403_FORBIDDEN, detail="Authentication required")

        from src.modules.data.models import DataSource
        from src.db.session import async_session
        from sqlalchemy import select

        async with async_session() as db:
            row = (await db.execute(
                select(DataSource).where(
                    DataSource.id == data_source_id,
                    DataSource.is_active == True,
                )
            )).scalar_one_or_none()
            if not row:
                raise HTTPException(status_code=404, detail="Data source not found")
            creator_ok = (
                getattr(row, "user_id", None) is not None
                and str(row.user_id) == user_id
            )
            if not creator_ok:
                if not is_ee_enabled():
                    if not _ce_can_read_data_source(row, user_id):
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="Not authorized to access this data source",
                        )
                else:
                    user_projects, _ = await ProjectService.get_user_projects(user_id)
                    project_ids = [str(p.id) for p in user_projects]
                    if not (row.project_id is not None and str(row.project_id) in project_ids):
                        raise HTTPException(
                            status_code=status.HTTP_403_FORBIDDEN,
                            detail="Not authorized to access this data source",
                        )
            data_source = row

            # If it's a database or warehouse, get live schema (uses stored connection_config for this data source)
            if data_source.type == 'database' or data_source.type == 'warehouse':
                schema_result = await data_service.get_database_schema(data_source_id, force_refresh=refresh)
                if schema_result.get('success'):
                    return {
                        "success": True,
                        "schema": schema_result['schema'],
                        "data_source": schema_result.get('data_source'),
                    }
                # Live fetch failed — return stored schema if it has tables so the UI
                # stays usable even when the connection is temporarily broken.
                stored = schema_result.get('schema') or {}
                if stored.get('tables'):
                    return {
                        "success": True,
                        "schema": stored,
                        "data_source": schema_result.get('data_source'),
                    }
                err = schema_result.get('error') or 'Failed to fetch schema'
                err_lower = err.lower()
                if any(x in err_lower for x in ('re-save', 'credentials', 'login failed', 'password is incorrect', 'authentication failed', 'database login failed')):
                    raise HTTPException(status_code=400, detail=err)
                raise HTTPException(status_code=500, detail=err)
            if data_source.type == 'api':
                schema_result = await data_service.get_database_schema(data_source_id)
                if schema_result.get('success') and schema_result.get('schema'):
                    schema = schema_result['schema']
                    try:
                        from sqlalchemy import update
                        await db.execute(
                            update(DataSource).where(DataSource.id == data_source_id).values(
                                schema=json.dumps(schema) if isinstance(schema, dict) else schema,
                                updated_at=datetime.now(),
                            )
                        )
                        await db.commit()
                    except Exception as persist_err:
                        logger.debug("Optional API schema persist skipped: %s", persist_err)
                    return {
                        "success": True,
                        "schema": schema,
                        "data_source": schema_result.get('data_source'),
                    }
                err = schema_result.get('error') or 'Failed to fetch API schema'
                err_lower = err.lower()
                if any(x in err_lower for x in ('url', 'connection', 'required', 'returned', 'authentication')):
                    raise HTTPException(status_code=400, detail=err)
                raise HTTPException(status_code=500, detail=err)
            if data_source.type == 'sample_duckdb':
                schema_result = await data_service.get_sample_duckdb_schema(data_source)
                if schema_result.get('success'):
                    return {
                        "success": True,
                        "schema": schema_result['schema'],
                        "data_source": schema_result.get('data_source') or {
                            "id": data_source.id,
                            "name": data_source.name,
                            "type": data_source.type,
                            "row_count": sum(t.get("rowCount", 0) for t in (schema_result.get('schema') or {}).get('tables') or []),
                        },
                    }
                # When DuckDB file is not yet generated, return empty schema instead of 500
                err = schema_result.get('error') or ''
                if 'not found' in err.lower() or 'run sample data generators' in err.lower():
                    return {
                        "success": True,
                        "schema": schema_result.get('schema') or {"tables": [], "schemas": []},
                        "data_source": {"id": data_source.id, "name": data_source.name, "type": "sample_duckdb", "row_count": 0},
                    }
                raise HTTPException(
                    status_code=500,
                    detail=err or 'Failed to load sample data schema',
                )
            if data_source.type == 'google_sheets':
                conn_cfg = data_source.connection_config
                if conn_cfg:
                    if isinstance(conn_cfg, str):
                        try:
                            conn_cfg = json.loads(conn_cfg)
                        except json.JSONDecodeError:
                            conn_cfg = {}
                    try:
                        from src.modules.data.utils.credentials import decrypt_credentials
                        conn_cfg = decrypt_credentials(conn_cfg)
                    except Exception:
                        pass
                if not isinstance(conn_cfg, dict):
                    conn_cfg = {}
                source_dict = {
                    "id": data_source.id,
                    "name": data_source.name,
                    "type": data_source.type,
                    "connection_config": conn_cfg,
                    "row_count": getattr(data_source, "row_count", None),
                }
                schema_result = await data_service.get_google_sheets_schema(source_dict)
                if schema_result.get('success'):
                    return {
                        "success": True,
                        "schema": schema_result['schema'],
                        "data_source": schema_result.get('data_source') or {
                            "id": data_source.id,
                            "name": data_source.name,
                            "type": "google_sheets",
                            "row_count": schema_result.get('data_source', {}).get('row_count', 0),
                        },
                    }
                err = schema_result.get('error') or 'Failed to load Google Sheet schema'
                raise HTTPException(status_code=400, detail=err)
            # For file types, extract schema from sample_data if available
            if data_source.type == 'file':
                schema = {}
                try:
                    # Try to get schema from stored schema field first
                    if isinstance(data_source.schema, dict):
                        schema = data_source.schema
                    elif isinstance(data_source.schema, str):
                        schema = json.loads(data_source.schema)

                    # Rename legacy "data" table to the actual data source name
                    if isinstance(schema, dict) and isinstance(schema.get("tables"), list):
                        for tbl in schema["tables"]:
                            if isinstance(tbl, dict) and tbl.get("name") == "data":
                                tbl["name"] = data_source.name

                    # Legacy Excel uploads: all_sheets present but no tables key — rebuild tables
                    if isinstance(schema, dict) and not schema.get("tables") and schema.get("all_sheets"):
                        rebuilt = []
                        for sheet_key, info in schema["all_sheets"].items():
                            sheet_cols = (info.get("schema") or {}).get("columns") or []
                            rebuilt.append({
                                "name": sheet_key,
                                "columns": sheet_cols,
                                "row_count": info.get("row_count", 0),
                            })
                        if rebuilt:
                            schema["tables"] = rebuilt

                    # If no schema, try to extract from sample_data
                    if not schema or not schema.get('tables'):
                        sample_data = data_source.sample_data
                        if sample_data:
                            if isinstance(sample_data, str):
                                sample_data = json.loads(sample_data)
                            
                            # CRITICAL: Serialize date/datetime objects to strings before processing
                            def serialize_dates(obj):
                                """Recursively serialize date/datetime objects to ISO format strings"""
                                from datetime import datetime, date
                                if isinstance(obj, (datetime, date)):
                                    return obj.isoformat()
                                elif isinstance(obj, dict):
                                    return {k: serialize_dates(v) for k, v in obj.items()}
                                elif isinstance(obj, list):
                                    return [serialize_dates(item) for item in obj]
                                return obj
                            
                            # Serialize any date objects in sample_data
                            sample_data = serialize_dates(sample_data)
                            
                            if isinstance(sample_data, list) and len(sample_data) > 0:
                                # Extract columns from first row
                                first_row = sample_data[0]
                                if isinstance(first_row, dict):
                                    columns = []
                                    for col_name, col_value in first_row.items():
                                        # Infer type from value
                                        col_type = 'string'
                                        if isinstance(col_value, (int, float)):
                                            col_type = 'number'
                                        elif isinstance(col_value, bool):
                                            col_type = 'boolean'
                                        elif isinstance(col_value, str):
                                            # Try to detect date
                                            try:
                                                from datetime import datetime
                                                datetime.fromisoformat(col_value.replace('Z', '+00:00'))
                                                col_type = 'date'
                                            except:
                                                col_type = 'string'
                                        
                                        columns.append({
                                            "name": col_name,
                                            "type": col_type,
                                            "nullable": True
                                        })
                                    
                                    # Create schema structure (normalized shape: tables[{ name, columns, row_count? }])
                                    schema = {
                                        "tables": [{
                                            "name": data_source.name,
                                            "columns": columns,
                                            "row_count": len(sample_data)
                                        }],
                                        "connection_database": "default",
                                        "last_updated": datetime.now().isoformat()
                                    }
                                    logger.info(f"✅ Extracted schema from sample_data for file source: {len(columns)} columns")
                except Exception as e:
                    logger.warning(f"Failed to extract schema from file data source: {e}")
                    schema = {}
            else:
                # For other types, return stored schema
                try:
                    # Handle both string and dict schemas
                    if isinstance(data_source.schema, dict):
                        schema = data_source.schema
                    elif isinstance(data_source.schema, str):
                        schema = json.loads(data_source.schema)
                    else:
                        schema = {}
                except (json.JSONDecodeError, TypeError) as e:
                    logger.warning(f"Failed to parse schema: {e}")
                    schema = {}
            
            return {
                "success": True,
                "schema": schema,
                "data_source": {
                    "id": data_source.id,
                    "name": data_source.name,
                    "type": data_source.type,
                    "format": data_source.format,
                    "row_count": data_source.row_count
                }
            }
            
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to get data source schema: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Views and Materialized Views Endpoints
@router.get(
    "/sources/{data_source_id}/semantic-layer",
    dependencies=[Depends(require_plan_feature("platform_services"))],
)
async def get_semantic_layer_for_source(
    data_source_id: str,
    current_user: dict = Depends(current_user_payload),
):
    """
    Deprecated: use GET /api/semantic/context instead.
    Returns unified semantic context from the canonical Postgres model.
    """
    try:
        from src.db.session import async_session
        from src.modules.data.services.semantic_context_service import get_unified_semantic_context

        data_source = await data_service.get_data_source_by_id(data_source_id)
        if not data_source:
            raise HTTPException(status_code=404, detail="Data source not found")

        async with async_session() as db:
            context = await get_unified_semantic_context(db, data_source_id)

        return {
            "success": True,
            "deprecated": True,
            "redirect_to": f"/api/semantic/context?data_source_id={data_source_id}",
            "semantic_layer": {
                "metrics": context.get("metrics", []),
                "dimensions": context.get("dimensions", []),
                "join_paths": context.get("join_paths", []),
                "prompt_hint": context.get("prompt_hint", ""),
            },
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error("❌ Semantic layer generation failed for %s: %s", data_source_id, e)
        return {"success": False, "error": str(e), "semantic_layer": None}


@router.get("/sources/{data_source_id}/views")
async def list_views(data_source_id: str):
    """List database views and their columns for a data source (best-effort for SQL databases)."""
    try:
        data_source = await data_service.get_data_source_by_id(data_source_id)
        if not data_source:
            raise HTTPException(status_code=404, detail="Data source not found")

        # File sources (DuckDB) don't have information_schema.views
        if data_source.get('type') == 'file':
            return {"success": True, "views": []}

        views_query = (
            "SELECT table_schema, table_name FROM information_schema.views "
            "WHERE table_schema NOT IN ('pg_catalog','information_schema') ORDER BY 1,2"
        )
        result = await multi_engine_service.execute_query(
            query=views_query,
            data_source=data_source,
            engine=QueryEngine.DIRECT_SQL,
            optimization=False,
        )
        views = []
        for row in result.get("data", []):
            schema = row.get("table_schema") or row.get("schema") or "public"
            name = row.get("table_name") or row.get("name")
            columns_query = (
                "SELECT column_name, data_type, is_nullable FROM information_schema.columns "
                "WHERE table_schema = :schema AND table_name = :name ORDER BY ordinal_position"
            )
            try:
                cols_res = await multi_engine_service.execute_query(
                    query=columns_query.replace(":schema", f"'{schema}'").replace(":name", f"'{name}'"),
                    data_source=data_source,
                    engine=QueryEngine.DIRECT_SQL,
                    optimization=False,
                )
                columns = [
                    {
                        "name": c.get("column_name"),
                        "type": c.get("data_type"),
                        "nullable": (str(c.get("is_nullable")).lower() == "yes"),
                    }
                    for c in cols_res.get("data", [])
                ]
            except Exception:
                columns = []
            views.append({"schema": schema, "name": name, "columns": columns})

        return {"success": True, "views": views}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to list views: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/sources/{data_source_id}/materialized-views")
async def list_materialized_views(data_source_id: str):
    """List materialized views for Postgres (best-effort)."""
    try:
        data_source = await data_service.get_data_source_by_id(data_source_id)
        if not data_source:
            raise HTTPException(status_code=404, detail="Data source not found")

        query = "SELECT schemaname, matviewname FROM pg_matviews ORDER BY 1,2"
        result = await multi_engine_service.execute_query(
            query=query,
            data_source=data_source,
            engine=QueryEngine.DIRECT_SQL,
            optimization=False,
        )
        mvs = [
            {"schema": r.get("schemaname") or "public", "name": r.get("matviewname")}
            for r in result.get("data", [])
        ]
        return {"success": True, "materialized_views": mvs}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to list materialized views: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class CreateMaterializedViewRequest(BaseModel):
    name: str
    sql: str
    table_schema: Optional[str] = Field(None, alias="schema")


@router.post("/sources/{data_source_id}/materialized-views")
async def create_materialized_view(data_source_id: str, request: CreateMaterializedViewRequest):
    """Create a materialized view using provided SQL (Postgres)."""
    try:
        data_source = await data_service.get_data_source_by_id(data_source_id)
        if not data_source:
            raise HTTPException(status_code=404, detail="Data source not found")

        # simple validation for name to avoid injection
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", request.name):
            raise HTTPException(status_code=400, detail="Invalid view name")
        qualified = f"{request.schema}.{request.name}" if request.schema else request.name
        create_sql = f"CREATE MATERIALIZED VIEW {qualified} AS {request.sql}"
        await multi_engine_service.execute_query(
            query=create_sql,
            data_source=data_source,
            engine=QueryEngine.DIRECT_SQL,
            optimization=False,
        )
        return {"success": True, "message": "Materialized view created"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to create materialized view: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/sources/{data_source_id}/materialized-views/{schema}.{name}/refresh")
async def refresh_materialized_view(data_source_id: str, schema: str, name: str):
    try:
        data_source = await data_service.get_data_source_by_id(data_source_id)
        if not data_source:
            raise HTTPException(status_code=404, detail="Data source not found")
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", schema) or not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", name):
            raise HTTPException(status_code=400, detail="Invalid identifiers")
        refresh_sql = f"REFRESH MATERIALIZED VIEW CONCURRENTLY {schema}.{name}"
        await multi_engine_service.execute_query(
            query=refresh_sql,
            data_source=data_source,
            engine=QueryEngine.DIRECT_SQL,
            optimization=False,
        )
        return {"success": True, "message": "Materialized view refreshed"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to refresh materialized view: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.delete("/sources/{data_source_id}/materialized-views/{schema}.{name}")
async def drop_materialized_view(data_source_id: str, schema: str, name: str):
    try:
        data_source = await data_service.get_data_source_by_id(data_source_id)
        if not data_source:
            raise HTTPException(status_code=404, detail="Data source not found")
        if not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", schema) or not re.match(r"^[a-zA-Z_][a-zA-Z0-9_]*$", name):
            raise HTTPException(status_code=400, detail="Invalid identifiers")
        drop_sql = f"DROP MATERIALIZED VIEW IF EXISTS {schema}.{name}"
        await multi_engine_service.execute_query(
            query=drop_sql,
            data_source=data_source,
            engine=QueryEngine.DIRECT_SQL,
            optimization=False,
        )
        return {"success": True, "message": "Materialized view dropped"}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to drop materialized view: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


class AnalyzeQueryRequest(BaseModel):
    sql: str


@router.post("/sources/{data_source_id}/analyze")
async def analyze_query(
    data_source_id: str, 
    request: AnalyzeQueryRequest,
    current_token: dict = Depends(JWTCookieBearer())
):
    """Return EXPLAIN plan (if supported) and heuristic suggestions for optimization."""
    try:
        data_source = await data_service.get_data_source_by_id(data_source_id)
        if not data_source:
            raise HTTPException(status_code=404, detail="Data source not found")

        sql = request.sql.strip().rstrip(";")
        if not sql:
            raise HTTPException(status_code=400, detail="SQL query is required")
        
        plan = None
        plan_error = None
        
        # Try to get execution plan - support multiple database types
        try:
            source_type = data_source.get("type") or data_source.get("source_type", "").lower()
            db_type = data_source.get("db_type", "").lower()
            
            # PostgreSQL/ClickHouse style EXPLAIN
            if "postgres" in source_type or "postgres" in db_type:
                explain_sql = f"EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) {sql}"
            elif "clickhouse" in source_type or "clickhouse" in db_type:
                explain_sql = f"EXPLAIN PLAN {sql}"
            else:
                # Generic EXPLAIN
                explain_sql = f"EXPLAIN {sql}"
            
            plan_res = await multi_engine_service.execute_query(
                query=explain_sql,
                data_source=data_source,
                engine=QueryEngine.DIRECT_SQL,
                optimization=False,
            )
            
            # Many drivers return a single-row JSON plan under a key
            rows = plan_res.get("data", [])
            if rows:
                first = rows[0]
                # Try multiple possible field names
                plan_json_text = (
                    first.get("QUERY PLAN") or 
                    first.get("query_plan") or 
                    first.get("Plan") or
                    first.get("plan") or
                    (first.get(list(first.keys())[0]) if first else None) or
                    json.dumps(rows)
                )
                try:
                    if isinstance(plan_json_text, str):
                        plan = json.loads(plan_json_text)
                    else:
                        plan = plan_json_text
                except (json.JSONDecodeError, TypeError):
                    # If it's already a dict/list, use it directly
                    plan = rows if isinstance(rows, (dict, list)) else {"raw": rows}
        except Exception as e:
            logger.warning(f"EXPLAIN failed: {e}")
            plan_error = str(e)
            # Continue with suggestions even if EXPLAIN fails

        # Generate heuristic suggestions
        suggestions = []
        lowered = sql.lower()
        
        # Basic query patterns
        if "select *" in lowered:
            suggestions.append("Avoid SELECT *; select only required columns to reduce I/O and improve performance")
        if " order by " in lowered and " limit " not in lowered:
            suggestions.append("Add LIMIT when using ORDER BY for interactive queries to avoid sorting large result sets")
        if " join " in lowered and " on " in lowered and " where " not in lowered:
            suggestions.append("Add selective WHERE filters to reduce join input sizes and improve query performance")
        if " group by " in lowered and ("date_trunc(" in lowered or "::date" in lowered or "toDate(" in lowered):
            suggestions.append("Pre-aggregate by time buckets or create a materialized view for time-series queries")
        if " where " not in lowered and "select" in lowered:
            suggestions.append("Consider filtering to reduce scanned rows - full table scans can be slow on large datasets")
        
        # Index suggestions
        if " where " in lowered:
            where_clause = lowered[lowered.find(" where ") + 7:]
            # Check for common patterns that benefit from indexes
            if any(op in where_clause for op in ["=", ">", "<", ">=", "<=", " like ", " in "]):
                suggestions.append("Ensure columns in WHERE clause have indexes for optimal performance")
        
        # Aggregation suggestions
        if " group by " in lowered and " having " not in lowered:
            suggestions.append("Consider using HAVING clause for filtering aggregated results instead of subqueries")
        
        # Subquery suggestions
        if "(" in sql and "select" in lowered and lowered.count("select") > 1:
            suggestions.append("Consider using JOINs instead of subqueries for better performance in some databases")
        
        # Large result set warnings
        if " limit " not in lowered and "select" in lowered:
            suggestions.append("Add LIMIT clause to prevent returning unexpectedly large result sets")

        return {
            "success": True, 
            "plan": plan, 
            "suggestions": suggestions,
            "plan_error": plan_error if plan_error else None,
            "query_length": len(sql),
            "estimated_complexity": "high" if lowered.count("join") > 2 or lowered.count("select") > 1 else "medium" if "join" in lowered or "group by" in lowered else "low"
        }
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Failed to analyze query: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# 🚀 REAL ENTERPRISE CONNECTIVITY ENDPOINTS

@router.post("/enterprise/connections/test")
async def test_enterprise_connection(request: Dict[str, Any]):
    """Test enterprise data source connection"""
    try:
        logger.info(f"🔌 Testing enterprise connection: {request.get('type')}")
        
        # Create connection config
        config = ConnectionConfig(
            connector_type=ConnectorType(request['type']),
            name=request.get('name', f"{request['type']}_connection"),
            host=request.get('host'),
            port=request.get('port'),
            database=request.get('database'),
            username=request.get('username'),
            password=request.get('password'),
            token=request.get('token'),
            api_key=request.get('api_key'),
            connection_string=request.get('connection_string'),
            ssl_enabled=request.get('ssl_enabled', True),
            timeout=request.get('timeout', 30),
            metadata=request.get('metadata', {})
        )
        
        # Test connection
        result = await enterprise_connectors_service.test_connection(config)
        
        return result
        
    except Exception as e:
        logger.error(f"❌ Enterprise connection test failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/enterprise/connections")
async def create_enterprise_connection(request: Dict[str, Any]):
    """Create enterprise data source connection"""
    try:
        logger.info(f"🔌 Creating enterprise connection: {request.get('type')}")
        
        # Create connection config
        config = ConnectionConfig(
            connector_type=ConnectorType(request['type']),
            name=request.get('name', f"{request['type']}_connection"),
            host=request.get('host'),
            port=request.get('port'),
            database=request.get('database'),
            username=request.get('username'),
            password=request.get('password'),
            token=request.get('token'),
            api_key=request.get('api_key'),
            connection_string=request.get('connection_string'),
            ssl_enabled=request.get('ssl_enabled', True),
            timeout=request.get('timeout', 30),
            metadata=request.get('metadata', {})
        )
        
        # Create connection
        result = await enterprise_connectors_service.create_connection(config)
        
        return result
        
    except Exception as e:
        logger.error(f"❌ Enterprise connection creation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/enterprise/connections")
async def list_enterprise_connections():
    """List all enterprise connections"""
    try:
        connections = await enterprise_connectors_service.list_connections()
        return {
            "success": True,
            "connections": connections,
            "count": len(connections)
        }
    except Exception as e:
        logger.error(f"❌ Failed to list enterprise connections: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/enterprise/connections/{connection_id}/query")
async def execute_enterprise_query(connection_id: str, request: Dict[str, Any]):
    """Execute query on enterprise connection"""
    try:
        query = request.get('query', '')
        params = request.get('params')
        
        if not query:
            raise HTTPException(status_code=400, detail="Query is required")
        
        result = await enterprise_connectors_service.execute_query(connection_id, query, params)
        
        return {
            "success": result.success,
            "data": result.data,
            "columns": result.columns,
            "row_count": result.row_count,
            "execution_time": result.execution_time,
            "query_id": result.query_id,
            "error": result.error
        }
        
    except Exception as e:
        logger.error(f"❌ Enterprise query execution failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/enterprise/connections/{connection_id}/schema")
async def get_enterprise_schema(connection_id: str, table_name: Optional[str] = None):
    """Get schema from enterprise connection"""
    try:
        result = await enterprise_connectors_service.get_schema(connection_id, table_name)
        return result
    except Exception as e:
        logger.error(f"❌ Failed to get enterprise schema: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# 🎯 MULTI-ENGINE QUERY EXECUTION ENDPOINTS

@router.post("/query/execute")
async def execute_multi_engine_query(
    request: Dict[str, Any],
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Execute query using optimal engine"""
    try:
        logger.info(f"🔥 Received /query/execute request: {json.dumps(request, indent=2)}")
        query = request.get('query', '')
        data_source_id = request.get('data_source_id')
        filters = request.get('filters')  # Optional: [{field, op, value|values|from/to}]
        engine = request.get('engine')  # Optional: 'duckdb', 'cube', 'spark', 'direct_sql', 'pandas'
        optimization = request.get('optimization', True)

        user_payload = current_token if isinstance(current_token, dict) else extract_user_payload(current_token)
        user_id = str(
            (user_payload or {}).get("sub")
            or (user_payload or {}).get("user_id")
            or ""
        )
        if not user_id:
            raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail="Authentication required")
        org_id = await get_user_organization_id(user_id, db)
        spark_ok = await org_has_plan_feature(org_id, db, "spark_query_engine")

        if engine and str(engine).strip().lower() == "spark" and not spark_ok:
            plan_slug = (await get_organization_plan(org_id, db)) or "free"
            raise HTTPException(
                status_code=status.HTTP_402_PAYMENT_REQUIRED,
                detail={
                    "message": "Apache Spark query engine requires Pro or a higher plan.",
                    "feature": "spark_query_engine",
                    "upgrade_required": True,
                    "required_plan": "pro",
                    "current_plan": plan_slug,
                },
            )

        logger.info(f"🔍 Extracted from request: query={query[:200]}..., data_source_id={data_source_id}, engine={engine}")
        
        if not query or not data_source_id:
            raise HTTPException(status_code=400, detail="Query and data_source_id are required")
        
        # Get data source
        logger.info(f"🔍 Fetching data source: {data_source_id}")
        data_source = await data_service.get_data_source_by_id(data_source_id)
        # Enrich file-based data sources with persisted sample_data if available
        try:
            if data_source and data_source.get('type') == 'file' and not data_source.get('data') and not data_source.get('sample_data'):
                from src.db.session import get_sync_engine
                eng = get_sync_engine()
                import sqlalchemy as sa
                with eng.connect() as conn:
                    r = conn.execute(sa.text("SELECT sample_data FROM data_sources WHERE id = :id LIMIT 1"), {"id": data_source_id})
                    row = r.fetchone()
                    if row and row[0] is not None:
                        try:
                            data_source['sample_data'] = row[0]
                            data_source['data'] = row[0]
                        except Exception:
                            data_source['sample_data'] = row[0]
        except Exception:
            # Non-fatal: continue with whatever data_source we have
            logger.debug('Failed to enrich data_source with persisted sample_data')
        # Additional fallback: check in-memory preview registry for inline sample data
        try:
            if data_source and data_source.get('type') == 'file' and not data_source.get('data') and not data_source.get('sample_data'):
                mem = data_service.data_sources.get(data_source_id)
                if mem:
                    if mem.get('data'):
                        data_source['data'] = mem.get('data')
                        data_source['sample_data'] = mem.get('data')
                    elif mem.get('sample_data'):
                        data_source['sample_data'] = mem.get('sample_data')
                        data_source['data'] = mem.get('sample_data')
        except Exception:
            logger.debug('Failed to enrich data_source from in-memory registry')
        if not data_source:
            logger.error(f"❌ Data source not found: {data_source_id}")
            raise HTTPException(status_code=404, detail="Data source not found")
        
        # SECURITY: Log only non-sensitive identifiers; never log connection_info/connection_config or database name.
        logger.info(
            "Using data source: id=%s, name=%s, type=%s, db_type=%s, has_connection_info=%s",
            data_source.get('id'), data_source.get('name'), data_source.get('type'), data_source.get('db_type'),
            bool(data_source.get('connection_info')),
        )
        
        # Select engine if specified. Accept 'auto' to mean optimizer-controlled.
        # CRITICAL: Default to auto-selection if engine is invalid/unknown instead of raising error
        selected_engine = None
        if engine:
            if isinstance(engine, str) and engine.lower() in ('auto', 'unknown', ''):
                selected_engine = None  # Auto-select
            else:
                try:
                    selected_engine = QueryEngine(engine)
                except ValueError:
                    # Invalid engine - log warning but default to auto-selection instead of error
                    logger.warning(f"⚠️ Invalid engine '{engine}' specified, defaulting to auto-selection")
                    selected_engine = None  # Auto-select optimal engine
        
        # Apply filters server-side by safely wrapping the original SQL
        if filters and isinstance(filters, list):
            try:
                query = _apply_filters_to_query(query, filters)
            except Exception:
                pass

        # Execute query
        result = await multi_engine_service.execute_query(
            query=query,
            data_source=data_source,
            engine=selected_engine,
            optimization=optimization,
            allow_spark=spark_ok,
        )
        
        # Ensure result has proper structure with all required fields
        logger.info(f"📊 Query execution result: success={result.get('success')}, data_length={len(result.get('data', []))}, columns={result.get('columns', [])}, engine={result.get('engine')}")
        
        # Ensure data is always an array
        if result.get('success') and 'data' in result:
            result_data = result.get('data', [])
            if not isinstance(result_data, list):
                logger.warning(f"⚠️ Result data is not a list, converting: {type(result_data)}")
                result['data'] = [result_data] if result_data else []
            
            # Log first row for debugging
            if result['data'] and len(result['data']) > 0:
                logger.info(f"📊 First row sample: {json.dumps(result['data'][0], default=str)[:200]}")
            else:
                logger.warning("⚠️ Query executed successfully but returned no data rows")
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Multi-engine query execution failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


def _apply_filters_to_query(original_query: str, filters: list) -> str:
    """Safely wrap query with filters as WHERE clauses.
    SELECT * FROM (original_query) AS q WHERE ...
    """
    if not original_query or not isinstance(filters, list) or len(filters) == 0:
        return original_query

    def safe_field(name: str) -> str:
        import re
        return name if name and re.match(r"^[a-zA-Z0-9_\.]+$", name) else ""

    def sql_value(v):
        if v is None:
            return 'NULL'
        if isinstance(v, (int, float)):
            return str(v)
        if isinstance(v, bool):
            return 'TRUE' if v else 'FALSE'
        s = str(v).replace("'", "''")
        return f"'{s}'"

    clauses = []
    for f in filters:
        if not isinstance(f, dict):
            continue
        field = safe_field(str(f.get('field', '')))
        if not field:
            continue
        op = str(f.get('op', '=')).lower()
        if op == 'between' and f.get('from') is not None and f.get('to') is not None:
            clauses.append(f"{field} BETWEEN {sql_value(f.get('from'))} AND {sql_value(f.get('to'))}")
        elif op in ('in', 'not in') and isinstance(f.get('values'), list) and len(f['values']) > 0:
            vals = ', '.join(sql_value(v) for v in f['values'])
            clauses.append(f"{field} {op.upper()} ({vals})")
        elif op in ('=', '!=', '>', '<', '>=', '<=', 'like', 'ilike') and f.get('value') is not None:
            clauses.append(f"{field} {op.upper()} {sql_value(f.get('value'))}")

    if not clauses:
        return original_query
    where = ' AND '.join(clauses)
    return f"SELECT * FROM ({original_query}) AS q WHERE {where}"


@router.post("/query/parallel")
async def execute_parallel_queries(request: Dict[str, Any]):
    """Execute multiple queries in parallel"""
    try:
        queries = request.get('queries', [])
        data_source_id = request.get('data_source_id')
        
        if not queries or not data_source_id:
            raise HTTPException(status_code=400, detail="Queries and data_source_id are required")
        
        # Get data source
        data_source = await data_service.get_data_source_by_id(data_source_id)
        if not data_source:
            raise HTTPException(status_code=404, detail="Data source not found")
        
        # Execute parallel queries
        results = await multi_engine_service.execute_parallel_queries(queries, data_source)
        
        return {
            "success": True,
            "results": results,
            "total_queries": len(queries),
            "completed_queries": len([r for r in results if r.get('success')])
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Parallel query execution failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# CUBE.JS SERVER MANAGEMENT ENDPOINTS
# These endpoints manage Cube.js server-side via the Cube REST API.
# The removed real_cube_integration_service module (cube_modeling_service) is not present;
# all Cube operations go through the Cube HTTP API directly.

@router.post("/cube/initialize")
async def initialize_cube_server():
    """Check Cube.js server readiness"""
    return await get_cube_status()


@router.post("/cube/connections")
async def create_cube_database_connection(request: Dict[str, Any]):
    """Not implemented: Cube.js manages its own DB connections via environment config."""
    raise HTTPException(
        status_code=501,
        detail="Cube.js database connections are configured via Cube environment variables (CUBEJS_DB_*). Use /data/cube/status to verify connectivity."
    )


@router.post("/cube/connections/{connection_id}/query")
async def execute_cube_connection_query(connection_id: str, request: Dict[str, Any]):
    """Execute a Cube.js query (connection_id is ignored; Cube manages connections internally)"""
    try:
        query = request.get('query', '')
        if not query:
            raise HTTPException(status_code=400, detail="Query is required")

        cube_url = os.getenv("CUBE_API_URL", "")
        cube_secret = os.getenv("CUBE_API_SECRET", "")
        if not cube_url:
            raise HTTPException(status_code=503, detail="Cube.js not configured (CUBE_API_URL not set)")
        import httpx
        headers = {"Authorization": f"Bearer {cube_secret}"} if cube_secret else {}
        payload = {"query": query} if isinstance(query, dict) else {"query": query}
        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(f"{cube_url}/cubejs-api/v1/load", json=payload, headers=headers)
        if resp.status_code != 200:
            raise HTTPException(status_code=resp.status_code, detail=resp.text[:300])
        data = resp.json().get("data", [])
        return {"success": True, "data": data, "columns": list(data[0].keys()) if data else [], "row_count": len(data), "connection_id": connection_id}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Cube connection query failed: {e}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/cube/connections/{connection_id}/schema")
async def get_cube_database_schema(connection_id: str):
    """Get Cube.js meta as schema (connection_id is informational)"""
    return await get_cube_metadata()


@router.post("/cube/connections/{connection_id}/schema")
async def create_cube_schema(connection_id: str, request: Dict[str, Any]):
    """Not implemented: Cube.js schema is managed via cube_schemas/ YAML files."""
    raise HTTPException(
        status_code=501,
        detail="Cube.js schema management via API is not supported. Edit cube_schemas/ YAML files and restart Cube."
    )


# 📋 YAML SCHEMA MANAGEMENT ENDPOINTS

@router.post("/schema/generate")
async def generate_yaml_schema(request: Dict[str, Any]):
    """Generate YAML schema from data source"""
    try:
        data_source_id = request.get('data_source_id')
        data_source_type = request.get('data_source_type', 'database')
        user_preferences = request.get('user_preferences', {})
        
        if not data_source_id:
            raise HTTPException(status_code=400, detail="data_source_id is required")
        
        # Get raw schema from data source
        schema_result = await data_service.get_source_schema(data_source_id)
        if not schema_result.get('success'):
            raise HTTPException(status_code=400, detail=f"Failed to get schema: {schema_result.get('error')}")
        
        raw_schema = schema_result.get('schema', {})
        
        # Generate YAML schema
        result = await yaml_schema_service.generate_yaml_schema(
            data_source_id=data_source_id,
            data_source_type=data_source_type,
            raw_schema=raw_schema,
            user_preferences=user_preferences
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ YAML schema generation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/schema/validate")
async def validate_yaml_schema(request: Dict[str, Any]):
    """Validate YAML schema structure and content"""
    try:
        schema_content = request.get('schema_content')
        
        if not schema_content:
            raise HTTPException(status_code=400, detail="schema_content is required")
        
        result = await yaml_schema_service.validate_yaml_schema(schema_content)
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ YAML schema validation failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.get("/schema/{data_source_id}/verification")
async def get_schema_for_verification(data_source_id: str):
    """Get YAML schema for user verification"""
    try:
        result = await yaml_schema_service.get_schema_for_verification(data_source_id)
        return result
        
    except Exception as e:
        logger.error(f"❌ Failed to get schema for verification: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/schema/{data_source_id}/verify")
async def update_schema_from_verification(data_source_id: str, request: Dict[str, Any]):
    """Update schema based on user verification feedback"""
    try:
        user_feedback = request.get('user_feedback', {})
        
        result = await yaml_schema_service.update_schema_from_verification(
            data_source_id=data_source_id,
            user_feedback=user_feedback
        )
        
        return result
        
    except Exception as e:
        logger.error(f"❌ Schema verification update failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


# Delta Lake and Apache Iceberg Connection Endpoints
@router.post("/delta-iceberg/test")
async def test_delta_iceberg_connection(
    request: Dict[str, Any],
    current_token: Union[str, dict] = Depends(JWTCookieBearer())
):
    """Test connection to Delta Lake or Apache Iceberg table"""
    try:
        format_type = request.get('format_type')  # 'delta' or 'iceberg'
        storage_uri = request.get('storage_uri')
        credentials = request.get('credentials', {})
        
        if not format_type or not storage_uri:
            raise HTTPException(
                status_code=400,
                detail="format_type and storage_uri are required"
            )
        
        result = await delta_iceberg_connector.test_connection(
            format_type=format_type,
            storage_uri=storage_uri,
            credentials=credentials,
            **{k: v for k, v in request.items() if k not in ['format_type', 'storage_uri', 'credentials']}
        )
        
        return result
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Delta/Iceberg connection test failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


@router.post("/delta-iceberg/connect")
async def connect_delta_iceberg(
    request: Dict[str, Any],
    current_token: Union[str, dict] = Depends(JWTCookieBearer())
):
    """Connect to Delta Lake or Apache Iceberg table and create data source"""
    try:
        # Extract user ID
        user_id = None
        organization_id = None
        try:
            if isinstance(current_token, dict):
                user_payload = current_token
            else:
                user_payload = extract_user_payload(current_token)
            
            user_id = str(user_payload.get('id') or user_payload.get('user_id') or user_payload.get('sub') or '')
            organization_id = user_payload.get('organization_id')
        except Exception as e:
            logger.error(f"❌ Failed to extract user_id: {e}")
            user_id = ''
        
        if not user_id:
            raise HTTPException(status_code=403, detail="Authentication required")
        
        # Enforce data source limit
        lh_org_id = str(organization_id or f"user-{user_id}")
        organization_id = await enforce_data_source_limit(user_id, lh_org_id)
        
        format_type = request.get('format_type')  # 'delta', 'iceberg', 's3_parquet', 'azure_blob', 'gcp_cloud_storage'
        storage_uri = request.get('storage_uri')
        credentials = request.get('credentials', {})
        name = request.get('name', f"{format_type}_connection")
        
        if not format_type or not storage_uri:
            raise HTTPException(
                status_code=400,
                detail="format_type and storage_uri are required"
            )
        
        # Test connection first
        test_result = await delta_iceberg_connector.test_connection(
            format_type=format_type,
            storage_uri=storage_uri,
            credentials=credentials,
            **{k: v for k, v in request.items() if k not in ['format_type', 'storage_uri', 'credentials', 'name']}
        )
        
        if not test_result.get('success'):
            raise HTTPException(
                status_code=400,
                detail=f"Connection test failed: {test_result.get('error', 'Unknown error')}"
            )
        
        # Get full connection result with schema and sample data
        if format_type in ['delta', 'delta_lake']:
            connect_result = await delta_iceberg_connector.connect_delta_table(
                storage_uri=storage_uri,
                credentials=credentials,
                version=request.get('version'),
                timestamp=request.get('timestamp'),
                organization_id=organization_id
            )
        elif format_type in ['iceberg']:
            connect_result = await delta_iceberg_connector.connect_iceberg_table(
                storage_uri=storage_uri,
                credentials=credentials,
                snapshot_id=request.get('snapshot_id'),
                organization_id=organization_id
            )
        elif format_type in ['s3_parquet', 'azure_blob', 'gcp_cloud_storage']:
            # For direct cloud storage files (S3, Azure, GCP), use connect_cloud_storage_file
            file_format = request.get('file_format', 'parquet')  # Default to parquet, but supports csv, json, tsv
            connect_result = await delta_iceberg_connector.connect_cloud_storage_file(
                storage_uri=storage_uri,
                credentials=credentials,
                file_format=file_format,
                organization_id=organization_id
            )
        else:
            raise HTTPException(status_code=400, detail=f"Unsupported format: {format_type}")
        
        if not connect_result.get('success'):
            raise HTTPException(
                status_code=400,
                detail=f"Connection failed: {connect_result.get('error', 'Unknown error')}"
            )
        
        # Store data source in database
        from src.db.session import async_session
        async with async_session() as db:
            import uuid
            from datetime import datetime
            
            data_source_id = str(uuid.uuid4())
            schema_json = json.dumps(connect_result.get('schema', []))
            
            # Encrypt credentials
            from src.modules.data.utils.encryption import encrypt_credentials
            safe_credentials = encrypt_credentials(credentials)
            
            connection_config = {
                'storage_uri': storage_uri,
                'format_type': format_type,
                'credentials': safe_credentials,
                **{k: v for k, v in request.items() if k not in ['format_type', 'storage_uri', 'credentials', 'name']}
            }
            
            insert_query = sa.text("""
                INSERT INTO data_sources 
                (id, name, type, format, db_type, size, row_count, schema, 
                 connection_config, metadata, user_id, is_active, 
                 created_at, updated_at, last_accessed, file_path)
                VALUES 
                (:id, :name, :type, :format, :db_type, :size, :row_count, :schema,
                 :connection_config, :metadata, :user_id, :is_active,
                 :created_at, :updated_at, :last_accessed, :file_path)
            """)
            
            await db.execute(insert_query, {
                "id": data_source_id,
                "name": name,
                "type": 'warehouse',
                "format": format_type,
                "db_type": format_type,
                "size": 0,
                "row_count": connect_result.get('row_count', 0),
                "schema": schema_json,
                "connection_config": json.dumps(connection_config),
                "metadata": json.dumps({
                    'connection_type': 'delta_iceberg',
                    'storage_uri': storage_uri,
                    'format': format_type,
                    'status': 'connected',
                    'created_at': datetime.now().isoformat()
                }),
                "user_id": user_id,
                "is_active": True,
                "created_at": datetime.now(),
                "updated_at": datetime.now(),
                "last_accessed": datetime.now(),
                "file_path": storage_uri  # Store URI as file_path for query service
            })
            
            await db.commit()
        
        return {
            "success": True,
            "data_source_id": data_source_id,
            "data_source": {
                "id": data_source_id,
                "name": name,
                "type": "warehouse",
                "format": format_type,
                "db_type": format_type,
                "status": "connected",
                "schema": connect_result.get('schema', []),
                "row_count": connect_result.get('row_count', 0)
            },
            "message": f"{format_type} connection created successfully"
        }
        
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ Delta/Iceberg connection failed: {str(e)}")
        import traceback
        logger.error(f"Full traceback: {traceback.format_exc()}")
        raise HTTPException(status_code=500, detail=str(e))


# ---------------------------------------------------------------------------
# Streaming Ingestion (ClickHouse Kafka → MergeHouse)
# Plan-gated: require_plan_feature("streaming"). Org-scoped via get_user_organization_id.
# ---------------------------------------------------------------------------

class StreamCreateRequest(BaseModel):
    data_source_id: str
    kafka_brokers: str
    topic: str
    consumer_group: str = "aiser"
    format: str = "JSONEachRow"
    target_table: str
    columns: list[dict]  # [{"name": str, "ch_type": str}]
    streaming_mode: str = "realtime"  # realtime | microbatch


class KafkaBrokersTestRequest(BaseModel):
    kafka_brokers: str
    topic: Optional[str] = None


async def _streams_user_org(
    current_token: Union[str, dict],
    db: AsyncSession,
) -> tuple[str, str]:
    """Return (user_id, org_id) for stream APIs."""
    user_payload = current_token if isinstance(current_token, dict) else extract_user_payload(current_token)
    user_id = str(
        (user_payload or {}).get("id")
        or (user_payload or {}).get("user_id")
        or (user_payload or {}).get("sub")
        or ""
    ).strip()
    if not user_id:
        raise HTTPException(status_code=status.HTTP_401_UNAUTHORIZED, detail={"message": "Authentication required"})
    org_id = await get_user_organization_id(user_id, db)
    if not org_id and user_payload:
        org_id = str(user_payload.get("organization_id") or user_payload.get("org_id") or "").strip() or None
    if not org_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={"message": "Join or select an organization to manage stream ingestion."},
        )
    return user_id, org_id


@router.post("/streams/test-kafka", dependencies=[Depends(require_plan_feature("streaming"))])
async def test_kafka_brokers(
    request: KafkaBrokersTestRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Verify Kafka broker connectivity (and optional topic) before creating a stream."""
    import asyncio

    _ = current_token
    brokers = (request.kafka_brokers or "").strip()
    if not brokers:
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"message": "kafka_brokers is required"})
    try:
        from kafka import KafkaAdminClient  # type: ignore
    except ImportError:
        raise HTTPException(
            status_code=status.HTTP_503_SERVICE_UNAVAILABLE,
            detail={"message": "kafka-python not installed on server"},
        ) from None

    def _probe():
        admin = KafkaAdminClient(bootstrap_servers=[b.strip() for b in brokers.split(",") if b.strip()], request_timeout_ms=10000)
        try:
            return set(admin.list_topics())
        finally:
            admin.close()

    try:
        topics = await asyncio.to_thread(_probe)
    except Exception as e:
        return {"success": False, "error": str(e)}

    topic = (request.topic or "").strip()
    out: dict = {"success": True, "topic_count": len(topics)}
    if topic:
        out["topic_found"] = topic in topics
        if topic not in topics:
            out["message"] = f"Broker OK but topic '{topic}' was not found"
    else:
        out["message"] = "Kafka brokers reachable"
    return out


@router.post("/streams", dependencies=[Depends(require_plan_feature("streaming"))])
async def create_stream(
    request: StreamCreateRequest,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Create a ClickHouse Kafka engine stream into a MergeTree landing table (org-scoped)."""
    from ee.modules.data.services.streaming_ingestion_service import (
        StreamDefinition,
        ColumnDef,
        StreamingIngestionService,
    )

    mode = (request.streaming_mode or "realtime").strip().lower()
    if mode not in ("realtime", "microbatch"):
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail={"message": "streaming_mode must be 'realtime' or 'microbatch'."},
        )

    try:
        _uid, org_id = await _streams_user_org(current_token, db)

        defn = StreamDefinition(
            data_source_id=request.data_source_id,
            kafka_brokers=request.kafka_brokers.strip(),
            topic=request.topic.strip(),
            consumer_group=(request.consumer_group or "aiser").strip(),
            format=request.format.strip(),
            target_table=request.target_table.strip(),
            columns=[ColumnDef(**c) for c in request.columns],
            streaming_mode=mode,
        )
        svc = StreamingIngestionService(db)
        result = await svc.create_stream(defn, org_id)
        if not result.get("success"):
            err = result.get("error", "Stream creation failed")
            logger.warning("create_stream rejected: %s", err)
            raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail={"message": err})
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ create_stream failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"message": "Could not create the stream. Try again or contact support."},
        ) from e


@router.get("/streams", dependencies=[Depends(require_plan_feature("streaming"))])
async def list_streams(
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """List stream definitions for the organisation."""
    from ee.modules.data.services.streaming_ingestion_service import StreamingIngestionService

    try:
        _uid, org_id = await _streams_user_org(current_token, db)
        svc = StreamingIngestionService(db)
        return {"streams": await svc.list_streams(org_id)}
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"❌ list_streams failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"message": "Could not load streams."},
        ) from e


@router.get("/streams/{stream_id}/status", dependencies=[Depends(require_plan_feature("streaming"))])
async def get_stream_status(
    stream_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Get consumer lag and throughput for a stream."""
    from ee.modules.data.services.streaming_ingestion_service import StreamingIngestionService

    try:
        _uid, org_id = await _streams_user_org(current_token, db)
        svc = StreamingIngestionService(db)
        out = await svc.get_stream_status(stream_id, org_id)
        if out.get("error"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"message": out["error"]})
        return out
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"get_stream_status failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"message": "Could not load stream status."},
        ) from e


@router.post("/streams/{stream_id}/test", dependencies=[Depends(require_plan_feature("streaming"))])
async def test_stream(
    stream_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Peek at rows from the Kafka engine table (debug)."""
    from ee.modules.data.services.streaming_ingestion_service import StreamingIngestionService

    try:
        _uid, org_id = await _streams_user_org(current_token, db)
        svc = StreamingIngestionService(db)
        out = await svc.test_stream(stream_id, org_id)
        if isinstance(out, dict) and out.get("error"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"message": out["error"]})
        return out
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"test_stream failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"message": "Could not sample stream data."},
        ) from e


@router.delete("/streams/{stream_id}", dependencies=[Depends(require_plan_feature("streaming"))])
async def delete_stream(
    stream_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Drop Kafka engine table + MV and remove the stream record (landing MergeTree kept)."""
    from ee.modules.data.services.streaming_ingestion_service import StreamingIngestionService

    try:
        _uid, org_id = await _streams_user_org(current_token, db)
        svc = StreamingIngestionService(db)
        result = await svc.delete_stream(stream_id, org_id)
        if result.get("error"):
            raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail={"message": result["error"]})
        return result
    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"delete_stream failed: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail={"message": "Could not remove the stream."},
        ) from e


@router.get("/schema/{data_source_id}/export")
async def export_schema(data_source_id: str, format: str = 'yaml'):
    """Export schema in various formats"""
    try:
        result = await yaml_schema_service.export_schema(data_source_id, format)
        return result
        
    except Exception as e:
        logger.error(f"❌ Schema export failed: {str(e)}")
        raise HTTPException(status_code=500, detail=str(e))


from src.modules.data.model_router import router as data_model_router

router.include_router(
    data_model_router,
    prefix="/data-sources/{data_source_id}/model",
    tags=["data-model"],
)
