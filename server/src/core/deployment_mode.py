"""Deployment mode: SaaS (multi-org) vs self-host (single shared org)."""
from __future__ import annotations

import os
from typing import Literal

DeploymentMode = Literal["saas", "self_host"]


def get_deployment_mode() -> DeploymentMode:
    """
    Resolve deployment mode.

    - ``saas`` — hosted SaaS: users/orgs can be provisioned and approved; multi-org.
    - ``self_host`` — enterprise self-host (typical Keycloak): one deployment org, rename only.
    """
    explicit = os.getenv("AISER_DEPLOYMENT_MODE", "").strip().lower()
    if explicit in ("saas", "self_host"):
        return explicit  # type: ignore[return-value]

    # Legacy / dev values → infer from auth stack
    if explicit in ("development", "prod", "production", ""):
        keycloak = bool(os.getenv("KEYCLOAK_URL", "").strip())
        supabase = bool(os.getenv("SUPABASE_URL", "").strip())
        if keycloak and not supabase:
            return "self_host"
        if supabase:
            return "saas"

    return "self_host" if os.getenv("KEYCLOAK_URL", "").strip() else "saas"


def is_saas_deployment() -> bool:
    return get_deployment_mode() == "saas"


def is_self_host_deployment() -> bool:
    return get_deployment_mode() == "self_host"


def allows_multi_org() -> bool:
    return is_saas_deployment()


def default_org_name() -> str:
    return os.getenv("AISER_ORG_NAME", "Aiser").strip() or "Aiser"


def default_project_name() -> str:
    return os.getenv("AISER_DEFAULT_PROJECT_NAME", "My Project").strip() or "My Project"
