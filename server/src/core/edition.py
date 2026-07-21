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


def get_auth_provider() -> str:
    """Return the configured form-auth provider: 'local' (default) or 'supabase'.

    Mirrors the client's NEXT_PUBLIC_AUTH_PROVIDER — always set both to the same
    value so client and server agree on how users sign in via the email/password form.

    NOTE: 'keycloak' is NOT a valid form-auth provider. Keycloak is an SSO-only
    integration controlled by NEXT_PUBLIC_SSO_PROVIDER on the frontend and
    the /api/auth/token-exchange endpoint on the backend. Setting AUTH_PROVIDER=keycloak
    is a misconfiguration; this function will log a warning and fall back to 'local'.
    """
    import logging
    provider = os.getenv("AUTH_PROVIDER", "local").strip().lower()
    if provider == "supbase":
        logging.getLogger(__name__).warning(
            "[Auth] AUTH_PROVIDER=supbase looks like a typo. Treating it as 'supabase'."
        )
        provider = "supabase"
    if provider == "keycloak":
        logging.getLogger(__name__).warning(
            "[Auth] AUTH_PROVIDER=keycloak is not supported as a form-auth provider. "
            "Keycloak is an SSO-only integration — use NEXT_PUBLIC_SSO_PROVIDER=keycloak "
            "on the frontend instead. Falling back to 'local'."
        )
        return "local"
    return provider
