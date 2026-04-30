"""Dashboards models — consolidated dashboard models to avoid mapper conflicts.

All dashboard-related models are defined here to ensure single source of truth
and avoid duplicate mapper registration conflicts.
"""

from src.shared.model import BaseModel
from src.db.base import Base
from sqlalchemy import Column, String, Text, Boolean, Integer, DateTime, JSON, ForeignKey, UUID, Float
from sqlalchemy.orm import relationship
from sqlalchemy import func, Table, MetaData
from sqlalchemy.dialects.postgresql import JSONB, UUID as PG_UUID
from sqlalchemy.ext.mutable import MutableDict
from sqlalchemy.sql import text
import uuid
from src.core.edition import is_ee_enabled

def _org_fk():
    return [ForeignKey("organizations.id")] if is_ee_enabled() else []


class DashboardChart(Base):
    """
    DashboardChart model matching database schema.
    Table: dashboard_charts

    Schema:
    - id : UUID (PK)
    - dashboard_id :  UUID (FK)
    - chart_id : UUID (FK)
    - created_at : timestamp
    - updated_at : timestamp

    Note: Does not inherit from BaseModel because we don't need is_active or is_deleted.
    """
    __tablename__ = "dashboard_charts"

    # Primary key
    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid(), index=True)

    # Ownership
    dashboard_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    chart_id = Column(UUID(as_uuid=True), nullable=False, index=True)

    layout = Column(MutableDict.as_mutable(JSONB), nullable=True)

    # Timestamps
    created_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now(), onupdate=func.now())


class Dashboard(BaseModel):
    """Dashboard model - single canonical definition"""
    __tablename__ = "dashboards"
    __table_args__ = {'extend_existing': True}
    
    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    config = Column(JSON, nullable=True)
    
    # Relationships — use simple class names for registry lookup
    embeds = relationship("DashboardEmbed", back_populates="dashboard", lazy='select')
    pages = relationship("DashboardPage", back_populates="dashboard", lazy='select')
    shares = relationship("DashboardShare", back_populates="dashboard", lazy='select')


class DashboardPage(BaseModel):
    """Dashboard page model for multi-page dashboards"""
    __tablename__ = "dashboard_pages"
    __table_args__ = {'extend_existing': True}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dashboard_id = Column(UUID(as_uuid=True), ForeignKey("dashboards.id"), nullable=False)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    page_order = Column(Integer, default=0)
    
    # Page settings
    layout_config = Column(JSON, nullable=True)  # Page-specific layout
    filters = Column(JSON, nullable=True)        # Page-specific filters
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationship to Dashboard — use simple class name for registry lookup
    dashboard = relationship("Dashboard", back_populates="pages", lazy='select')


# Standalone Table definition for dashboard_widgets (not an ORM class)
# This is used for raw SQL operations, bypassing SQLAlchemy's ORM mapper.
metadata_obj = MetaData()
dashboard_widgets_table = Table(
    "dashboard_widgets",
    metadata_obj,
    Column("id", UUID(as_uuid=True), primary_key=True, default=uuid.uuid4),
    Column("dashboard_id", UUID(as_uuid=True), ForeignKey("dashboards.id"), nullable=False),
    Column("page_id", UUID(as_uuid=True), ForeignKey("dashboard_pages.id"), nullable=True),
    Column("name", String(255), nullable=False),
    Column("widget_type", String(50), nullable=False),
    Column("chart_type", String(50), nullable=True),
    Column("config", JSON, nullable=True),
    Column("data_config", JSON, nullable=True),
    Column("style_config", JSON, nullable=True),
    Column("x", Integer, default=0),
    Column("y", Integer, default=0),
    Column("width", Integer, default=4),
    Column("height", Integer, default=3),
    Column("z_index", Integer, default=0),
    Column("is_visible", Boolean, default=True),
    Column("is_locked", Boolean, default=False),
    Column("is_resizable", Boolean, default=True),
    Column("is_draggable", Boolean, default=True),
    Column("last_data_refresh", DateTime(timezone=True), nullable=True),
    Column("data_cache_ttl", Integer, default=300),
    Column("query_execution_time", Float, nullable=True),
    Column("created_at", DateTime(timezone=True), server_default=func.now()),
    Column("updated_at", DateTime(timezone=True), onupdate=func.now()),
)

