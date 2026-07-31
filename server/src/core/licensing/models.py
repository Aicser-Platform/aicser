"""SQLAlchemy model for licensing/state.py's durable backing store.

One row per running instance — persists the instance_id (generated once, on
first activation) and the last-known-good entitlement token so a container
restart doesn't lose activation state.
"""
from sqlalchemy import Boolean, Column, DateTime, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB

from src.db.base import BaseModel


class LicenseStateRecord(BaseModel):
    __tablename__ = "license_state"

    instance_id = Column(String(64), unique=True, nullable=False, index=True)
    license_id = Column(String(64), nullable=True)
    entitlement_token = Column(Text, nullable=True)
    is_valid = Column(Boolean, nullable=False, server_default="false")
    customer_id = Column(String(64), nullable=True)
    max_users = Column(Integer, nullable=True)
    features = Column(JSONB, nullable=False, server_default="[]")
    expires_at = Column(DateTime(timezone=True), nullable=True)
    last_validated_at = Column(DateTime(timezone=True), nullable=True)
    last_error = Column(Text, nullable=True)
