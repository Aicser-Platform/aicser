"""Validation for user-authored SQL *expressions* (not full statements) that get
interpolated into generated SQL -- calculated fields, semantic metric/dimension
expressions, and anything else in that shape.

SECURITY: these expressions are stored and reused across every future query
against the metric/field, unlike a one-off filter value -- an unvalidated
expression is a persistent SQL injection surface, not a one-time one. This
module is the single place that discipline lives, so every write path (CE
calc-fields, EE semantic metrics/dimensions) shares one set of rules instead
of each reimplementing (or forgetting to implement) its own.
"""

from __future__ import annotations

from typing import Optional

_DISALLOWED_NODE_NAMES = (
    "Select", "Subquery", "Union", "With", "Insert", "Update", "Delete",
    "Create", "Drop", "Alter", "Command", "Merge", "Grant", "Into",
)


class InvalidSQLExpressionError(ValueError):
    """Raised when a stored SQL expression fails validation."""


def validate_sql_expression(expression: str, *, dialect: Optional[str] = None, label: str = "Expression") -> str:
    """Validate `expression` is a single, statement-free SQL expression.

    Returns the original (unmodified) string on success -- deliberately not
    re-serialized, since round-tripping through sqlglot's generator could
    subtly change semantics the author actually typed. Raises
    InvalidSQLExpressionError with a message safe to show the caller.
    """
    raw = (expression or "").strip()
    if not raw:
        raise InvalidSQLExpressionError(f"{label} cannot be empty")

    # sqlglot's parse_one silently stops at the first statement boundary
    # rather than erroring on stacked statements -- `revenue; DROP TABLE
    # x; --` "successfully" parses as just `revenue`, while the full string
    # (including the trailing statement) is what actually gets stored and
    # later interpolated. Reject the raw text outright rather than relying
    # on the parser to notice.
    if ";" in raw:
        raise InvalidSQLExpressionError(f"{label} cannot contain multiple statements")
    if "--" in raw or "/*" in raw or "*/" in raw:
        raise InvalidSQLExpressionError(f"{label} cannot contain comments")

    try:
        import sqlglot
        from sqlglot import exp

        parsed = sqlglot.parse_one(raw, read=dialect)
    except Exception as exc:
        raise InvalidSQLExpressionError(f"{label} is not a valid SQL expression: {exc}") from exc

    if parsed is None:
        raise InvalidSQLExpressionError(f"{label} is not a valid SQL expression")

    if type(parsed).__name__ in _DISALLOWED_NODE_NAMES:
        raise InvalidSQLExpressionError(
            f"{label} must be a single expression (e.g. \"revenue - cost\"), not a SQL statement"
        )
    for node in parsed.walk():
        node_obj = node[0] if isinstance(node, tuple) else node
        if type(node_obj).__name__ in _DISALLOWED_NODE_NAMES:
            raise InvalidSQLExpressionError(
                f"{label} cannot contain subqueries, CTEs, or nested statements"
            )

    return raw
