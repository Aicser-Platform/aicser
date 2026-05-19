"""Application entry point — creates the FastAPI app and wires middleware."""
import logging
import os
import sys

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response

from src.core.router import api_router
from src.core.cache import cache
from src.core.config import settings
from src.core.edition import is_ee_enabled
from src.core.lifespan import lifespan, _check_predictive_deps, _check_ai_capabilities
from src.core.middleware import RateLimitMiddleware, EmbedTokenMiddleware

try:
    import socketio
    from src.modules.collaboration.socketio_manager import sio
    _SOCKET_ENABLED = True
except Exception as _sio_err:
    logging.getLogger(__name__).warning("Socket.IO disabled: %s", _sio_err)
    socketio = None
    sio = None
    _SOCKET_ENABLED = False

try:
    from prometheus_client import CONTENT_TYPE_LATEST, generate_latest
except Exception:
    CONTENT_TYPE_LATEST = None
    generate_latest = None

logger = logging.getLogger(__name__)

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION,
    openapi_url="/docs/json",
    docs_url="/docs",
    redoc_url="/redoc",
    contact=settings.APP_CONTACT,
    lifespan=lifespan,
)

# ── CORS ─────────────────────────────────────────────────────────────────────
allowed_origins = [o.strip() for o in settings.CORS_ORIGINS.split(",") if o.strip()]
for _extra in ("http://localhost:3001", "http://127.0.0.1:3001"):
    if _extra not in allowed_origins:
        allowed_origins.append(_extra)

app.add_middleware(
    CORSMiddleware,
    allow_origins=allowed_origins,
    allow_credentials=True,
    allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
    allow_headers=[
        "Authorization", "Content-Type", "X-Requested-With",
        "Accept", "X-Embed-Token", "X-Request-ID",
    ],
    expose_headers=["X-RateLimit-Limit", "X-RateLimit-Remaining", "X-RateLimit-Reset"],
)
app.add_middleware(EmbedTokenMiddleware)
app.add_middleware(RateLimitMiddleware)

if is_ee_enabled():
    try:
        from src.shared.middleware.audit_logger import AuditLoggingMiddleware
        app.add_middleware(AuditLoggingMiddleware)
    except Exception as _audit_err:
        logger.warning("Audit logging middleware not loaded: %s", _audit_err)

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(api_router)

# Optional feature routers — guarded so missing deps don't crash startup
for _module_path, _attr, _prefix, _label in [
    ("src.modules.ai.semantic_router", "router", "/api", "Semantic layer"),
    ("src.modules.lakehouse.router", "router", "/api", "Lakehouse"),
    ("src.modules.catalog.router", "router", "/api", "Catalog bridge"),
    ("src.modules.bi_sync.router", "router", "/api", "BI Sync"),
]:
    try:
        import importlib
        _mod = importlib.import_module(_module_path)
        app.include_router(getattr(_mod, _attr), prefix=_prefix)
    except Exception as _err:
        logger.warning("%s router not loaded: %s", _label, _err)

# Jobs status/enqueue router
try:
    from fastapi import APIRouter as _APIRouter
    _jobs_router = _APIRouter(prefix="/api/jobs", tags=["jobs"])

    @_jobs_router.get("/{job_id}")
    async def get_job_status_endpoint(job_id: str):
        from src.shared.jobs.client import get_job_status
        return await get_job_status(job_id)

    @_jobs_router.post("/enqueue/{function_name}")
    async def enqueue_job_endpoint(function_name: str, payload: dict = {}):
        from src.shared.jobs.client import enqueue_job
        job_id = await enqueue_job(function_name, **payload)
        return {"job_id": job_id, "function": function_name}

    app.include_router(_jobs_router)
except Exception as _jobs_err:
    logger.warning("Jobs router not loaded: %s", _jobs_err)

# ── Exception handlers ────────────────────────────────────────────────────────

@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning("Validation error for path=%s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=422,
        content={
            "error": "validation_error",
            "message": "Request validation failed",
            "details": exc.errors(),
        },
    )


@app.exception_handler(Exception)
async def exception_handler(request: Request, exc: Exception):
    import traceback
    tb = "\n".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    logger.error("Unhandled exception for path=%s: %s", request.url.path, tb)
    return JSONResponse(
        status_code=500,
        content={
            "error": "internal_server_error",
            "message": str(exc),
            "trace": tb if os.getenv("EXPOSE_TRACES", "false").lower() in ("1", "true") else "<hidden>",
        },
    )

# ── System endpoints ──────────────────────────────────────────────────────────

@app.get("/health")
async def health_check():
    """Liveness check — reports Redis status, predictive deps, and AI capabilities."""
    out = {"status": "healthy"}
    try:
        if cache and getattr(cache, "redis_client", None):
            cache.redis_client.ping()
            out["redis"] = "up"
        elif cache:
            out["redis"] = "fallback"
        else:
            out["redis"] = "unavailable"
    except Exception:
        out["redis"] = "down"
    out["predictive"] = _check_predictive_deps()
    out["capabilities"] = _check_ai_capabilities()
    return out


@app.get("/metrics", include_in_schema=False)
async def metrics_export():
    """Expose Prometheus metrics for scraping."""
    if generate_latest is None or CONTENT_TYPE_LATEST is None:
        return Response(
            status_code=503,
            content="# prometheus_client not installed\n",
            media_type="text/plain; version=0.0.4",
        )
    return Response(content=generate_latest(), media_type=CONTENT_TYPE_LATEST)


# ── Socket.IO mount (optional) ────────────────────────────────────────────────
if _SOCKET_ENABLED and socketio is not None and sio is not None:
    app = socketio.ASGIApp(sio, other_asgi_app=app, socketio_path="/socket.io")
