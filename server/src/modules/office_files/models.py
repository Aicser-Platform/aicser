from sqlalchemy import CheckConstraint, Column, DateTime, ForeignKey, Index, Integer, String, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from src.db.base import Base, BaseModel


class OfficeFile(BaseModel):
    """A Docs document or a Slides presentation. ``body`` is the editor's own JSON (TipTap content and
    page setup for a document; theme and slides for a presentation), read and written whole by the
    browser, which also converts to and from .docx / .pptx. ``meta`` holds small list details
    (word or slide count) so the list never loads bodies."""

    __tablename__ = "office_files"

    kind = Column(String(20), nullable=False)  # document | presentation
    title = Column(String(200), nullable=False)
    body = Column(JSONB, nullable=False, server_default="{}")
    meta = Column(JSONB, nullable=False, server_default="{}")
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    organization_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    project_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    # private: only the owner; project: everyone who can run queries in the project (read-only).
    visibility = Column(String(20), nullable=False, server_default="private")
    folder_id = Column(UUID(as_uuid=True), ForeignKey("asset_folders.id", ondelete="SET NULL"), nullable=True, index=True)
    version = Column(Integer, nullable=False, server_default="1")

    __table_args__ = (
        Index("ix_office_files_scope", "organization_id", "project_id", "kind", "visibility"),
        CheckConstraint("kind IN ('document', 'presentation')", name="ck_office_files_kind"),
    )


class OfficeFileShare(BaseModel):
    """Who else may open a document or presentation: one person (view or edit) or the file's link (view only,
    for signed-in members of the organization or for anyone). Every share waits for an organization owner or
    admin to approve it (status ``pending``) unless the person sharing is one of them."""

    __tablename__ = "office_file_shares"

    file_id = Column(UUID(as_uuid=True), ForeignKey("office_files.id", ondelete="CASCADE"), nullable=False, index=True)
    organization_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    target = Column(String(10), nullable=False)  # person | link
    # person: users.id of who it is shared with
    person_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    role = Column(String(10), nullable=False, server_default="view")  # view | edit (links: view)
    # link: random slug in the address, and who may open it
    slug = Column(String(24), nullable=True, unique=True, index=True)
    link_access = Column(String(16), nullable=True)  # organization | public
    status = Column(String(10), nullable=False, server_default="pending")  # pending | active | declined | off
    requested_by = Column(UUID(as_uuid=True), nullable=False)
    decided_by = Column(UUID(as_uuid=True), nullable=True)
    decided_at = Column(DateTime(timezone=True), nullable=True)
    note = Column(String(300), nullable=True)
    view_count = Column(Integer, nullable=False, server_default="0")

    __table_args__ = (
        Index("ix_office_file_shares_org_status", "organization_id", "status"),
        CheckConstraint("target IN ('person', 'link')", name="ck_office_file_shares_target"),
        CheckConstraint("role IN ('view', 'edit')", name="ck_office_file_shares_role"),
    )


class OfficeRemoteSession(Base):
    """A phone remote for one slide show: the phone opens a token-guarded page (no sign-in) and sends Previous /
    Next; the presenting browser polls for them and posts the current slide (number, title, notes) back. Only a
    hash of the token is kept, and the session ends with the slide show or after a few hours."""

    __tablename__ = "office_remote_sessions"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"))
    file_id = Column(UUID(as_uuid=True), ForeignKey("office_files.id", ondelete="CASCADE"), nullable=False, index=True)
    user_id = Column(UUID(as_uuid=True), nullable=False)
    token_hash = Column(String(64), nullable=False, unique=True, index=True)
    # {"index", "total", "title", "notes"}: what the phone shows
    state = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    # [{"seq", "action"}]: the latest phone presses, newest last
    commands = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    seq = Column(Integer, nullable=False, server_default="0")
    phone_seen_at = Column(DateTime(timezone=True), nullable=True)
    expires_at = Column(DateTime(timezone=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
