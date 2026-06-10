# AISER EE-ONLY — requires AISER_EDITION=enterprise
# Canonical EE boundary file: keycloak_service.ee.py
"""
Keycloak OIDC Integration Service.

Provides:
- Token verification via Keycloak JWKS endpoint
- User/role mapping from Keycloak claims to Aiser RBAC
- SAML/LDAP (handled by Keycloak itself - Aiser talks only OIDC)
- SCIM-style user provisioning hook

Environment variables:
    KEYCLOAK_URL          - e.g. http://keycloak:8080
    KEYCLOAK_REALM        - e.g. aiser (default: aiser)
    KEYCLOAK_CLIENT_ID    - e.g. aiser-backend
    KEYCLOAK_CLIENT_SECRET - (optional, for client_credentials flow)
"""
import os
import time
import logging
from typing import Optional, Dict, Any

import httpx

logger = logging.getLogger(__name__)

KEYCLOAK_URL = os.getenv("KEYCLOAK_URL", "") or os.getenv("KEYCLOAK_SERVER_URL", "")
KEYCLOAK_REALM = os.getenv("KEYCLOAK_REALM", "aiser")
KEYCLOAK_CLIENT_ID = os.getenv("KEYCLOAK_CLIENT_ID", "aiser-backend")
KEYCLOAK_CLIENT_SECRET = os.getenv("KEYCLOAK_CLIENT_SECRET", "")

_JWKS_CACHE: Optional[Dict] = None
_JWKS_CACHE_TIME: float = 0
JWKS_TTL = 3600  # 1 hour


def is_keycloak_enabled() -> bool:
    """Check if Keycloak is configured."""
    return bool(KEYCLOAK_URL and KEYCLOAK_URL.strip())


def get_keycloak_issuer() -> str:
    return f"{KEYCLOAK_URL}/realms/{KEYCLOAK_REALM}"


def get_jwks_url() -> str:
    return f"{get_keycloak_issuer()}/protocol/openid-connect/certs"


async def get_jwks() -> Optional[Dict]:
    """Fetch and cache Keycloak JWKS."""
    global _JWKS_CACHE, _JWKS_CACHE_TIME

    now = time.time()
    if _JWKS_CACHE and (now - _JWKS_CACHE_TIME) < JWKS_TTL:
        return _JWKS_CACHE

    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(get_jwks_url())
            resp.raise_for_status()
            jwks = resp.json()
            _JWKS_CACHE = jwks
            _JWKS_CACHE_TIME = now
            return jwks
    except Exception as e:
        logger.warning(f"Failed to fetch Keycloak JWKS: {e}")
        return _JWKS_CACHE  # Return stale cache on failure


def _normalize_keycloak_claims(claims: Dict[str, Any]) -> Dict[str, Any]:
    user_id = claims.get("sub", "")
    email = claims.get("email", "")
    preferred_username = claims.get("preferred_username", "")
    realm_roles = claims.get("realm_access", {}).get("roles", [])
    resource_roles = claims.get("resource_access", {}).get(KEYCLOAK_CLIENT_ID, {}).get("roles", [])
    all_roles = list(set(realm_roles + resource_roles))

    aiser_role = "viewer"
    if "aiser-admin" in all_roles or "realm-management" in realm_roles:
        aiser_role = "admin"
    elif "aiser-editor" in all_roles or "aiser-analyst" in all_roles:
        aiser_role = "editor"

    return {
        "id": user_id,
        "user_id": user_id,
        "sub": user_id,
        "email": email,
        "username": preferred_username,
        "role": aiser_role,
        "keycloak_roles": all_roles,
        "organization_id": claims.get("organization_id") or claims.get("org_id"),
        "auth_provider": "keycloak",
    }


def verify_keycloak_token_sync(token: str) -> Optional[Dict[str, Any]]:
    """Verify a Keycloak JWT (sync — for auth_bearer and other sync call sites)."""
    if not is_keycloak_enabled():
        return None

    try:
        import jwt as _jwt
        from jwt import PyJWKClient

        header = _jwt.get_unverified_header(token)
        kid = header.get("kid")
        if not kid:
            return None

        jwks_client = PyJWKClient(get_jwks_url())
        key = jwks_client.get_signing_key(kid).key
        claims = _jwt.decode(
            token,
            key,
            algorithms=["RS256", "ES256"],
            issuer=get_keycloak_issuer(),
            options={"verify_aud": False},
        )
        return _normalize_keycloak_claims(claims)
    except Exception as e:
        logger.debug("Keycloak token verification failed: %s", e)
        return None


async def verify_keycloak_token(token: str) -> Optional[Dict[str, Any]]:
    """
    Verify a Keycloak JWT token and return claims.

    Returns normalized user dict or None if invalid.
    """
    return verify_keycloak_token_sync(token)


async def get_keycloak_user_info(token: str) -> Optional[Dict[str, Any]]:
    """
    Call Keycloak userinfo endpoint to get current user info.
    Useful for SCIM provisioning or checking fresh state.
    """
    if not is_keycloak_enabled():
        return None
    try:
        userinfo_url = f"{get_keycloak_issuer()}/protocol/openid-connect/userinfo"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(
                userinfo_url,
                headers={"Authorization": f"Bearer {token}"},
            )
            if resp.status_code == 200:
                return resp.json()
        return None
    except Exception as e:
        logger.warning(f"Keycloak userinfo call failed: {e}")
        return None


async def get_admin_token() -> Optional[str]:
    """
    Get a Keycloak admin access token via client_credentials grant.
    Used for SCIM-style user management APIs.
    """
    if not is_keycloak_enabled() or not KEYCLOAK_CLIENT_SECRET:
        return None
    try:
        token_url = f"{get_keycloak_issuer()}/protocol/openid-connect/token"
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.post(token_url, data={
                "grant_type": "client_credentials",
                "client_id": KEYCLOAK_CLIENT_ID,
                "client_secret": KEYCLOAK_CLIENT_SECRET,
            })
            if resp.status_code == 200:
                return resp.json().get("access_token")
        return None
    except Exception as e:
        logger.warning(f"Keycloak admin token failed: {e}")
        return None


async def provision_user(
    user_id: str,
    email: str,
    username: str,
    first_name: str = "",
    last_name: str = "",
    roles: Optional[list] = None,
) -> Dict[str, Any]:
    """
    Create/update a user in Keycloak via Admin REST API.
    Used for SCIM provisioning and SSO-initiated user creation.
    """
    if not is_keycloak_enabled():
        return {"success": False, "error": "Keycloak not configured"}

    admin_token = await get_admin_token()
    if not admin_token:
        return {"success": False, "error": "Could not obtain admin token"}

    try:
        admin_url = f"{KEYCLOAK_URL}/admin/realms/{KEYCLOAK_REALM}/users"
        user_data = {
            "username": username,
            "email": email,
            "firstName": first_name,
            "lastName": last_name,
            "enabled": True,
            "attributes": {"aiser_user_id": [user_id]},
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.post(
                admin_url,
                json=user_data,
                headers={"Authorization": f"Bearer {admin_token}"},
            )
            if resp.status_code in (201, 409):  # 409 = already exists
                return {"success": True, "keycloak_status": resp.status_code}
            return {"success": False, "error": f"Keycloak returned {resp.status_code}: {resp.text[:200]}"}
    except Exception as e:
        logger.error(f"Keycloak user provisioning failed: {e}")
        return {"success": False, "error": str(e)}
