import uuid

from sqlalchemy import Boolean, Column, DateTime, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from src.db.base import Base, BaseModel


class Notebook(BaseModel):
    """A notebook. ``cells`` is an ordered list of {id, type, source, …, output?}; outputs are
    snapshots kept small (see schemas.MAX_OUTPUT_ROWS) so a notebook opens instantly."""

    __tablename__ = "notebooks"

    title = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    cells = Column(JSONB, nullable=False, server_default="[]")
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    organization_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    project_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    # private: only the owner; project: everyone who can run queries in the project (read-only
    # unless they may save queries there).
    visibility = Column(String(20), nullable=False, server_default="private")
    # The project folder it is filed in (src/modules/folders); unfiled when empty.
    folder_id = Column(UUID(as_uuid=True), ForeignKey("asset_folders.id", ondelete="SET NULL"), nullable=True, index=True)
    version = Column(Integer, nullable=False, server_default="1")

    __table_args__ = (Index("ix_notebooks_scope", "organization_id", "project_id", "visibility"),)


class NotebookVersion(Base):
    """A saved point in a notebook's history: its title and cells without outputs (code and
    settings, small). Saves by the same person within a few minutes update one point, so the
    history reads like sessions of work rather than every keystroke."""

    __tablename__ = "notebook_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notebook_id = Column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False)
    notebook_version = Column(Integer, nullable=False)
    title = Column(String(200), nullable=False)
    cells = Column(JSONB, nullable=False, server_default="[]")
    author_id = Column(UUID(as_uuid=True), nullable=False)
    reason = Column(String(20), nullable=False, server_default="save")  # created | save | restore | before_restore
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (Index("ix_notebook_versions_nb", "notebook_id", "updated_at"),)


class NotebookComment(Base):
    """A comment on a notebook or one of its cells; same thread model as dashboard comments
    (top-level threads with one level of replies, resolvable, soft-deleted)."""

    __tablename__ = "notebook_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    notebook_id = Column(UUID(as_uuid=True), ForeignKey("notebooks.id", ondelete="CASCADE"), nullable=False)
    cell_id = Column(String(40), nullable=True)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("notebook_comments.id", ondelete="CASCADE"), nullable=True)
    author_id = Column(UUID(as_uuid=True), nullable=False)
    author_name = Column(String(255), nullable=True)
    body = Column(Text, nullable=False)
    edited_at = Column(DateTime(timezone=True), nullable=True)
    resolved_at = Column(DateTime(timezone=True), nullable=True)
    resolved_by = Column(UUID(as_uuid=True), nullable=True)
    is_deleted = Column(Boolean, nullable=False, server_default=text("false"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())

    __table_args__ = (Index("ix_notebook_comments_nb", "notebook_id", "created_at"),)
