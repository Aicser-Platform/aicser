from fastapi import APIRouter, Request, Depends, HTTPException, status
import logging
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer

router = APIRouter()
logger = logging.getLogger(__name__)

# In-memory store for last client log payload (dev only)
_last_client_log: dict | None = None


@router.post("/client-error")
async def client_error(request: Request):
    """Receive client-side JS errors for debugging during development."""
    try:
        payload = await request.json()
    except Exception:
        payload = {"error": "invalid json"}
    # store last payload in memory for easier retrieval during dev
    global _last_client_log
    try:
        _last_client_log = payload
    except Exception:
        _last_client_log = {"error": "failed to store payload"}
    logger.error("ClientError: %s", payload)
    return {"success": True}


@router.get("/client-error/last")
async def client_error_last():
    """Return the last received client log payload (dev only)."""
    return {"last": _last_client_log}


@router.post("/eval/clear-caches")
async def eval_clear_caches(
    current_token: dict = Depends(JWTCookieBearer()),
):
    """
    Dev-only: clear LangGraph schema + query-result caches so eval runs reflect
    the real workflow behavior (interrupt/auto-resume paths).
    """
    try:
        from src.modules.ai.services.langgraph_orchestrator import LangGraphMultiAgentOrchestrator

        LangGraphMultiAgentOrchestrator.invalidate_schema_cache(None)
        return {"success": True, "message": "Cleared LangGraph schema + query-result caches"}
    except Exception as e:
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Failed to clear eval caches: {type(e).__name__}: {e}",
        )


