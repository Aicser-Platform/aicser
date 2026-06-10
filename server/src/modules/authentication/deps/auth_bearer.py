"""
Authentication dependencies with Supabase JWT token verification
"""

import typing as t
from fastapi import Depends, HTTPException, Request, status
from fastapi.security import HTTPAuthorizationCredentials, HTTPBearer
from pydantic import BaseModel
import logging
from jose import jwt as jose_jwt
from jose.exceptions import JWTError, ExpiredSignatureError
from jose.utils import base64url_decode
import os
import time
import requests
import json
from typing import Dict, Optional
from cryptography.hazmat.primitives import serialization
from cryptography.hazmat.primitives.asymmetric import rsa
from cryptography.hazmat.backends import default_backend

logger = logging.getLogger(__name__)

# JWKS cache
_jwks_cache: Optional[Dict] = None
_jwks_cache_time: float = 0
JWKS_CACHE_TTL = 24 * 60 * 60  # 24 hours

# Throttle auth fallback logs (once per 5 minutes) to avoid spamming in Docker
_auth_fallback_log_time: list = [0.0]
AUTH_FALLBACK_LOG_INTERVAL = 300.0  # seconds


async def get_current_user(request: Request) -> dict:
    """Resolve CE session JWT from Authorization Bearer or auth_token cookie."""
    from src.modules.authentication.service import decode_access_token
    from jose import JWTError

    token = None
    auth_h = request.headers.get("Authorization") or request.headers.get("authorization") or ""
    ah = auth_h.strip()
    if ah.lower().startswith("bearer "):
        parts = ah.split(None, 1)
        if len(parts) > 1:
            cand = parts[1].strip()
            if cand and cand != "null":
                token = cand
    if not token:
        token = request.cookies.get("auth_token")
    if not token:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Not authenticated",
        )
    try:
        payload = decode_access_token(token)
        return payload
    except JWTError:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or expired session. Please log in again.",
        )


CurrentUserDep = Depends(get_current_user)


def fetch_jwks(supabase_url: str) -> Dict:
    """Fetch JWKS from Supabase and cache it (synchronous)."""
    global _jwks_cache, _jwks_cache_time
    
    # Return cached JWKS if still valid
    current_time = time.time()
    if _jwks_cache and (current_time - _jwks_cache_time) < JWKS_CACHE_TTL:
        return _jwks_cache
    
    try:
        # Construct JWKS URL
        # Supabase URL format: https://<project-id>.supabase.co
        jwks_url = f"{supabase_url}/auth/v1/.well-known/jwks.json"
        
        response = requests.get(jwks_url, timeout=10.0)
        response.raise_for_status()
        jwks = response.json()
        
        # Cache the JWKS
        _jwks_cache = jwks
        _jwks_cache_time = current_time
        
        return jwks
    except Exception as e:
        logger.error(f"Failed to fetch JWKS: {e}")
        # Return cached JWKS if available, even if expired
        if _jwks_cache:
            logger.warning("Using expired JWKS cache due to fetch failure")
            return _jwks_cache
        raise


def get_public_key_from_jwks(jwks: Dict, kid: str) -> Optional[str]:
    """Extract RSA public key from JWKS for the given key ID and return as PEM string."""
    try:
        keys = jwks.get('keys', [])
        for key in keys:
            if key.get('kid') == kid and key.get('kty') == 'RSA':
                # Convert JWK to RSA public key
                n = base64url_decode(key['n'].encode())
                e = base64url_decode(key['e'].encode())
                
                # Create RSA public key
                public_numbers = rsa.RSAPublicNumbers(
                    int.from_bytes(e, 'big'),
                    int.from_bytes(n, 'big')
                )
                public_key = public_numbers.public_key(default_backend())
                
                # Convert to PEM format for jose
                pem_public_key = public_key.public_bytes(
                    encoding=serialization.Encoding.PEM,
                    format=serialization.PublicFormat.SubjectPublicKeyInfo
                )
                return pem_public_key.decode('utf-8')
        return None
    except Exception as e:
        logger.error(f"Error extracting public key from JWKS: {e}")
        return None

