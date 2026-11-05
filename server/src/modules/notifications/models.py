"""A browser or phone that asked for push notifications."""

from sqlalchemy import Column, String, Text
from sqlalchemy.dialects.postgresql import UUID

from src.db.base import BaseModel


class PushSubscription(BaseModel):
    __tablename__ = "push_subscriptions"

    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    # The address the browser vendor gave this device; unique per device and browser.
    endpoint = Column(Text, nullable=False, unique=True)
    p256dh = Column(String(200), nullable=False)
    auth = Column(String(100), nullable=False)
