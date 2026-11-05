"""One short link per chart or dashboard, for people to send and sites to embed."""

from sqlalchemy import Boolean, Column, DateTime, Integer, String, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from src.db.base import BaseModel


class ShareLink(BaseModel):
    __tablename__ = "share_links"

    slug = Column(String(16), nullable=False, unique=True, index=True)
    kind = Column(String(16), nullable=False)  # chart | dashboard
    resource_id = Column(UUID(as_uuid=True), nullable=False)
    organization_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    created_by = Column(UUID(as_uuid=True), nullable=False)
    title = Column(String(300), nullable=True)
    access = Column(String(16), nullable=False, server_default=text("'organization'"))  # organization | public
    status = Column(String(16), nullable=False, server_default=text("'active'"))  # active | pending | off
    live_data = Column(Boolean, nullable=False, server_default=text("false"))
    expires_at = Column(DateTime(timezone=True), nullable=True)
    password_hash = Column(String(200), nullable=True)
    allowed_domains = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    view_count = Column(Integer, nullable=False, server_default=text("0"))
    last_viewed_at = Column(DateTime(timezone=True), nullable=True)
    snapshot = Column(JSONB, nullable=True)
    snapshot_at = Column(DateTime(timezone=True), nullable=True)
    reminded_at = Column(DateTime(timezone=True), nullable=True)

    __table_args__ = (UniqueConstraint("kind", "resource_id", name="uq_share_link_resource"), {"extend_existing": True})
