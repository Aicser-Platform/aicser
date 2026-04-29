from fastapi import APIRouter, Request, Body
import logging

router = APIRouter()
logger = logging.getLogger(__name__)


@router.get("/auth/whoami")
async def whoami(request: Request):
    """Return decoded JWT payload for current request (dev helper).
    
    Note: This is a simplified version that just returns request info.
    Full JWT verification will be implemented when Supabase auth is integrated.
    """
    try:
        logger.info(f"whoami request cookies: {dict(request.cookies or {})}")
        logger.info(f"whoami Authorization header present: {bool(request.headers.get('Authorization'))}")
    except Exception:
        pass
    
    # Return basic request info
    dbg = {}
    try:
        dbg = {"cookies": dict(request.cookies or {}), "authorization": bool(request.headers.get('Authorization'))}
    except Exception:
        dbg = {}
    
    return {"authenticated": False, "payload": {}, "debug": dbg, "message": "Auth removed - Supabase integration pending"}


@router.get("/auth/whoami-raw")
async def whoami_raw(request: Request):
    """Return raw cookies and Authorization header for debugging CORS/cookies."""
    return {
        "cookies": dict(request.cookies or {}),
        "authorization": request.headers.get("authorization"),
    }


@router.post("/auth/echo")
async def auth_echo(payload: dict | None = Body(None)):
    """Dev helper: echo back the received JSON body to validate POST handling."""
    return {"received": payload}
