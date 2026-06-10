"""Tests for ApiRouteRateLimitMiddleware path matching."""
from src.core.middleware import ApiRouteRateLimitMiddleware


def test_match_auth_login():
    rule = ApiRouteRateLimitMiddleware._match_rule("/auth/login")
    assert rule is not None
    assert rule[0] == "/auth/login"


def test_match_query_execute():
    rule = ApiRouteRateLimitMiddleware._match_rule("/data/query/execute")
    assert rule is not None
    assert rule[0] == "/data/query/execute"


def test_no_match_health():
    assert ApiRouteRateLimitMiddleware._match_rule("/health") is None
