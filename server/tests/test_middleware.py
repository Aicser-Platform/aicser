def test_middleware_classes_importable():
    from src.core.middleware import RateLimitMiddleware, EmbedTokenMiddleware
    from starlette.middleware.base import BaseHTTPMiddleware
    assert issubclass(RateLimitMiddleware, BaseHTTPMiddleware)
    assert issubclass(EmbedTokenMiddleware, BaseHTTPMiddleware)