get_bearer_token = HTTPBearer(auto_error=False)


def _should_try_supabase_jwks(token: str, supabase_url: str) -> bool:
    """Skip Supabase JWKS for Keycloak-issued tokens when Keycloak SSO is enabled."""
    if not supabase_url:
        return False
    try:
        from src.modules.authentication.keycloak_service import get_keycloak_issuer, is_keycloak_enabled

        if not is_keycloak_enabled():
            return True
        claims = jose_jwt.get_unverified_claims(token)
        iss = str(claims.get("iss") or "")
        if supabase_url.rstrip("/") in iss:
            return True
        if iss.startswith(get_keycloak_issuer()):
            return False
        return False
    except Exception:
        try:
            from src.modules.authentication.keycloak_service import is_keycloak_enabled

            return not is_keycloak_enabled()
        except Exception:
            return True


known_tokens = set(["api_token_abc123"])


class UnauthorizedMessage(BaseModel):
    detail: str = "Bearer token missing or unknown"


async def get_token(
    auth: t.Optional[HTTPAuthorizationCredentials] = Depends(get_bearer_token),
) -> str:
    # Simulate a database query to find a known token
    if auth is None or (token := auth.credentials) not in known_tokens:
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail=UnauthorizedMessage().detail,
        )
    return token


def verify_supabase_token(token: str) -> dict:
    """
    Verify JWT token. Tries in order:
    1. Keycloak OIDC (if KEYCLOAK_URL is set)
    2. HS256 with JWT_SECRET (Supabase Docker mode / CE session)
    3. JWKS RS256 (Supabase production — skipped for Keycloak issuers)
    4. Unverified claims (development only)
    """
    try:
        from src.core.config import settings

        # 1. Keycloak OIDC (sync path — used by extract_user_id_from_token)
        try:
            from src.modules.authentication.keycloak_service import (
                is_keycloak_enabled,
                verify_keycloak_token_sync,
            )

            if is_keycloak_enabled():
                kc_result = verify_keycloak_token_sync(token)
                if kc_result and kc_result.get("id"):
                    return kc_result
        except Exception:
            pass

        jwt_secret = getattr(settings, "JWT_SECRET", None) or ""
        jwt_secret_ok = jwt_secret and jwt_secret.strip() and jwt_secret != "your-jwt-secret-here"

        # 2. HS256 when JWT_SECRET is set — Supabase Docker / shared secret tokens
        if jwt_secret_ok:
            try:
                claims = jose_jwt.decode(
                    token,
                    jwt_secret,
                    algorithms=["HS256"],
                    audience="authenticated",
                    options={
                        "verify_signature": True,
                        "verify_exp": True,
                        "verify_iat": True,
                    },
                )
                if isinstance(claims, dict):
                    user_id = claims.get("sub") or claims.get("id") or claims.get("user_id")
                    if user_id:
                        logger.debug("HS256 verification successful")
                        return {
                            "id": str(user_id),
                            "user_id": str(user_id),
                            "sub": str(user_id),
                            "email": claims.get("email"),
                            "email_verified": claims.get("email_verified", False),
                        }
            except ExpiredSignatureError:
                logger.warning("Token has expired (HS256)")
            except JWTError:
                pass  # Fall through to JWKS or unverified

        # 3. Supabase JWKS (RS256) — not for Keycloak-issued tokens
        supabase_url = getattr(settings, "SUPABASE_URL", None) or ""
        if supabase_url and _should_try_supabase_jwks(token, supabase_url):
            try:
                import jwt
                from jwt import PyJWKClient

                header = jwt.get_unverified_header(token)
                kid = header.get("kid")
                if not kid:
                    raise jwt.InvalidTokenError("JWT header missing kid")

                jwks_url = f"{supabase_url}/auth/v1/.well-known/jwks.json"
                jwks_client = PyJWKClient(jwks_url)
                key = jwks_client.get_signing_key(kid).key
                claims = jwt.decode(
                    token,
                    key,
                    algorithms=["RS256", "ES256"],
                    audience="authenticated",
                    options={
                        "verify_signature": True,
                        "verify_exp": True,
                        "verify_iat": True,
                    },
                )
                if isinstance(claims, dict):
                    user_id = claims.get("sub")
                    if user_id:
                        return {
                            "id": str(user_id),
                            "user_id": str(user_id),
                            "sub": str(user_id),
                            "email": claims.get("email"),
                            "email_verified": claims.get("email_verified", False),
                            "aud": claims.get("aud"),
                            "role": claims.get("role", "authenticated"),
                        }
            except jwt.ExpiredSignatureError:
                logger.warning("Supabase token has expired")
            except (jwt.InvalidTokenError, Exception) as e:
                if time.time() - _auth_fallback_log_time[0] > AUTH_FALLBACK_LOG_INTERVAL:
                    _auth_fallback_log_time[0] = time.time()
                    logger.warning("Supabase JWKS verification failed: %s", e)

        # 4. Final fallback: unverified claims in development
        if getattr(settings, "ENVIRONMENT", "development") in ("development", "dev", "local", "test"):
            if time.time() - _auth_fallback_log_time[0] > AUTH_FALLBACK_LOG_INTERVAL:
                _auth_fallback_log_time[0] = time.time()
                logger.warning(
                    "Using unverified claims (development mode). Set JWT_SECRET from Supabase Dashboard → API → JWT Secret to enable verification."
                )
            claims = jose_jwt.get_unverified_claims(token)
            if isinstance(claims, dict):
                user_id = claims.get('sub') or claims.get('id') or claims.get('user_id')
                if user_id:
                    return {
                        'id': str(user_id),
                        'user_id': str(user_id),
                        'sub': str(user_id),
                        'email': claims.get('email'),
                    }
        
        return {}
            
    except Exception as e:
        logger.error(f"Error verifying Supabase token: {e}")
        return {}


