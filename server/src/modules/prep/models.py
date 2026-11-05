"""Prepare: reusable data-preparation recipes (an ordered list of steps over one source table)."""

import uuid

from sqlalchemy import Column, DateTime, ForeignKey, Index, Integer, String, Text, func, text
from sqlalchemy.dialects.postgresql import JSONB, UUID

from src.db.base import Base, BaseModel


class PrepRecipe(BaseModel):
    """Steps that clean and reshape one table. The same recipe runs as a live view, is saved as
    a table, or is used by a scheduled pipeline; ``steps`` is the engine's own format."""

    __tablename__ = "prep_recipes"

    name = Column(String(200), nullable=False)
    description = Column(Text, nullable=True)
    user_id = Column(UUID(as_uuid=True), nullable=False, index=True)
    organization_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    project_id = Column(UUID(as_uuid=True), nullable=True, index=True)
    data_source_id = Column(String, ForeignKey("data_sources.id", ondelete="CASCADE"), nullable=False, index=True)
    source_table = Column(String(255), nullable=True)
    steps = Column(JSONB, nullable=False, server_default=text("'[]'::jsonb"))
    # draft: being edited; published: a version others (and pipelines) can rely on.
    status = Column(String(20), nullable=False, server_default="draft")
    version = Column(Integer, nullable=False, server_default="0")
    # Where the result goes: {"mode": "view" | "table", "data_source_id": ..., "rows": ..., "ran_at": ...}
    output = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    # What each output column means, set in Prepare: {"amount": {"description", "role", "personal"}}.
    column_meta = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))
    # The CLEAN panel: review decisions on issues no step fixes, and notes on the dataset
    cleaning = Column(JSONB, nullable=False, server_default=text("'{}'::jsonb"))

    __table_args__ = (Index("ix_prep_recipes_scope", "organization_id", "project_id"),)


class PrepRecipeVersion(Base):
    """A published version of a recipe; restoring one copies its steps back into the draft."""

    __tablename__ = "prep_recipe_versions"

    id = Column(UUID(as_uuid=True), primary_key=True, default=uuid.uuid4)
    recipe_id = Column(UUID(as_uuid=True), ForeignKey("prep_recipes.id", ondelete="CASCADE"), nullable=False)
    version = Column(Integer, nullable=False)
    steps = Column(JSONB, nullable=False)
    source_table = Column(String(255), nullable=True)
    note = Column(Text, nullable=True)
    author_id = Column(UUID(as_uuid=True), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (Index("ix_prep_recipe_versions_recipe", "recipe_id", "version", unique=True),)
