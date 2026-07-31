"""System-level runtime settings stored as encrypted JSON."""

from sqlalchemy import Column, String, Text, UniqueConstraint
from sqlalchemy.dialects.postgresql import JSONB, UUID

from src.db.base import BaseModel


class SystemSetting(BaseModel):
    """Global key/value settings for deployment-level configuration."""

    __tablename__ = "system_settings"
    __table_args__ = (
        UniqueConstraint("key", name="uq_system_settings_key"),
    )

    key = Column(String(128), nullable=False, index=True)
    value = Column(JSONB, nullable=False)
    description = Column(Text, nullable=True)
    updated_by_user_id = Column(UUID(as_uuid=True), nullable=True)

