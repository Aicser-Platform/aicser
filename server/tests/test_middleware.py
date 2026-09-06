def test_middleware_classes_importable():
    from src.core.middleware import RateLimitMiddleware, EmbedTokenMiddleware
    from starlette.middleware.base import BaseHTTPMiddleware
    assert issubclass(RateLimitMiddleware, BaseHTTPMiddleware)
    assert issubclass(EmbedTokenMiddleware, BaseHTTPMiddleware)


class TestSecurityHeadersMiddleware:
    """Baseline security headers (HSTS, nosniff, Referrer-Policy, framing
    control) were entirely absent before this middleware — only X-Request-ID
    and a route-scoped embed CSP existed. The framing header specifically
    must stay conditional: a blanket X-Frame-Options would silently break
    embeds, which rely on EmbedTokenMiddleware's own frame-ancestors CSP to
    let allow-listed external domains iframe those specific pages."""

    def _client(self):
        from starlette.applications import Starlette
        from starlette.responses import PlainTextResponse, Response
        from starlette.routing import Route
        from src.core.middleware import SecurityHeadersMiddleware

        async def plain(request):
            return PlainTextResponse("ok")

        async def with_embed_csp(request):
            resp = Response("ok")
            resp.headers["Content-Security-Policy"] = "frame-ancestors https://partner.example.com"
            return resp

        app = Starlette(routes=[Route("/plain", plain), Route("/embed", with_embed_csp)])
        app.add_middleware(SecurityHeadersMiddleware)
        from starlette.testclient import TestClient

        return TestClient(app)

    def test_sets_baseline_headers_on_a_normal_response(self):
        client = self._client()
        res = client.get("/plain")
        assert res.headers["Strict-Transport-Security"] == "max-age=31536000; includeSubDomains"
        assert res.headers["X-Content-Type-Options"] == "nosniff"
        assert res.headers["Referrer-Policy"] == "strict-origin-when-cross-origin"
        assert "Permissions-Policy" in res.headers

    def test_adds_x_frame_options_when_no_csp_present(self):
        client = self._client()
        res = client.get("/plain")
        assert res.headers["X-Frame-Options"] == "SAMEORIGIN"

    def test_skips_x_frame_options_when_a_csp_is_already_set(self):
        """The embed case: EmbedTokenMiddleware's own frame-ancestors CSP
        must not be undermined by a blanket X-Frame-Options stacked on top."""
        client = self._client()
        res = client.get("/embed")
        assert "X-Frame-Options" not in res.headers
        assert res.headers["Content-Security-Policy"] == "frame-ancestors https://partner.example.com"
        # Non-framing headers still apply everywhere, embed routes included.
        assert res.headers["X-Content-Type-Options"] == "nosniff"


class TestSensitiveQueryParamLogFilter:
    """Embed dashboards pass their auth token as a URL query param (an
    <iframe src="..."> can't send custom headers) -- uvicorn's access logger
    records the full request line at INFO by default, which put every embed
    token in plaintext in stdout/Docker logs. This filter (wired onto
    uvicorn.access in main.py) has to redact it there since the request line
    is uvicorn's own log call, not something this app's handlers format."""

    def _filtered_message(self, msg, args):
        import logging
        from src.core.middleware import SensitiveQueryParamLogFilter

        record = logging.LogRecord("uvicorn.access", logging.INFO, __file__, 1, msg, args, None)
        SensitiveQueryParamLogFilter().filter(record)
        return record.getMessage()

    def test_redacts_embed_token_from_access_log_request_line(self):
        out = self._filtered_message(
            '%s - "%s" %d',
            ("127.0.0.1:1234", "GET /embed/dashboard/abc?token=eyJhbGciOiJIUzI1NiJ9.SECRET HTTP/1.1", 200),
        )
        assert "SECRET" not in out
        assert "token=***REDACTED***" in out
        assert "/embed/dashboard/abc" in out  # path itself stays readable

    def test_redacts_api_key_and_access_token_param_names_too(self):
        out = self._filtered_message('%s', ("GET /x?api_key=sk-abc123&access_token=zzz HTTP/1.1",))
        assert "sk-abc123" not in out
        assert "zzz" not in out

    def test_leaves_a_clean_request_line_untouched(self):
        out = self._filtered_message('%s - "%s" %d', ("127.0.0.1:1234", "GET /health HTTP/1.1", 200))
        assert out == '127.0.0.1:1234 - "GET /health HTTP/1.1" 200'

    def test_preserves_other_query_params_alongside_a_redacted_one(self):
        out = self._filtered_message('%s', ("GET /embed/chart/1?token=abc123&theme=dark HTTP/1.1",))
        assert "abc123" not in out
        assert "theme=dark" in out


class TestRequestIdLogRecordFactory:
    """Live bug this replaced: request_id was injected by a Filter attached
    only to whichever root-logger handler(s) existed at the moment main.py's
    startup code ran. Any record reaching a DIFFERENT handler (a library's own
    handler, a logger with propagate=False, or the root handler getting
    replaced by any later logging.basicConfig() call anywhere in the process)
    skipped the filter, and main.py's format string
    ("...[%(request_id)s]...") raised `ValueError: Formatting field not found
    in record: 'request_id'` the instant that record was formatted --
    surfacing as a crash inside logging's own formatter (e.g. "Failed to load
    messages" with a raw traceback) instead of the real error. A record
    factory runs inside Logger.makeRecord itself, before any handler/filter
    is chosen, so every record gets the attribute unconditionally."""

    def test_every_new_record_carries_request_id_regardless_of_logger_or_handler(self):
        import logging

        from src.core.request_id import install_request_id_log_record_factory

        original_factory = logging.getLogRecordFactory()
        try:
            install_request_id_log_record_factory()
            # A logger nobody configured a filter for -- exactly the class of
            # logger (a library's own, or one with propagate=False) that the
            # old per-handler Filter approach could silently miss.
            record = logging.getLogger("some.third.party.logger").makeRecord(
                "some.third.party.logger", logging.INFO, __file__, 1, "msg", (), None
            )
            assert hasattr(record, "request_id")
            # Must never raise -- this is the exact format string main.py uses.
            logging.Formatter("%(asctime)s %(levelname)s [%(request_id)s] %(name)s: %(message)s").format(record)
        finally:
            logging.setLogRecordFactory(original_factory)

    def test_installing_twice_does_not_double_wrap(self):
        import logging

        from src.core.request_id import install_request_id_log_record_factory

        original_factory = logging.getLogRecordFactory()
        try:
            install_request_id_log_record_factory()
            once_wrapped = logging.getLogRecordFactory()
            install_request_id_log_record_factory()
            assert logging.getLogRecordFactory() is once_wrapped
        finally:
            logging.setLogRecordFactory(original_factory)

    def test_request_id_defaults_to_dash_outside_a_request(self):
        import logging

        from src.core.request_id import install_request_id_log_record_factory

        original_factory = logging.getLogRecordFactory()
        try:
            install_request_id_log_record_factory()
            record = logging.getLogger(__name__).makeRecord(__name__, logging.INFO, __file__, 1, "msg", (), None)
            assert record.request_id == "-"
        finally:
            logging.setLogRecordFactory(original_factory)
