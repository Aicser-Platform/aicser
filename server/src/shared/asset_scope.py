"""Which project assets a list shows: the current project's, plus those shared with the whole
organization (visibility == 'organization'). Used by assets that carry organization_id,
project_id and visibility columns (e.g. Enterprise models and AI decisions)."""

from __future__ import annotations

import uuid
from typing import Any, Optional, Union

from sqlalchemy import and_, or_

PROJECT = "project"
ORGANIZATION = "organization"
VISIBILITIES = (PROJECT, ORGANIZATION)


Id = Optional[Union[str, uuid.UUID]]


def _id(v: Id) -> Optional[uuid.UUID]:
    if not v:
        return None
    try:
        return v if isinstance(v, uuid.UUID) else uuid.UUID(str(v))
    except ValueError:
        return None


def visible_in_project(model: Any, organization_id: Id, project_id: Id):
    """SQL filter: same organization, and in this project or shared organization-wide.
    Without a current project, items saved without one (and shared ones) show."""
    organization_id, project_id = _id(organization_id), _id(project_id)
    same_org = model.organization_id == organization_id if organization_id else model.organization_id.is_(None)
    here = model.project_id == project_id if project_id else model.project_id.is_(None)
    return and_(same_org, or_(here, model.visibility == ORGANIZATION))
