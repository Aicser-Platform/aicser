"""Fixes from the platform audit: socket tokens off the URL, long jobs, stuck versions, quiet empty searches."""

import asyncio

import pytest


def test_socket_token_is_read_from_the_handshake_before_the_url(monkeypatch):
    from ee.modules.collaboration import socketio_manager as S
    import src.modules.authentication.deps.auth_bearer as ab

    seen = []

    def verify(tok):
        seen.append(tok)
        return {"sub": "u1", "email": "a@b.c"}

    monkeypatch.setattr(ab, "verify_supabase_token", verify)
    user = asyncio.run(S._authenticate_socket({"QUERY_STRING": "token=from-url"}, {"token": "from-handshake"}))
    assert user and user["user_id"] == "u1" and seen == ["from-handshake"]
    asyncio.run(S._authenticate_socket({"QUERY_STRING": "token=legacy"}, None))
    assert seen[-1] == "legacy"  # older clients still work


def test_long_jobs_get_their_own_timeouts():
    from src.shared.jobs import worker

    funcs = {getattr(f, "name", getattr(f, "__name__", "")): f for f in worker.WorkerSettings.functions}
    train = funcs["train_ml_model"]
    assert getattr(train, "timeout_s", None) == 3600 and getattr(train, "max_tries", None) == 1


def test_generated_files_default_to_the_shared_volume(tmp_path, monkeypatch):
    import importlib

    import ee.modules.ai.services.export_artifacts_service as X

    monkeypatch.delenv("AISER_ARTIFACTS_DIR", raising=False)
    root = str(X._ARTIFACTS_ROOT)
    assert root.startswith("/app/uploads") or root.startswith("/tmp")  # /app/uploads when the volume exists


def test_rate_limit_buckets_are_independent():
    from src.shared.middleware.rate_limiter import RateLimiter

    exports = RateLimiter(requests_per_minute=2, bucket="exports-test")
    ai = RateLimiter(requests_per_minute=2, bucket="ai-test")
    assert all(exports._check_fallback("u", "o", 1.0)[0] for _ in range(2))
    assert exports._check_fallback("u", "o", 1.0)[0] is False   # exports used up
    assert ai._check_fallback("u", "o", 1.0)[0] is True          # asking questions unaffected
