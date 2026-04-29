"""
Edition detection for Aicser runtime.

EE features (Keycloak SSO, audit logs, BI sync, catalog, lakehouse, dbt integration)
are only loaded and exposed when the platform is running as Enterprise Edition.

Set the edition via environment variable:
    AISER_EDITION=enterprise        # explicit edition flag
    AISER_EDITION_LICENSE_KEY=...   # presence of a license key also enables EE
"""

import os


def is_ee_enabled() -> bool:
    """Return True when the platform is running in Enterprise Edition mode."""
    edition = os.getenv("AISER_EDITION", "community").strip().lower()
    if edition in ("enterprise", "ee"):
        return True
    if os.getenv("AISER_EDITION_LICENSE_KEY", "").strip():
        return True
    return False
