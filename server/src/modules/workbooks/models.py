import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, LargeBinary, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from src.db.base import Base, BaseModel


class Workbook(BaseModel):
    """A spreadsheet. ``doc`` is the IronCalc workbook in its binary format (cells, formulas,
    styles, sheets); ``ranges`` are the live data ranges written into it (where, from which
    query, when last refreshed) so they can be refreshed as the viewer."""

    __tablename__ = "workbooks"

    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    doc = Column(LargeBinary, nullable=False)
    doc_size = Column(Integer, nullable=False, server_default="0")
    ranges = Column(JSONB, nullable=False, server_default="[]")
    locale = Column(String(16), nullable=False, server_default="en")
    timezone = Column(String(64), nullable=False, server_default="UTC")
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    organization_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    project_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    # private: only the owner; project: everyone who can run queries in the project (read-only).
    visibility = Column(String(20), nullable=False, server_default="private")
    # The project folder it is filed in (src/modules/folders); unfiled when empty.
    folder_id = Column(UUID(as_uuid=True), ForeignKey("asset_folders.id", ondelete="SET NULL"), nullable=True, index=True)
    version = Column(Integer, nullable=False, server_default="1")

    __table_args__ = (Index("ix_workbooks_scope", "organization_id", "project_id", "visibility"),)


class WorkbookVersion(Base):
    """A saved point in a workbook's history (the whole document; same session rules as
    notebook history)."""

    __tablename__ = "workbook_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workbook_id = Column(UUID(as_uuid=True), ForeignKey("workbooks.id", ondelete="CASCADE"), nullable=False)
    workbook_version = Column(Integer, nullable=False)
    title = Column(String(200), nullable=False)
    doc = Column(LargeBinary, nullable=False)
    ranges = Column(JSONB, nullable=False, server_default="[]")
    author_id = Column(UUID(as_uuid=True), nullable=False)
    reason = Column(String(20), nullable=False, server_default="save")  # created | save | restore | before_restore | import
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (Index("ix_workbook_versions_wb", "workbook_id", "updated_at"),)


class WorkbookComment(Base):
    """A comment on a workbook or a cell ("Sheet1!B4"); rules in src/shared/comment_threads.py."""

    __tablename__ = "workbook_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    workbook_id = Column(UUID(as_uuid=True), ForeignKey("workbooks.id", ondelete="CASCADE"), nullable=False)
    cell_ref = Column(String(80), nullable=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("workbook_comments.id", ondelete="CASCADE"), nullable=True)
    author_id = Column(UUID(as_uuid=True), nullable=False)
    author_name = Column(String(255), nullable=True)
    body = Column(Text, nullable=False)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(UUID(as_uuid=True), nullable=True)
    is_deleted = Column(Boolean, nullable=False, server_default=text("false"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index("ix_workbook_comments_wb", "workbook_id", "created_at"),)
