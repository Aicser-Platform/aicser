"""Application entry point — creates the FastAPI app and wires middleware."""
import logging
import os
import mimetypes
import sys

project_root = os.path.abspath(os.path.join(os.path.dirname(__file__), ".."))
if project_root not in sys.path:
    sys.path.insert(0, project_root)

# ── Logging ────────────────────────────────────────────────────────────────────
# Configure the root logger BEFORE importing app modules so their logger.info()
# output (Supervisor routing, per-node model, node timings, post_query_brain scores)
# reaches stdout/docker logs. Without this, the root logger has no handler and
# Python's "last resort" handler only emits WARNING+, silently dropping all INFO.
# uvicorn configures its own (uvicorn.*) loggers, so this does not duplicate access logs.
_LOG_LEVEL = os.getenv("LOG_LEVEL", "INFO").upper()
logging.basicConfig(
    level=getattr(logging, _LOG_LEVEL, logging.INFO),
    format="%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s",
    stream=sys.stdout,
    force=True,
)
# Every log record needs a request_id attribute for the format string above,
# including ones emitted before any request has started (startup) or outside
# a request entirely (background jobs) -- the filter supplies "-" for those.
from src.core.middleware import RequestIDLogFilter  # noqa: E402

for _handler in logging.getLogger().handlers:
    _handler.addFilter(RequestIDLogFilter())

from fastapi import FastAPI, HTTPException, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse, Response
from fastapi.staticfiles import StaticFiles

from src.core.router import api_router
from src.core.config import settings
from src.core.edition import is_ee_enabled
from src.core.production import is_production
from src.core.lifespan import lifespan
from src.core.middleware import (
    ApiRouteRateLimitMiddleware,
    EmbedTokenMiddleware,
    PrometheusMiddleware,
    RateLimitMiddleware,
    RequestIDMiddleware,
)
from src.shared.api_errors import error_body, http_exception_to_response
from src.shared.observability.setup import instrument_fastapi

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

# SECURITY: /docs, /docs/json, and /redoc used to be exposed unconditionally
# -- unlike whoami-raw/auth_echo, which ARE correctly gated on is_production()
# -- handing anyone the full route/schema map (every endpoint path, request/
# response shape, auth requirements) for this deployment. Passing None
# disables FastAPI's route registration for these entirely in production.
_expose_api_docs = not is_production()

app = FastAPI(
    title=settings.APP_NAME,
    version=settings.APP_VERSION or os.getenv("AISER_VERSION") or "0.0.1",
    openapi_url="/docs/json" if _expose_api_docs else None,
    docs_url="/docs" if _expose_api_docs else None,
    redoc_url="/redoc" if _expose_api_docs else None,
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
app.add_middleware(ApiRouteRateLimitMiddleware)
app.add_middleware(RateLimitMiddleware)

if is_ee_enabled():
    try:
        from src.shared.middleware.audit_logger import AuditLoggingMiddleware
        app.add_middleware(AuditLoggingMiddleware)
    except Exception as _audit_err:
        logger.warning("Audit logging middleware not loaded: %s", _audit_err)

app.add_middleware(PrometheusMiddleware)
# Outermost (registered last -> Starlette runs it first) so every other
# middleware and every log line for this request has the ID available.
app.add_middleware(RequestIDMiddleware)
instrument_fastapi(app)

# ── Static media (feed card thumbnails) ───────────────────────────────────────
# Disk layout: <UPLOAD_DIR>/feed_thumbnails/<uuid>.webp
# Public URL:  /media/feed-thumbnails/<uuid>.webp
# StaticFiles raises at mount time if the directory doesn't exist, so create it eagerly.
mimetypes.add_type("image/webp", ".webp")
_feed_thumbnails_dir = os.path.join(settings.UPLOAD_DIR, "feed_thumbnails")
os.makedirs(_feed_thumbnails_dir, exist_ok=True)
app.mount("/media/feed-thumbnails", StaticFiles(directory=_feed_thumbnails_dir), name="feed-thumbnails")

# ── Routers ───────────────────────────────────────────────────────────────────
app.include_router(api_router)

if is_ee_enabled():
    # Optional EE feature routers — guarded so missing deps don't crash startup.
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

# Jobs status/enqueue router (authenticated)
try:
    from fastapi import APIRouter as _APIRouter, Depends as _Depends, HTTPException as _HTTPException
    from src.modules.authentication.deps.auth_bearer import JWTCookieBearer

    _jobs_router = _APIRouter(prefix="/api/jobs", tags=["jobs"])
    _jobs_auth = JWTCookieBearer()

    @_jobs_router.get("/{job_id}")
    async def get_job_status_endpoint(
        job_id: str,
        _token: dict = _Depends(_jobs_auth),
    ):
        from src.shared.jobs.client import get_job_status
        return await get_job_status(job_id)

    @_jobs_router.post("/enqueue/{function_name}")
    async def enqueue_job_endpoint(
        function_name: str,
        payload: dict = {},
        _token: dict = _Depends(_jobs_auth),
    ):
        from src.shared.jobs.client import enqueue_job
        job_id = await enqueue_job(function_name, **payload)
        return {"job_id": job_id, "function": function_name}

    app.include_router(_jobs_router)
except Exception as _jobs_err:
    logger.warning("Jobs router not loaded: %s", _jobs_err)

# ── Exception handlers ────────────────────────────────────────────────────────

@app.exception_handler(HTTPException)
async def http_exception_handler(request: Request, exc: HTTPException):
    return http_exception_to_response(exc)


@app.exception_handler(RequestValidationError)
async def validation_exception_handler(request: Request, exc: RequestValidationError):
    logger.warning("Validation error for path=%s: %s", request.url.path, exc)
    return JSONResponse(
        status_code=422,
        content=error_body(
            "validation_error",
            "Request validation failed",
            details=exc.errors(),
        ),
    )


@app.exception_handler(Exception)
async def exception_handler(request: Request, exc: Exception):
    import traceback

    if isinstance(exc, HTTPException):
        return http_exception_to_response(exc)

    tb = "\n".join(traceback.format_exception(type(exc), exc, exc.__traceback__))
    logger.error("Unhandled exception for path=%s: %s", request.url.path, tb)
    expose = os.getenv("EXPOSE_TRACES", "false").lower() in ("1", "true")
    return JSONResponse(
        status_code=500,
        content=error_body(
            "internal_server_error",
            "An unexpected error occurred. Please try again.",
            trace=tb if expose else None,
        ),
    )

# ── System endpoints ──────────────────────────────────────────────────────────
# Shared by the secondary /health endpoints in ee/modules/ai/router.py and
# src/modules/data/router.py -- see src/shared/health.py for the single
# source of truth for what "healthy" means (Postgres, Redis, ARQ worker,
# predictive deps, AI capabilities).
from src.shared.health import collect_health_payload  # noqa: E402


@app.get("/health")
async def health_check():
    """Liveness check — always returns 200 unless process is dead (use /ready for deps)."""
    payload, _ = await collect_health_payload()
    return JSONResponse(content=payload, status_code=200)


@app.get("/ready")
async def readiness_check():
    """Readiness — 503 when critical dependencies (Postgres, Redis in prod) are unavailable."""
    payload, status_code = await collect_health_payload()
    return JSONResponse(content=payload, status_code=status_code)


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
