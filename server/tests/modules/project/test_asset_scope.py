"""Models and AI decisions: the current project's, plus those shared with the whole organization."""

import uuid

from sqlalchemy import Column, String
from sqlalchemy.dialects import postgresql
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import declarative_base

from src.shared.asset_scope import visible_in_project

Base = declarative_base()


class Asset(Base):
    __tablename__ = "assets"
    id = Column(UUID(as_uuid=True), primary_key=True)
    organization_id = Column(UUID(as_uuid=True))
    project_id = Column(UUID(as_uuid=True))
    visibility = Column(String(20))


ORG, PROJ = uuid.uuid4(), uuid.uuid4()


def _sql(clause) -> str:
    text = str(clause.compile(dialect=postgresql.dialect(), compile_kwargs={"literal_binds": True}))
    return " ".join(text.split()).lower()


def test_this_project_or_shared_with_the_organization():
    sql = _sql(visible_in_project(Asset, str(ORG), str(PROJ)))
    assert f"assets.organization_id = '{ORG}'" in sql
    assert f"(assets.project_id = '{PROJ}' or assets.visibility = 'organization')" in sql


def test_without_a_project_shows_unfiled_and_shared():
    sql = _sql(visible_in_project(Asset, ORG, None))
    assert "(assets.project_id is null or assets.visibility = 'organization')" in sql


def test_a_malformed_id_scopes_to_nothing_rather_than_everything():
    sql = _sql(visible_in_project(Asset, "not-a-uuid", "also-bad"))
    assert "assets.organization_id is null" in sql and "assets.project_id is null" in sql