class DashboardShare(BaseModel):
    """Dashboard sharing model for collaboration"""
    __tablename__ = "dashboard_shares"
    __table_args__ = {'extend_existing': True}

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dashboard_id = Column(UUID(as_uuid=True), ForeignKey("dashboards.id"), nullable=False)
    shared_by = Column(PG_UUID(as_uuid=True), nullable=False)
    shared_with = Column(PG_UUID(as_uuid=True), nullable=True)
    organization_id = Column(UUID(as_uuid=True), *_org_fk(), nullable=True)
    
    # Share settings
    permission = Column(String(20), default="view")  # view, edit, admin
    expires_at = Column(DateTime(timezone=True), nullable=True)
    is_active = Column(Boolean, default=True)
    
    # Share metadata
    share_token = Column(String(255), nullable=True)  # For public shares
    access_count = Column(Integer, default=0)
    last_accessed_at = Column(DateTime(timezone=True), nullable=True)
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationship to Dashboard — use simple class name for registry lookup
    dashboard = relationship("Dashboard", back_populates="shares", lazy='select')
    # organization relationship removed: Organization is defined in app.db.models and importing
    # it here causes circular mapper init errors. Use organization_id FK column directly.


class DashboardTemplate(BaseModel):
    """Dashboard template model for reusable dashboard designs"""
    __tablename__ = "dashboard_templates"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    category = Column(String(100), nullable=True)  # sales, marketing, finance, etc.
    
    # Template configuration
    template_config = Column(JSON, nullable=False)  # Complete dashboard configuration
    preview_image_url = Column(String(500), nullable=True)
    
    # Template metadata
    is_public = Column(Boolean, default=False)
    is_featured = Column(Boolean, default=False)
    usage_count = Column(Integer, default=0)
    rating = Column(Float, default=0.0)
    
    # Plan requirements
    required_plan = Column(String(20), default="free")  # free, pro, team, enterprise
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), onupdate=func.now())
    
    # Relationships
    created_by = Column(PG_UUID(as_uuid=True), nullable=True)


class DashboardAnalytics(BaseModel):
    """Dashboard analytics model for usage tracking"""
    __tablename__ = "dashboard_analytics"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dashboard_id = Column(UUID(as_uuid=True), ForeignKey("dashboards.id"), nullable=False)
    user_id = Column(PG_UUID(as_uuid=True), nullable=True)
    
    # Analytics data
    event_type = Column(String(50), nullable=False)  # view, edit, share, export, etc.
    event_data = Column(JSON, nullable=True)         # Additional event metadata
    session_id = Column(String(255), nullable=True)
    
    # Performance metrics
    load_time = Column(Float, nullable=True)         # Dashboard load time
    render_time = Column(Float, nullable=True)       # Widget render time
    query_time = Column(Float, nullable=True)        # Data query time
    
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    
    # Relationships
    dashboard = relationship("Dashboard")


# Plan-based feature restrictions
PLAN_LIMITS = {
    "free": {
        "max_dashboards": 3,
        "max_widgets_per_dashboard": 10,
        "max_pages_per_dashboard": 3,
        "max_shared_dashboards": 1,
        "export_formats": ["png"],
        "refresh_interval_min": 300,  # 5 minutes
        "data_retention_days": 30,
        "collaboration": False,
        "custom_themes": False,
        "advanced_filters": False,
        "real_time_data": False
    },
    "pro": {
        "max_dashboards": 20,
        "max_widgets_per_dashboard": 50,
        "max_pages_per_dashboard": 10,
        "max_shared_dashboards": 10,
        "export_formats": ["png", "pdf", "html"],
        "refresh_interval_min": 60,   # 1 minute
        "data_retention_days": 90,
        "collaboration": True,
        "custom_themes": True,
        "advanced_filters": True,
        "real_time_data": False
    },
    "team": {
        "max_dashboards": 100,
        "max_widgets_per_dashboard": 100,
        "max_pages_per_dashboard": 20,
        "max_shared_dashboards": 50,
        "export_formats": ["png", "pdf", "html", "excel"],
        "refresh_interval_min": 30,   # 30 seconds
        "data_retention_days": 180,
        "collaboration": True,
        "custom_themes": True,
        "advanced_filters": True,
        "real_time_data": True,
        "api_access": True,
        "webhooks": True
    },
    "enterprise": {
        "max_dashboards": -1,  # Unlimited
        "max_widgets_per_dashboard": -1,  # Unlimited
        "max_pages_per_dashboard": -1,    # Unlimited
        "max_shared_dashboards": -1,      # Unlimited
        "export_formats": ["png", "pdf", "html", "excel", "csv", "json"],
        "refresh_interval_min": 10,       # 10 seconds
        "data_retention_days": 365,
        "collaboration": True,
        "custom_themes": True,
        "advanced_filters": True,
        "real_time_data": True,
        "api_access": True,
        "webhooks": True,
        "sso": True,
        "audit_logs": True,
        "custom_branding": True,
        "priority_support": True
    }
}

# Ensure cross-module relationship targets are registered in the same declarative registry.
# Dashboard.embeds references "DashboardEmbed" which is defined in charts.models.
from src.modules.charts.models import DashboardEmbed  # noqa: F401
