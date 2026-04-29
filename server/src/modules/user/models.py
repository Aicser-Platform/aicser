"""User domain SQLAlchemy models."""
from sqlalchemy import Column, String, DateTime, Text, Boolean, Enum
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.sql import text

from src.db.base import BaseModel


class User(BaseModel):
    """
    User model with extended profile information.
    Table: users

    Schema:
    - id : UUID (PK, from BaseModel)
    - user_id : UUID (indexed, from Supabase auth, unique)
    - username : varchar(100)
    - email : varchar(255)
    - first_name : varchar(100)
    - last_name : varchar(100)
    - phone_number : varchar(20)
    - company : varchar(255)
    - location : varchar(255)
    - timezone : varchar(50)
    - bio : textx
    - created_at : timestamp
    - updated_at : timestamp
    """
    __tablename__ = "users"

    user_id = Column(UUID(as_uuid=True), nullable=False, unique=True, index=True)
    username = Column(String(100), nullable=True, index=True)
    email = Column(String(255), nullable=True, index=True)
    first_name = Column(String(100), nullable=True)
    last_name = Column(String(100), nullable=True)
    role = Column(String(64), nullable=True, server_default=text("'user'"))
    status = Column(String(32), nullable=True, server_default=text("'active'"))
    tenant_id = Column(String(128), nullable=True, server_default=text("'default'"))
    onboarding_data = Column(JSONB, nullable=True)
    onboarding_progress = Column(JSONB, nullable=True)
    onboarding_started_at = Column(DateTime(timezone=True), nullable=True)
    onboarding_completed_at = Column(DateTime(timezone=True), nullable=True)
    phone_number = Column(String(20), nullable=True)
    company = Column(String(255), nullable=True)
    location = Column(String(255), nullable=True)
    timezone = Column(String(50), nullable=True)  # e.g., 'America/New_York', 'Asia/Phnom Penh'
    bio = Column(Text, nullable=True)
    avatar_url = Column(String(255), nullable=True)
    is_pro= Column(Boolean, nullable=True, server_default=text("false"))  ## this one is temporary fix and will remove out later

    # ── Onboarding profile fields (all nullable) ──────────────────────────
    # User's actual job title / role from onboarding (≠ system role above)
    job_role = Column(String(128), nullable=True)
    # Industry sector e.g. 'technology', 'finance', 'healthcare'
    industry = Column(String(100), nullable=True)
    # Headcount bucket e.g. '1-10', '11-50', '201-1000'
    company_size = Column(String(50), nullable=True)
    # Self-reported data analysis experience: 'beginner'|'intermediate'|'advanced'|'expert'
    data_experience = Column(String(50), nullable=True)
    # Primary use-case chosen during onboarding e.g. 'business_intelligence'
    primary_use_case = Column(String(100), nullable=True)
    # How often user works with data: 'daily'|'weekly'|'monthly'|'occasionally'
    data_frequency = Column(String(50), nullable=True)
    # Array of goal strings e.g. ["automate_reporting", "save_time"]
    goals = Column(JSONB, nullable=True)

    # Telegram Bot Integration fields
    telegram_chat_id = Column(String(50), nullable=True, unique=True, index=True)
    telegram_username = Column(String(100), nullable=True)
    telegram_status = Column(
        Enum("connected", "pending", "disconnected", name="telegram_status_enum"),
        nullable=True,
        default=None,
    )
    # Persisted bot session context (org/project/data-source/conversation selection).
    # Restored automatically when the bot restarts so users don't lose their setup.
    telegram_context = Column(JSONB, nullable=True)
