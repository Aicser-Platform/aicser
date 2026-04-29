from src.shared.model import BaseModel
from src.db.base import Base
from sqlalchemy import UUID, Column, String, Boolean, Integer, ForeignKey, DateTime, Text, JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.orm import relationship
from sqlalchemy.sql import func, text
import uuid
from src.core.edition import is_ee_enabled

_project_fk = [ForeignKey("projects.id")] if is_ee_enabled() else []
_conversation_fk = [ForeignKey("conversation.id")] if is_ee_enabled() else []


class Chart(Base):
    """
    Charts model matching database schema.
    Table: charts
    """
    __tablename__ = "charts"

    # Primary key
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        server_default=func.gen_random_uuid(),
        index=True,
    )

    # Relations
    data_source_id = Column(
        String,
        ForeignKey("data_sources.id"),
        nullable=True,
        index=True,
    )

    # Chart details
    title = Column(Text, nullable=True)
    chart_type = Column(String(50), nullable=False)

    chart_query = Column(JSONB, nullable=False, server_default="{}")
    chart_options = Column(JSONB, nullable=False, server_default="{}")

    # Ownership
    dashboard_id = Column(UUID(as_uuid=True), ForeignKey("dashboards.id"), nullable=True)
    project_id = Column(UUID(as_uuid=True), *_project_fk, nullable=True)
    # Timestamps
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    user_id = Column(UUID(as_uuid=True), nullable=True, index=True)


class QueryPattern(Base):
    """
    Persistent store for successful (query → SQL) patterns.
    Phase 2: AI learns from every successful query execution and from
    user-saved queries in Monaco. Feeds few-shot retrieval and template
    extraction.

    Table: query_patterns
    """
    __tablename__ = "query_patterns"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid(), index=True)

    # Who & where
    user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    data_source_id = Column(String, nullable=True, index=True)
    schema_hash = Column(String(24), nullable=False, index=True)

    # The pattern
    nl_query = Column(Text, nullable=False)
    nl_query_normalized = Column(Text, nullable=False, index=True)
    sql = Column(Text, nullable=False)
    analytics_type = Column(String(50), nullable=True, server_default=text("'descriptive'"))

    # Quality signals
    score = Column(Integer, nullable=True, server_default=text("1"))  # thumbs up/down adjustable
    execution_count = Column(Integer, nullable=True, server_default=text("1"))
    avg_latency_ms = Column(Integer, nullable=True)

    # Origin: 'ai_pipeline' or 'saved_query' or 'manual'
    origin = Column(String(50), nullable=True, server_default=text("'ai_pipeline'"))

    # Embedding for RAG / few-shot retrieval (JSONB list of floats when pgvector not used)
    embedding = Column(JSON, nullable=True)

    # Ownership (nullable: AI pipeline patterns are schema-scoped, not dashboard-bound)
    dashboard_id = Column(UUID(as_uuid=True), ForeignKey("dashboards.id"), nullable=True)
    # Timestamps
    created_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=True, server_default=func.now(), onupdate=func.now())


class ChatVisualization(BaseModel):
    """ChatVisualizationModel - Now using consolidated charts table."""

    __tablename__ = "charts"
    __table_args__ = {'extend_existing': True}

    # Core chart fields
    title = Column(String(255), nullable=True)
    chart_type = Column(String(100), nullable=True)
    chart_library = Column(String(50), default='echarts')
    status = Column(String(50), default='pending')
    complexity_score = Column(Integer, default=5)
    data_source = Column(String(255), nullable=True)
    
    # Chat integration fields (from original chart table)
    form_data = Column(JSONB, nullable=True)
    result = Column(JSONB, nullable=True)
    datasource = Column(JSONB, nullable=True)
    message_id = Column(UUID, nullable=True)
    
    # User ownership
    user_id = Column(UUID(as_uuid=True), nullable=True)
    conversation_id = Column(UUID, *_conversation_fk, nullable=True)
    
    # Timestamps
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now())
    deleted_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    is_deleted = Column(Boolean, default=False)


class DashboardEmbed(BaseModel):
    """Persisted embed tokens for dashboards"""
    __tablename__ = "dashboard_embeds"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    dashboard_id = Column(UUID(as_uuid=True), ForeignKey("dashboards.id"), nullable=False)
    created_by = Column(UUID(as_uuid=True), nullable=True)
    embed_token = Column(String(255), nullable=False)
    options = Column(JSONB, nullable=True)
    expires_at = Column(DateTime, nullable=True)
    is_active = Column(Boolean, default=True)
    access_count = Column(Integer, default=0)
    created_at = Column(DateTime, server_default=func.now())
    updated_at = Column(DateTime, onupdate=func.now(), nullable=True)

    # Note: Dashboard model is in app.modules.dashboard.models (same Base registry),
    # so the string reference resolves correctly within this registry.
    dashboard = relationship("Dashboard", back_populates="embeds")


# Dashboard, DashboardWidget, DashboardShare live in app.modules.dashboard.models (single source of truth).
# This file contains ChartVisualization, DashboardEmbed, and plan limits.


# Plan-based feature restrictions
PLAN_LIMITS = {
    "free": {
        "max_dashboards": 3,
        "max_widgets_per_dashboard": 10,
        "max_pages_per_dashboard": 3,
        "max_shared_dashboards": 1,
        "export_formats": ["png"],
        "refresh_interval_min": 300,  # 5 minutes
        "data_retention_days": 7,
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
        "data_retention_days": 180,
        "collaboration": True,
        "custom_themes": True,
        "advanced_filters": True,
        "real_time_data": False,
        "priority_support": True
    },
    "team": {
        "max_dashboards": 100,
        "max_widgets_per_dashboard": 120,
        "max_pages_per_dashboard": 20,
        "max_shared_dashboards": 50,
        "export_formats": ["png", "pdf", "html", "excel"],
        "refresh_interval_min": 30,   # 30 seconds
        "data_retention_days": 365,
        "collaboration": True,
        "custom_themes": True,
        "advanced_filters": True,
        "real_time_data": True,
        "api_access": True,
        "webhooks": True,
        "team_governance": True,
        "priority_support": True,
        "dedicated_support": True
    },
    "enterprise": {
        "max_dashboards": -1,  # Unlimited
        "max_widgets_per_dashboard": -1,  # Unlimited
        "max_pages_per_dashboard": -1,    # Unlimited
        "max_shared_dashboards": -1,      # Unlimited
        "export_formats": ["png", "pdf", "html", "excel", "csv", "json"],
        "refresh_interval_min": 10,       # 10 seconds
        "data_retention_days": 730,
        "collaboration": True,
        "custom_themes": True,
        "advanced_filters": True,
        "real_time_data": True,
        "api_access": True,
        "webhooks": True,
        "sso": True,
        "audit_logs": True,
        "custom_branding": True,
        "priority_support": True,
        "white_label": True,
        "compliance": True,
        "dedicated_success": True
    }
}