def extract_user_id_from_token(token: str) -> dict:
    """Extract user ID from token with Supabase verification.
    
    First tries to verify as Supabase token, then falls back to unverified claims
    for development mode.
    """
    # Try Supabase verification first
    try:
        payload = verify_supabase_token(token)
        if payload:
            return payload
    except Exception as e:
        logger.debug(f"Supabase token verification failed, trying fallback: {e}")
    
    # Fallback to unverified claims in development
    try:
        from src.core.config import settings
        if settings.ENVIRONMENT in ('development', 'dev', 'local', 'test'):
            claims = jose_jwt.get_unverified_claims(token)
            if isinstance(claims, dict):
                user_id = claims.get('sub') or claims.get('id') or claims.get('user_id')
                if user_id:
                    logger.warning("Using unverified token claims (development mode)")
                    return {
                        'id': str(user_id),
                        'user_id': str(user_id),
                        'sub': str(user_id),
                        'email': claims.get('email'),
                    }
    except Exception as e:
        logger.debug(f"Failed to extract unverified claims: {e}")
    
    return {}


class JWTBearer(HTTPBearer):
    def __init__(self, auto_error: bool = True):
        super(JWTBearer, self).__init__(auto_error=auto_error)

    async def __call__(self, request: Request):
        credentials: HTTPAuthorizationCredentials = await super().__call__(request)
        if credentials:
            if not credentials.scheme == "Bearer":
                raise HTTPException(
                    status_code=403, detail="Invalid authentication scheme."
                )
            # Allow test-suite shortcut token ONLY in development/test environments
            if credentials.credentials == 'test-token':
                try:
                    from src.core.config import settings
                    _env = str(getattr(settings, 'ENVIRONMENT', os.getenv('ENVIRONMENT', 'production'))).strip().lower()
                    if _env not in ('development', 'dev', 'local', 'test'):
                        raise HTTPException(status_code=403, detail="Invalid token.")
                except HTTPException:
                    raise
                except Exception:
                    pass
                return {'id': '1', 'user_id': '1', 'sub': '1'}

            # Extract basic info from token (no full validation yet)
            payload = extract_user_id_from_token(credentials.credentials)
            if payload:
                return payload
            
            # Development fallback
            try:
                from src.core.config import settings
                _env = str(getattr(settings, 'ENVIRONMENT', os.getenv('ENVIRONMENT', 'development'))).strip().lower()
                allow_unverified = bool(getattr(settings, 'ALLOW_UNVERIFIED_JWT_IN_DEV', False)) or os.getenv('ALLOW_UNVERIFIED_JWT_IN_DEV', '').lower() == 'true'
                if _env in ('development', 'dev', 'local', 'test') and allow_unverified:
                    payload = extract_user_id_from_token(credentials.credentials)
                    if payload:
                        logger.warning("JWTBearer: Using unverified token claims (development mode)")
                        return payload
            except Exception:
                pass
            
            raise HTTPException(
                status_code=403, detail="Invalid token or expired token."
            )
        else:
            raise HTTPException(status_code=403, detail="Invalid authorization code.")

    def verify_jwt(self, jwtoken: str) -> bool:
        """Minimal token verification - will be replaced with Supabase validation."""
        try:
            # Allow test-suite token shortcut
            if jwtoken == 'test-token':
                return True

            # Handle demo tokens
            if isinstance(jwtoken, str) and jwtoken.startswith('demo_token_'):
                return True

            # Try to extract claims (minimal validation)
            payload = extract_user_id_from_token(jwtoken)
            return bool(payload)
        except Exception:
            return False


