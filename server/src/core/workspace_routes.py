"""Register org/project/RBAC API routes when EE workspace modules are on disk (CE self-host dev)."""
from __future__ import annotations

import importlib
import logging

from fastapi import APIRouter

logger = logging.getLogger(__name__)


def include_workspace_routes(api_router: APIRouter) -> None:
    """Load RBAC, organizations, and projects routers if ``server/ee/`` is present."""
    for import_path, router_attr, prefix, tag in (
        ("ee.modules.authentication.rbac.router", "router", "/api/rbac", "RBAC"),
        ("ee.modules.organizations.router", "router", "/api/organizations", "organizations"),
        ("ee.modules.project.router", "router", "/api/projects", "projects"),
    ):
        try:
            mod = importlib.import_module(import_path)
            api_router.include_router(getattr(mod, router_attr), prefix=prefix, tags=[tag])
        except Exception as err:
            logger.warning("%s router not loaded: %s", tag, err)
