"""
Central observability bootstrap: OpenTelemetry traces, optional Sentry, FastAPI instrumentation.
All features are opt-in via environment variables — no DSN/endpoint means no-op.
"""

from __future__ import annotations

import logging
import os
from typing import Optional

logger = logging.getLogger(__name__)

_tracer_provider = None
_sentry_initialized = False


def _env_bool(name: str, default: bool = False) -> bool:
    return os.getenv(name, str(default)).lower() in ("1", "true", "yes", "on")


def setup_observability(service_name: Optional[str] = None) -> None:
    """Initialize tracing and error reporting when configured."""
    name = (service_name or os.getenv("OTEL_SERVICE_NAME") or "aiser-api").strip()
    _setup_otel(name)
    _instrument_libraries()
    _setup_sentry(name)


def instrument_fastapi(app) -> None:
    """Attach OpenTelemetry FastAPI instrumentation when OTEL is active."""
    if not _env_bool("OTEL_ENABLED") and not os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        return
    try:
        from opentelemetry.instrumentation.fastapi import FastAPIInstrumentor

        FastAPIInstrumentor.instrument_app(
            app,
            excluded_urls="/health,/metrics,/docs,/redoc,/docs/json",
        )
        logger.info("OpenTelemetry FastAPI instrumentation enabled")
    except ImportError:
        logger.debug("opentelemetry-instrumentation-fastapi not installed; skipping")
    except Exception as exc:
        logger.warning("Failed to instrument FastAPI with OpenTelemetry: %s", exc)


def shutdown_observability() -> None:
    """Flush exporters on process shutdown."""
    global _tracer_provider
    if _tracer_provider is not None:
        try:
            _tracer_provider.shutdown()
            logger.info("OpenTelemetry tracer provider shut down")
        except Exception as exc:
            logger.warning("OpenTelemetry shutdown error: %s", exc)
        _tracer_provider = None


def ensure_tracer_provider(service_name: str = "aiser-api") -> bool:
    """Idempotent tracer provider setup; returns True when OTEL is available."""
    global _tracer_provider
    if _tracer_provider is not None:
        return True

    try:
        from opentelemetry import trace
        from opentelemetry.sdk.resources import Resource
        from opentelemetry.sdk.trace import TracerProvider
        from opentelemetry.sdk.trace.export import BatchSpanProcessor
    except ImportError:
        return False

    resource = Resource.create({"service.name": service_name})
    provider = TracerProvider(resource=resource)

    otlp_endpoint = os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT", "").strip()
    console = _env_bool("OTEL_TRACES_CONSOLE")

    if otlp_endpoint:
        try:
            from opentelemetry.exporter.otlp.proto.http.trace_exporter import (
                OTLPSpanExporter,
            )

            exporter = OTLPSpanExporter(endpoint=otlp_endpoint)
            provider.add_span_processor(BatchSpanProcessor(exporter))
            logger.info("OpenTelemetry OTLP exporter → %s", otlp_endpoint)
        except ImportError:
            logger.warning(
                "OTEL_EXPORTER_OTLP_ENDPOINT set but opentelemetry-exporter-otlp-proto-http "
                "is not installed"
            )
        except Exception as exc:
            logger.warning("Failed to configure OTLP exporter: %s", exc)

    if console or not otlp_endpoint:
        try:
            from opentelemetry.sdk.trace.export import ConsoleSpanExporter

            provider.add_span_processor(BatchSpanProcessor(ConsoleSpanExporter()))
            if console:
                logger.info("OpenTelemetry console span exporter enabled")
        except Exception as exc:
            logger.warning("Failed to configure console span exporter: %s", exc)

    trace.set_tracer_provider(provider)
    _tracer_provider = provider
    return True


def _setup_otel(service_name: str) -> None:
    if not _env_bool("OTEL_ENABLED") and not os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT"):
        if not _env_bool("OTEL_TRACES_CONSOLE"):
            return
    ensure_tracer_provider(service_name)


def _otel_active() -> bool:
    return _tracer_provider is not None or _env_bool("OTEL_ENABLED") or bool(
        os.getenv("OTEL_EXPORTER_OTLP_ENDPOINT")
    )


def _instrument_libraries() -> None:
    """Auto-instrument Redis, HTTPX, and SQLAlchemy when OTEL is enabled."""
    if not _otel_active():
        return

    for module_path, class_name in (
        ("opentelemetry.instrumentation.redis", "RedisInstrumentor"),
        ("opentelemetry.instrumentation.httpx", "HTTPXClientInstrumentor"),
        ("opentelemetry.instrumentation.sqlalchemy", "SQLAlchemyInstrumentor"),
    ):
        try:
            module = __import__(module_path, fromlist=[class_name])
            instrumentor = getattr(module, class_name)()
            instrumentor.instrument()
            logger.info("OpenTelemetry instrumentation enabled: %s", class_name)
        except ImportError:
            logger.debug("%s not installed; skipping", class_name)
        except Exception as exc:
            logger.warning("Failed to instrument %s: %s", class_name, exc)


def _setup_sentry(service_name: str) -> None:
    global _sentry_initialized
    if _sentry_initialized:
        return

    dsn = os.getenv("SENTRY_DSN", "").strip()
    if not dsn:
        return

    try:
        import sentry_sdk
        from sentry_sdk.integrations.fastapi import FastApiIntegration
        from sentry_sdk.integrations.logging import LoggingIntegration
        from sentry_sdk.integrations.starlette import StarletteIntegration
    except ImportError:
        logger.warning("SENTRY_DSN set but sentry-sdk is not installed")
        return

    environment = os.getenv("SENTRY_ENVIRONMENT") or os.getenv("ENVIRONMENT", "development")
    traces_sample_rate = float(os.getenv("SENTRY_TRACES_SAMPLE_RATE", "0.1"))

    sentry_sdk.init(
        dsn=dsn,
        environment=environment,
        release=os.getenv("SENTRY_RELEASE") or os.getenv("APP_VERSION"),
        integrations=[
            StarletteIntegration(transaction_style="endpoint"),
            FastApiIntegration(transaction_style="endpoint"),
            LoggingIntegration(level=logging.INFO, event_level=logging.ERROR),
        ],
        traces_sample_rate=traces_sample_rate,
        send_default_pii=False,
        attach_stacktrace=True,
    )
    sentry_sdk.set_tag("service", service_name)
    _sentry_initialized = True
    logger.info("Sentry initialized (environment=%s)", environment)