TokenDep = Depends(JWTBearer())


def _jwt_from_supabase_auth_cookies(request: Request) -> Optional[str]:
    """
    Read Supabase session access_token from cookies when the Authorization header is missing.
    Supabase SSR / cookie-based sessions use names like sb-<project-ref>-auth-token (JSON body).
    """
    try:
        from urllib.parse import unquote

        cookies = getattr(request, "cookies", None) or {}
        for name, value in cookies.items():
            if not value or not isinstance(value, str):
                continue
            n = (name or "").lower()
            if n in ("access_token", "sb-access-token"):
                v = value.strip()
                if v and v != "null":
                    return v
            if n.startswith("sb-") and "auth-token" in n:
                try:
                    raw = unquote(value)
                    parsed = json.loads(raw)
                    if isinstance(parsed, dict):
                        at = parsed.get("access_token")
                        if isinstance(at, str) and at.strip() and at.strip() != "null":
                            return at.strip()
                except Exception:
                    continue
    except Exception:
        pass
    return None


class JWTCookieBearer(HTTPBearer):
    def __init__(self, auto_error: bool = True):
        super(JWTCookieBearer, self).__init__(auto_error=auto_error)

    def verify_jwt(self, jwtoken: str) -> bool:
        """Minimal token verification - will be replaced with Supabase validation."""
        try:
            # Allow test-suite token shortcut
            if jwtoken == 'test-token':
                return True

            # Handle demo tokens
            if isinstance(jwtoken, str) and jwtoken.startswith('demo_token_'):
                return True

            # Try to extract claims (minimal validation)
            payload = extract_user_id_from_token(jwtoken)
            return bool(payload)
        except Exception:
            return False

    async def __call__(self, request: Request):
        # Prefer Authorization header; fall back to Supabase auth cookies (forwarded from Next.js).
        token = None
        auth_header_val = (
            request.headers.get("Authorization")
            or request.headers.get("authorization")
            or ""
        )
        if auth_header_val:
            ah = auth_header_val.strip()
            lower = ah.lower()
            if lower.startswith("bearer "):
                token_from_header = ah.split(None, 1)[1].strip() if len(ah.split(None, 1)) > 1 else ""
                if token_from_header and token_from_header != "null":
                    if token_from_header == "test-token":
                        try:
                            from src.core.config import settings
                            _env = str(getattr(settings, 'ENVIRONMENT', 'production')).strip().lower()
                            if _env not in ('development', 'dev', 'local', 'test'):
                                raise HTTPException(status_code=401, detail="Invalid token.")
                        except HTTPException:
                            raise
                        except Exception:
                            pass
                        return {"id": "1", "user_id": "1", "sub": "1"}
                    # Accept any non-trivial token (JWT, opaque session, etc.) — do not use arbitrary 50-char floor
                    if len(token_from_header) >= 10:
                        token = token_from_header
            elif ah and ah != "null":
                token = ah
        
        # Strip "Bearer " prefix if present
        if isinstance(token, str) and token.startswith('Bearer '):
            token = token[7:].strip()

        # Accept test-token shortcut ONLY in non-production environments
        if token == 'test-token':
            try:
                from src.core.config import settings
                _env = str(getattr(settings, 'ENVIRONMENT', 'production')).strip().lower()
                if _env not in ('development', 'dev', 'local', 'test'):
                    raise HTTPException(status_code=401, detail="Authentication required.")
            except HTTPException:
                raise
            except Exception:
                pass
            return {'id': '1', 'user_id': '1', 'sub': '1'}

        if not token:
            ce_cookie = request.cookies.get("auth_token")
            if ce_cookie and str(ce_cookie).strip() not in ("", "null"):
                token = str(ce_cookie).strip()

        if not token:
            token = _jwt_from_supabase_auth_cookies(request)

        # No token means no authentication
        if not token:
            logger.warning("JWTCookieBearer: No token found (header or cookies)")
            raise HTTPException(
                status_code=status.HTTP_401_UNAUTHORIZED,
                detail="Authentication required. Please log in."
            )

        # CE httpOnly session (HS256 + SECRET_KEY) — same as /auth/me get_current_user
        try:
            from src.modules.authentication.service import decode_access_token

            ce_payload = decode_access_token(token)
            uid = str(ce_payload.get("sub") or "")
            if uid:
                return {
                    "id": uid,
                    "user_id": uid,
                    "sub": uid,
                    "email": ce_payload.get("email"),
                }
        except Exception:
            pass

        # Keycloak OIDC (async path — proper signature verification before sync fallbacks)
        try:
            from src.modules.authentication.keycloak_service import (
                is_keycloak_enabled,
                verify_keycloak_token,
            )

            if is_keycloak_enabled():
                kc_payload = await verify_keycloak_token(token)
                if kc_payload:
                    return kc_payload
        except Exception:
            pass

        # Extract payload from token (HS256 / Supabase JWKS / dev fallback)
        payload = extract_user_id_from_token(token)
        if payload:
            return payload
        
        # Handle demo tokens
        if isinstance(token, str) and token.startswith('demo_token_'):
            try:
                parts = token.split("_")
                if len(parts) >= 3 and parts[0] == 'demo' and parts[1] == 'token':
                    user_id = parts[2]
                    return {'id': user_id, 'user_id': user_id, 'sub': user_id}
            except Exception:
                pass
        
        # Development fallback
        try:
            from src.core.config import settings
            _env = str(getattr(settings, 'ENVIRONMENT', 'development')).strip().lower()
            if _env in ('development', 'dev', 'local', 'test') and isinstance(token, str):
                payload = extract_user_id_from_token(token)
                if payload:
                    logger.info(f"JWTCookieBearer: returning unverified claims (development)")
                    return payload
        except Exception:
            pass

        # Last resort: do NOT fabricate identities. Raise explicit auth error.
        raise HTTPException(
            status_code=status.HTTP_401_UNAUTHORIZED,
            detail="Invalid or unverifiable token. Please sign in again.",
        )


CookieDep = Depends(JWTCookieBearer())


async def current_user_payload(request: Request) -> dict:
    """Resolve the current user payload from Authorization header.
    
    Returns an empty dict if no valid token is present.
    Uses Supabase RS256 token verification.
    """
    token = None
    auth_header = request.headers.get('Authorization') or request.headers.get('authorization')
    if auth_header:
        if auth_header.lower().startswith('bearer '):
            token = auth_header.split(None, 1)[1].strip()
        else:
            token = auth_header

    payload = {}
    if token:
        if token == 'test-token':
            try:
                from src.core.config import settings
                _env = str(getattr(settings, 'ENVIRONMENT', 'production')).strip().lower()
                if _env in ('development', 'dev', 'local', 'test'):
                    return {'id': '1', 'user_id': '1', 'sub': '1'}
            except Exception:
                pass
        
        try:
            payload = extract_user_id_from_token(token)
        except Exception:
            payload = {}


    return payload


CurrentUserPayloadDep = Depends(current_user_payload)
