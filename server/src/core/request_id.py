"""Request-ID logging plumbing, deliberately dependency-free.

This has to be importable (and its install function callable) before
ANYTHING else in the app's startup sequence does any logging of its own --
including src.core.cache, which logs "Redis connection established" as a
side effect of being imported. src/main.py's log format string
("...[%(request_id)s]...") is unsafe against any record that doesn't carry
a request_id attribute, so the record factory below must be installed
*before* that format string is ever set, and *before* anything that might
log gets imported. Pulling this out of src/core/middleware.py (which
imports src.core.cache at module level) is what makes that ordering
possible -- see main.py's import of install_request_id_log_record_factory
from here specifically, not from middleware.
"""

import contextvars
import logging
from typing import Any

# A ContextVar (not a plain global) so concurrent requests handled on the
# same event loop never see each other's ID. Read by RequestIDLogFilter's
# replacement below and set per-request by RequestIDMiddleware (middleware.py).
REQUEST_ID: contextvars.ContextVar[str] = contextvars.ContextVar("request_id", default="-")


def install_request_id_log_record_factory() -> None:
    """Guarantees every LogRecord created anywhere in this process carries a
    %(request_id)s attribute, by wrapping the *record factory* Logger.makeRecord
    calls to construct records -- not a per-handler Filter.

    RELIABILITY: this used to be a Filter attached only to the root logger's
    handler(s), installed *after* logging.basicConfig() had already set the
    request_id-requiring format string and *after* importing a module
    (src.core.middleware) that itself imports src.core.cache, which logs a
    message as a side effect of being imported. Any record created before the
    filter/factory was in place skipped it entirely, and the format string
    then raised `ValueError: Formatting field not found in record:
    'request_id'` the instant that record was formatted -- live-reproduced
    both as a first-class request crashing with a raw traceback (e.g. "Failed
    to load messages") and, worse, during the app's own startup sequence
    (Redis connection logging fired mid-import, before the fix — even
    installed as a record factory in main.py — had run). Fixed by making this
    module import-cheap enough to install first, before logging.basicConfig()
    itself. Safe to call more than once (idempotent — wraps only once).
    """
    current_factory = logging.getLogRecordFactory()
    if getattr(current_factory, "_aicser_request_id_wrapped", False):
        return

    def _factory(*args: Any, **kwargs: Any) -> logging.LogRecord:
        record = current_factory(*args, **kwargs)
        record.request_id = REQUEST_ID.get()
        return record

    _factory._aicser_request_id_wrapped = True  # type: ignore[attr-defined]
    logging.setLogRecordFactory(_factory)
