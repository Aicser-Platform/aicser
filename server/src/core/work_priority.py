"""Whether the current work is interactive (someone is waiting on screen) or background
(worker jobs: scheduled reports, alert evaluation, queued analyses, re-indexing).

Shared, edition-neutral marker: the worker sets it for every job; capacity controls (e.g.
the EE LLM quota) read it to keep headroom for people over batch work.
"""

from __future__ import annotations

import contextvars
from contextlib import contextmanager
from typing import Iterator

INTERACTIVE = "interactive"
BACKGROUND = "background"

_priority: contextvars.ContextVar[str] = contextvars.ContextVar("work_priority", default=INTERACTIVE)


def current_priority() -> str:
    return _priority.get()


def is_background() -> bool:
    return _priority.get() == BACKGROUND


@contextmanager
def background_work() -> Iterator[None]:
    token = _priority.set(BACKGROUND)
    try:
        yield
    finally:
        _priority.reset(token)
