"""Identity carried into a data read.

Row security used to be applied in one HTTP handler, so every caller that
reached the query service directly — AI nodes, the chart service, dashboard
widgets — read data with no filter at all. Enforcement now lives in the
service, and this module is how a caller states who is asking.

A read is one of three things, and the service can tell them apart:

* ``QueryIdentity``  — a person is asking; their row filters apply.
* ``SystemQuery``    — no person is asking, and the caller says why. Recorded.
* ``None``           — nobody said. Denied on any source that configured row
                       security, because silence must not read as permission.

A fourth outcome is not about who is asking but what the answer is:
``RowSecurityDenied`` is raised when identity is known and the query is
understood, and the decision is still no.
"""

from __future__ import annotations

from dataclasses import dataclass, field
from types import MappingProxyType
from typing import Any, Mapping, Optional, Union


class RowSecurityIdentityRequired(Exception):
    """Raised instead of returning rows that were never filtered.

    This is deliberately an error and not an empty result: an empty result
    reads as "no matching data" and hides the misconfiguration.
    """


class RowSecurityDenied(Exception):
    """Raised when row security is understood and the answer is no.

    Distinct from RowSecurityIdentityRequired, which means the system does not
    know who is asking. This one means it knows exactly who is asking and the
    query is not permitted — an ungoverned table under a default-deny policy, or
    SQL that cannot be rewritten safely. The message is shown to the user, so it
    names the reason in plain language.
    """

    def __init__(self, reason: str, table: Optional[str] = None) -> None:
        super().__init__(reason)
        self.table = table


@dataclass(frozen=True)
class QueryIdentity:
    """The person on whose behalf a query runs."""

    user_id: str
    organization_id: Optional[str] = None
    project_id: Optional[str] = None
    token_payload: Mapping[str, Any] = field(
        default_factory=lambda: MappingProxyType({})
    )

    def __post_init__(self) -> None:
        if not str(self.user_id or "").strip():
            raise ValueError("QueryIdentity requires a non-empty user_id")


@dataclass(frozen=True)
class SystemQuery:
    """A read with no human behind it — a refresh job, a schema probe.

    The reason is mandatory so that unattributed access is greppable rather
    than indistinguishable from a caller that simply forgot to pass identity.
    """

    reason: str

    def __post_init__(self) -> None:
        if not str(self.reason or "").strip():
            raise ValueError("SystemQuery requires a reason")


QueryAccess = Union[QueryIdentity, SystemQuery, None]
