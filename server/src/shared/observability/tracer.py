"""
Distributed Tracing with OpenTelemetry
Provides: Request tracing, performance monitoring, error tracking
"""
import time
import functools
from typing import Any, Callable, Dict, Optional
from contextlib import contextmanager
import asyncio

try:
    from opentelemetry import trace
    from opentelemetry.trace import Status, StatusCode
    OTEL_AVAILABLE = True
except ImportError:
    OTEL_AVAILABLE = False
    print("Warning: opentelemetry not installed. Using fallback tracing.")


class FallbackSpan:
    """Fallback span when OpenTelemetry not available"""
    
    def __init__(self, name: str):
        self.name = name
        self.attributes = {}
        self.start_time = time.time()
        self.end_time = None
        self.status = "ok"
    
    def set_attribute(self, key: str, value: Any) -> None:
        self.attributes[key] = value
    
    def set_status(self, status: Any, description: str = "") -> None:
        self.status = "error" if "error" in str(status).lower() else "ok"
    
    def record_exception(self, exception: Exception) -> None:
        self.status = "error"
        self.attributes['exception'] = str(exception)
    
    def end(self) -> None:
        self.end_time = time.time()
        duration_ms = (self.end_time - self.start_time) * 1000
        print(f"[TRACE] {self.name}: {duration_ms:.2f}ms ({self.status})")


class DistributedTracer:
    """
    Distributed tracing for LangGraph workflow.
    Tracks execution across nodes, LLM calls, database queries.
    """
    
    def __init__(self, service_name: str = "chat2chart"):
        self.service_name = service_name
        self.tracer = None
        
        if OTEL_AVAILABLE:
            self._initialize_otel()
        else:
            print("Using fallback tracing (install opentelemetry-api for full features)")
    
    def _initialize_otel(self) -> None:
        """Use shared tracer provider (OTLP and/or console via env)."""
        from src.shared.observability.setup import ensure_tracer_provider

        if ensure_tracer_provider(self.service_name):
            self.tracer = trace.get_tracer(__name__)
    
    @contextmanager
    def start_span(self, name: str, attributes: Optional[Dict[str, Any]] = None):
        """
        Start a new span for tracing.
        
        Usage:
            with tracer.start_span("nl2sql_generation") as span:
                span.set_attribute("query", query)
                # ... do work
        """
        if self.tracer:
            with self.tracer.start_as_current_span(name) as span:
                if attributes:
                    for key, value in attributes.items():
                        span.set_attribute(key, str(value))
                yield span
        else:
            # Fallback
            span = FallbackSpan(name)
            if attributes:
                for key, value in attributes.items():
                    span.set_attribute(key, str(value))
            try:
                yield span
            finally:
                span.end()
    
    def trace_function(self, span_name: Optional[str] = None):
        """
        Decorator to trace function execution.
        
        Usage:
            @tracer.trace_function("my_function")
            async def my_function(arg1, arg2):
                # ... function body
        """
        def decorator(func: Callable) -> Callable:
            name = span_name or func.__name__
            
            if asyncio.iscoroutinefunction(func):
                @functools.wraps(func)
                async def async_wrapper(*args, **kwargs):
                    with self.start_span(name) as span:
                        try:
                            result = await func(*args, **kwargs)
                            return result
                        except Exception as e:
                            span.record_exception(e)
                            if OTEL_AVAILABLE:
                                span.set_status(Status(StatusCode.ERROR, str(e)))
                            raise
                return async_wrapper
            else:
                @functools.wraps(func)
                def sync_wrapper(*args, **kwargs):
                    with self.start_span(name) as span:
                        try:
                            result = func(*args, **kwargs)
                            return result
                        except Exception as e:
                            span.record_exception(e)
                            if OTEL_AVAILABLE:
                                span.set_status(Status(StatusCode.ERROR, str(e)))
                            raise
                return sync_wrapper
        
        return decorator


# Global tracer instance
_tracer = None

def get_tracer(service_name: str = "chat2chart") -> DistributedTracer:
    """Get or create global tracer instance"""
    global _tracer
    if _tracer is None:
        _tracer = DistributedTracer(service_name)
    return _tracer
