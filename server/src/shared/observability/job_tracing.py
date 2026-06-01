"""OpenTelemetry + Sentry wrappers for ARQ background jobs."""

from __future__ import annotations

import functools
import logging
from typing import Any, Callable, Iterable, List

logger = logging.getLogger(__name__)


def wrap_arq_functions(functions: Iterable[Callable[..., Any]]) -> List[Callable[..., Any]]:
    return [trace_arq_job(fn) for fn in functions]


def trace_arq_job(fn: Callable[..., Any]) -> Callable[..., Any]:
    @functools.wraps(fn)
    async def wrapper(ctx: dict, *args: Any, **kwargs: Any) -> Any:
        job_name = fn.__name__
        job_id = ctx.get("job_id") if isinstance(ctx, dict) else None

        span_cm = _start_job_span(job_name, job_id)
        if span_cm is None:
            return await fn(ctx, *args, **kwargs)

        with span_cm as span:
            if span is not None:
                span.set_attribute("job.name", job_name)
                if job_id:
                    span.set_attribute("job.id", str(job_id))
            try:
                return await fn(ctx, *args, **kwargs)
            except Exception as exc:
                _capture_job_exception(exc, job_name, job_id)
                if span is not None:
                    span.record_exception(exc)
                raise

    return wrapper


def _start_job_span(job_name: str, job_id: Any):
    try:
        from opentelemetry import trace

        tracer = trace.get_tracer("aiser-worker")
        return tracer.start_as_current_span(f"job.{job_name}")
    except Exception:
        return None


def _capture_job_exception(exc: Exception, job_name: str, job_id: Any) -> None:
    try:
        import sentry_sdk

        with sentry_sdk.push_scope() as scope:
            scope.set_tag("job.name", job_name)
            if job_id:
                scope.set_tag("job.id", str(job_id))
            sentry_sdk.capture_exception(exc)
    except Exception:
        logger.exception("Background job %s failed", job_name)
