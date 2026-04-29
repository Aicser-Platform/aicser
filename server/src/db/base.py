"""
Database Base and BaseModel definitions
"""
from sqlalchemy import Boolean, Column, DateTime
from sqlalchemy.ext.declarative import declarative_base
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.sql import func, text

Base = declarative_base()


class BaseModel(Base):
    """
    Abstract base model that provides common fields for all database models.
    
    Default configuration matches the conversation table schema:
    - UUID id with auto-generation
    - Nullable timestamps with server defaults
    - Nullable boolean flags with server defaults
    """

    __abstract__ = True

    # Primary key: UUID with auto-generation
    id = Column(
        UUID(as_uuid=True),
        primary_key=True,
        index=True,
        server_default=text('gen_random_uuid()'),
        doc="Primary key identifier (UUID type)",
    )

    # Timestamps: nullable with server defaults (TIMESTAMP WITHOUT TIME ZONE)
    created_at = Column(
        DateTime(timezone=True),
        nullable=True,
        server_default=func.current_timestamp(),
        doc="Timestamp when the record was created",
    )

    updated_at = Column(
        DateTime(timezone=True),
        nullable=True,
        server_default=func.current_timestamp(),
        onupdate=func.current_timestamp(),
        doc="Timestamp when the record was last updated",
    )

    deleted_at = Column(
        DateTime(timezone=True),
        nullable=True,
        doc="Timestamp when the record was deleted",
    )

    # Status flags: nullable with server defaults
    is_active = Column(
        Boolean,
        nullable=True,
        server_default=text("true"),
        doc="Flag indicating if the record is active",
    )

    is_deleted = Column(
        Boolean,
        nullable=True,
        server_default=text("false"),
        doc="Soft delete flag",
    )

    def __str__(self):
        """Return string representation of the model."""
        return str(self.id)


