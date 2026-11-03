"""SQLAlchemy ORM model for Plug-in enablement state."""

from __future__ import annotations

import uuid

from sqlalchemy import Boolean, Column, DateTime, String, Text, UniqueConstraint, func
from sqlalchemy.dialects.postgresql import UUID

from src.db.base import Base


class PluginEnablement(Base):
    """Per-scope (org in EE, 'instance' in CE) enablement and encrypted config for a Plug-in."""

    __tablename__ = "plugin_enablements"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    scope_key = Column(String(128), nullable=False, index=True)
    plugin_id = Column(String(64), nullable=False, index=True)
    enabled = Column(Boolean, nullable=False, default=True)
    config_encrypted = Column(Text, nullable=True)
    updated_by_user_id = Column(String(64), nullable=True)
    created_at = Column(DateTime(timezone=True), server_default=func.now(), nullable=False)
    updated_at = Column(
        DateTime(timezone=True),
        server_default=func.now(),
        onupdate=func.now(),
        nullable=False,
    )

    __table_args__ = (
        UniqueConstraint("scope_key", "plugin_id", name="uq_plugin_enablement_scope_plugin"),
    )

