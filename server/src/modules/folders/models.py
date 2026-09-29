"""One folder tree per project, holding every kind of asset (charts, dashboards, saved queries,
notebooks, sheets, models, AI decisions), the way Metabase collections and Databricks
workspace folders do. Assets point at a folder with their own ``collection_id`` (charts,
dashboards) or ``folder_id`` column; deleting a folder unfiles its assets and lifts its
subfolders to the top (ON DELETE SET NULL), it never deletes work."""

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, Text, func, text
from sqlalchemy.dialects.postgresql import UUID

from src.db.base import Base


class AssetFolder(Base):
    __tablename__ = "asset_folders"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=func.gen_random_uuid(), index=True)
    name = Column(Text, nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("asset_folders.id", ondelete="SET NULL"), nullable=True, index=True)
    organization_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    project_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    # Who made it; without a project a folder is that person's own.
    user_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    sort_order = Column(Integer, nullable=False, server_default=text("0"))
    created_at = Column(DateTime(timezone=True), server_default=func.now())
    updated_at = Column(DateTime(timezone=True), server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index("ix_asset_folders_scope", "organization_id", "project_id", "parent_id"),)
