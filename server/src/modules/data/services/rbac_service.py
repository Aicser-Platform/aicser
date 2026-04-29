"""
RBAC Service for Data Sources
Handles user, organization, project, and role-based access control

IMPORTANT: This module avoids importing dashboard-related models to prevent
SQLAlchemy mapper conflicts. Use direct SQL queries when possible.
"""

import logging
from typing import List, Dict, Any, Optional, Tuple
from sqlalchemy import select, and_, or_, text
from src.db.session import async_session
from src.modules.data.models import DataSource
# Import models directly to avoid triggering dashboard model imports
# from src.modules.projects.models import Project, Organization, UserOrganization
# from src.modules.user.models import User

logger = logging.getLogger(__name__)


class DataSourceRBACService:
    """
    Role-Based Access Control service for data sources.
    
    Handles proper user, organization, project, and role relationships
    based on the existing database schema.
    """
    
    def __init__(self):
        self.logger = logger
    
    async def get_user_context(self, user_id: str) -> Dict[str, Any]:
        """
        Get comprehensive user context including organizations and projects.
        
        Args:
            user_id: User UUID
            
        Returns:
            Dict containing user, organizations, projects, and roles
        """
        try:
            async with async_session() as db:
                # Get user info - convert user_id to string for comparison
                # Use direct SQL to avoid importing models that trigger mapper conflicts
                user_id_str = str(user_id)
                
                # Users table: id, email, username, first_name, last_name, role, status, tenant_id (after migration)
                user_result = await db.execute(
                    text("SELECT id, email, username, first_name, last_name, role, status, tenant_id FROM users WHERE id = :user_id"),
                    {"user_id": user_id_str}
                )
                user_row = user_result.fetchone()
                if not user_row:
                    return {"error": "User not found"}

                # Get user's organizations with roles - use direct SQL
                org_result = await db.execute(
                    text("""
                        SELECT o.id, o.name, o.slug, o.plan_type, COALESCE(r.name, 'user') as role_name
                        FROM organizations o
                        JOIN user_roles uo ON o.id = uo.organization_id
                        LEFT JOIN roles r ON r.id = uo.role_id
                        WHERE uo.user_id = :user_id
                        AND (uo.is_active = true OR uo.is_active IS NULL)
                        AND o.is_active = true
                    """),
                    {"user_id": user_id_str}
                )
                organizations = [
                    {
                        "id": row[0],
                        "name": row[1],
                        "slug": row[2],
                        "plan_type": row[3],
                        "role": row[4]
                    }
                    for row in org_result.fetchall()
                ]
                
                # Get user's projects - use direct SQL to avoid Project model import
                project_result = await db.execute(
                    text("""
                        SELECT id, name, description, organization_id, created_by, is_public
                        FROM projects
                        WHERE (created_by = :user_id OR organization_id = ANY(:org_ids))
                        AND is_active = true
                    """),
                    {"user_id": user_id_str, "org_ids": [org["id"] for org in organizations]}
                )
                projects = [
                    {
                        "id": row[0],
                        "name": row[1],
                        "description": row[2],
                        "organization_id": row[3],
                        "created_by": str(row[4]),
                        "is_public": row[5]
                    }
                    for row in project_result.fetchall()
                ]
                
                return {
                    "user": {
                        "id": str(user_row[0]),
                        "email": user_row[1],
                        "username": user_row[2],
                        "first_name": user_row[3] if len(user_row) > 3 else None,
                        "last_name": user_row[4] if len(user_row) > 4 else None,
                        "role": user_row[5] if len(user_row) > 5 else None,
                        "status": user_row[6] if len(user_row) > 6 else None,
                        "tenant_id": user_row[7] if len(user_row) > 7 else None,
                    },
                    "organizations": organizations,
                    "projects": projects,
                    "has_admin_access": any(org["role"] in ["admin", "owner"] for org in organizations)
                }
                
        except Exception as e:
            self.logger.error(f"Error getting user context: {e}")
            import traceback
            self.logger.error(f"Full traceback: {traceback.format_exc()}")
            # Return minimal context instead of error to allow data sources to be listed
            return {
                "user": {"id": str(user_id)},
                "organizations": [],
                "projects": [],
                "has_admin_access": False
            }
    
    async def get_accessible_data_sources(
        self, 
        user_id: str, 
        organization_id: Optional[int] = None,
        project_id: Optional[int] = None
    ) -> List[Dict[str, Any]]:
        """
        Get data sources accessible to user based on RBAC rules.
        
        Rules:
        1. Data sources owned by user (user_id matches)
        2. Data sources in user's projects
        3. Data sources in user's organizations (if user has appropriate role)
        
        Args:
            user_id: User UUID
            organization_id: Optional organization filter
            project_id: Optional project filter
            
        Returns:
            List of accessible data sources
        """
        try:
            async with async_session() as db:
                # Get user context - handle errors gracefully
                try:
                    user_context = await self.get_user_context(user_id)
                    if "error" in user_context:
                        # If user context fails, still try to get user's own data sources
                        user_project_ids = []
                        user_org_ids = []
                    else:
                        user_org_ids = [org["id"] for org in user_context.get("organizations", [])]
                        user_project_ids = [proj["id"] for proj in user_context.get("projects", [])]
                except Exception as ctx_error:
                    self.logger.warning(f"Could not get user context, falling back to user-owned sources only: {ctx_error}")
                    user_project_ids = []
                    user_org_ids = []
                
                # Build query conditions - CRITICAL: Always filter by user_id first
                # Security: Never return data sources from other users
                conditions = []
                
                # 1. Data sources owned by user (convert to string for comparison)
                # This is MANDATORY - all results must be owned by this user
                user_owned_condition = DataSource.user_id == str(user_id)
                
                # 2. Data sources in user's projects - use direct SQL
                project_data_source_ids = []
                if user_project_ids:
                    try:
                        project_ds_result = await db.execute(
                            text("""
                                SELECT data_source_id
                                FROM project_data_source
                                WHERE project_id = ANY(:project_ids)
                            """),
                            {"project_ids": user_project_ids}
                        )
                        project_data_source_ids = [row[0] for row in project_ds_result.fetchall()]
                    except Exception as proj_error:
                        self.logger.warning(f"Could not get project data sources: {proj_error}")
                
                # Build final query - ALWAYS require user_id match
                # Only include project sources if they ALSO belong to the user
                if project_data_source_ids:
                    # Get project sources that are ALSO owned by the user
                    result = await db.execute(
                        select(DataSource).where(
                            and_(
                                user_owned_condition,  # MUST be owned by user
                                DataSource.id.in_(project_data_source_ids),  # AND in user's projects
                                DataSource.is_active == True
                            )
                        ).order_by(DataSource.created_at.desc())
                    )
                else:
                    # Only user-owned sources (no project sources)
                    result = await db.execute(
                        select(DataSource).where(
                            and_(
                                user_owned_condition,  # MUST be owned by user
                                DataSource.is_active == True
                            )
                        ).order_by(DataSource.created_at.desc())
                    )
                
                data_sources = result.scalars().all()
                
                # Convert to response format
                accessible_sources = []
                for ds in data_sources:
                    source_data = {
                        "id": ds.id,
                        "name": ds.name,
                        "type": ds.type,
                        "format": ds.format,
                        "db_type": ds.db_type,
                        "size": ds.size,
                        "row_count": ds.row_count,
                        "schema": ds.schema,
                        "description": ds.description,
                        "user_id": ds.user_id,
                        "created_at": ds.created_at.isoformat() if ds.created_at else None,
                        "updated_at": ds.updated_at.isoformat() if ds.updated_at else None,
                        "is_active": ds.is_active,
                        "last_accessed": ds.last_accessed.isoformat() if ds.last_accessed else None
                    }
                    
                    # Add config for database/warehouse sources - CRITICAL: Decrypt credentials
                    if (ds.type == 'database' or ds.type == 'warehouse') and ds.connection_config:
                        try:
                            import json
                            config = json.loads(ds.connection_config) if isinstance(ds.connection_config, str) else ds.connection_config
                            
                            # CRITICAL: Decrypt credentials before returning
                            try:
                                from src.modules.data.utils.credentials import decrypt_credentials
                                config = decrypt_credentials(config)
                            except Exception as decrypt_error:
                                self.logger.debug(f"Could not decrypt credentials (may not be encrypted): {decrypt_error}")
                            
                            # Add to both config and connection_config for compatibility
                            source_data["config"] = config
                            source_data["connection_config"] = config
                            source_data["connection_info"] = config  # Also add as connection_info for query engine
                            source_data["status"] = "connected"
                            source_data["connection_status"] = "connected"  # Add connection_status for frontend
                        except Exception as config_error:
                            self.logger.warning(f"Error parsing connection_config for data source {ds.id}: {config_error}")
                            source_data["config"] = {}
                            source_data["connection_config"] = {}
                            source_data["status"] = "disconnected"
                            source_data["connection_status"] = "disconnected"  # Add connection_status for frontend
                    
                    # For file sources, check if they're active
                    if ds.type == 'file':
                        source_data["status"] = "connected" if ds.is_active else "disconnected"
                        source_data["connection_status"] = "connected" if ds.is_active else "disconnected"
                    elif "connection_status" not in source_data:
                        # Default status for other types
                        source_data["connection_status"] = source_data.get("status", "unknown")
                    
                    accessible_sources.append(source_data)
                
                return accessible_sources
                
        except Exception as e:
            self.logger.error(f"Error getting accessible data sources: {e}")
            import traceback
            self.logger.error(f"Full traceback: {traceback.format_exc()}")
            # Return empty list instead of raising to allow UI to continue
            return []
    
    async def can_access_data_source(
        self, 
        user_id: str, 
        data_source_id: str
    ) -> Tuple[bool, str]:
        """
        Check if user can access a specific data source.
        
        Args:
            user_id: User UUID
            data_source_id: Data source ID
            
        Returns:
            Tuple of (can_access: bool, reason: str)
        """
        try:
            async with async_session() as db:
                # Get data source
                result = await db.execute(
                    select(DataSource).where(
                        and_(
                            DataSource.id == data_source_id,
                            DataSource.is_active == True
                        )
                    )
                )
                data_source = result.scalar_one_or_none()
                
                if not data_source:
                    return False, "Data source not found"
                
                # Check direct ownership (convert to string for comparison)
                if data_source.user_id == str(user_id):
                    return True, "Direct ownership"
                
                # Check project access
                from src.modules.data.models import ProjectDataSource
                project_result = await db.execute(
                    select(ProjectDataSource.project_id).where(
                        ProjectDataSource.data_source_id == data_source_id
                    )
                )
                project_ids = [row[0] for row in project_result.fetchall()]
                
                if project_ids:
                    # Check if user has access to any of these projects
                    user_context = await self.get_user_context(user_id)
                    if "error" in user_context:
                        return False, "User context error"
                    
                    user_project_ids = [proj["id"] for proj in user_context["projects"]]
                    if any(pid in user_project_ids for pid in project_ids):
                        return True, "Project access"
                
                return False, "No access permission"
                
        except Exception as e:
            self.logger.error(f"Error checking data source access: {e}")
            return False, f"Error: {str(e)}"
    
    async def can_delete_data_source(
        self, 
        user_id: str, 
        data_source_id: str
    ) -> Tuple[bool, str]:
        """
        Check if user can delete a specific data source.
        
        Rules:
        1. User owns the data source directly
        2. User is admin/owner of organization that owns the data source
        
        Args:
            user_id: User UUID
            data_source_id: Data source ID
            
        Returns:
            Tuple of (can_delete: bool, reason: str)
        """
        try:
            async with async_session() as db:
                # Get data source
                result = await db.execute(
                    select(DataSource).where(
                        and_(
                            DataSource.id == data_source_id,
                            DataSource.is_active == True
                        )
                    )
                )
                data_source = result.scalar_one_or_none()
                
                if not data_source:
                    return False, "Data source not found"
                
                # Check direct ownership (convert to string for comparison)
                if data_source.user_id == str(user_id):
                    return True, "Direct ownership"
                
                # Check organization admin access
                user_context = await self.get_user_context(user_id)
                if "error" in user_context:
                    return False, "User context error"
                
                # Check if data source is in user's organization and user is admin
                if user_context.get("has_admin_access"):
                    # Get projects that contain this data source
                    from src.modules.data.models import ProjectDataSource
                    project_result = await db.execute(
                        select(ProjectDataSource.project_id).where(
                            ProjectDataSource.data_source_id == data_source_id
                        )
                    )
                    project_ids = [row[0] for row in project_result.fetchall()]
                    
                    if project_ids:
                        # Check if any of these projects belong to user's organizations
                        project_org_result = await db.execute(
                            select(Project.organization_id).where(
                                Project.id.in_(project_ids)
                            )
                        )
                        project_org_ids = [row[0] for row in project_org_result.fetchall()]
                        
                        user_org_ids = [org["id"] for org in user_context["organizations"]]
                        if any(oid in user_org_ids for oid in project_org_ids):
                            return True, "Organization admin access"
                
                return False, "No delete permission"
                
        except Exception as e:
            self.logger.error(f"Error checking delete permission: {e}")
            return False, f"Error: {str(e)}"
    
    async def add_data_source_to_project(
        self,
        user_id: str,
        data_source_id: str,
        project_id: int
    ) -> Tuple[bool, str]:
        """
        Add data source to project with proper permission checks.
        
        Args:
            user_id: User UUID
            data_source_id: Data source ID
            project_id: Project ID
            
        Returns:
            Tuple of (success: bool, message: str)
        """
        try:
            async with async_session() as db:
                # Check if user can access the data source
                can_access, reason = await self.can_access_data_source(user_id, data_source_id)
                if not can_access:
                    return False, f"Cannot access data source: {reason}"
                
                # Check if user can access the project
                user_context = await self.get_user_context(user_id)
                if "error" in user_context:
                    return False, "User context error"
                
                user_project_ids = [proj["id"] for proj in user_context["projects"]]
                if project_id not in user_project_ids:
                    return False, "No access to project"
                
                # Check if data source is already in project
                from src.modules.data.models import ProjectDataSource
                existing_result = await db.execute(
                    select(ProjectDataSource).where(
                        and_(
                            ProjectDataSource.project_id == project_id,
                            ProjectDataSource.data_source_id == data_source_id
                        )
                    )
                )
                existing = existing_result.scalar_one_or_none()
                
                if existing:
                    return False, "Data source already in project"
                
                # Add data source to project
                project_data_source = ProjectDataSource(
                    project_id=project_id,
                    data_source_id=data_source_id,
                    data_source_type="database",  # or determine from data source
                    is_active=True
                )
                
                db.add(project_data_source)
                await db.commit()
                
                return True, "Data source added to project successfully"
                
        except Exception as e:
            self.logger.error(f"Error adding data source to project: {e}")
            return False, f"Error: {str(e)}"


# Global instance
rbac_service = DataSourceRBACService()
