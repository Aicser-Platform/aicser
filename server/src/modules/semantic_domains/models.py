"""Business domains: how an organization groups its semantic models (Sales, Finance, HR…).

A domain owns the sources whose metrics and dimensions it certifies. One domain per
organization may be the Core model: the shared dimensions (Date, Legal entity, Customer…)
every other domain reuses so the same word means the same thing everywhere.
"""

import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, String, Text, UniqueConstraint, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from src.db.base import Base


class SemanticDomain(Base):
    __tablename__ = "semantic_domains"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    organization_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    name = Column(String(120), nullable=False)
    description = Column(Text, nullable=True)
    is_core = Column(Boolean, nullable=False, server_default=text("false"))
    owner_id = Column(UUID(as_uuid=True), nullable=True)
    # People who review and certify the domain's metrics.
    steward_ids = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    # Core domain only: the organization calendar, {"fiscal_year_start_month": 1-12, "week_start": "monday"|"sunday"}.
    calendar = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    created_by = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (UniqueConstraint("organization_id", "name", name="uq_semantic_domain_org_name"),)


class SemanticDomainSource(Base):
    """A source whose model belongs to a domain. A source can serve more than one domain."""

    __tablename__ = "semantic_domain_sources"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    domain_id = Column(UUID(as_uuid=True), ForeignKey("semantic_domains.id", ondelete="CASCADE"), nullable=False)
    data_source_id = Column(String, ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False)
    added_by = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("domain_id", "data_source_id", name="uq_semantic_domain_source"),
        Index("ix_semantic_domain_sources_source", "data_source_id"),
    )
