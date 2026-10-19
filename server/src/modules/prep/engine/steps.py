"""Transform step catalog."""

from __future__ import annotations

import re
from typing import Any, ClassVar, Dict, List, Optional, Type

from pydantic import BaseModel

_IDENT_RE = re.compile(r'^[^"\\\x00]+$')


def quote_ident(name: str) -> str:
    """Double-quote an identifier from user YAML."""
    if not name or not _IDENT_RE.match(name):
        raise ValueError(f"invalid identifier: {name!r}")
    return f'"{name}"'


def quote_idents(names: List[str]) -> str:
    return ", ".join(quote_ident(name) for name in names)


class CompileContext(BaseModel):
    dialect: str = "duckdb"
    index: int = 0


class Step(BaseModel):
    kind: ClassVar[str] = ""
    group: ClassVar[str] = ""
    label: ClassVar[str] = ""

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        raise NotImplementedError


STEP_REGISTRY: Dict[str, Type[Step]] = {}


def register(cls: Type[Step]) -> Type[Step]:
    STEP_REGISTRY[cls.kind] = cls
    return cls


def parse_step(raw: Dict[str, Any]) -> Step:
    """Parse the single-key YAML form, e.g. {"filter": {"where": "..."}}."""
    if not isinstance(raw, dict) or len(raw) != 1:
        raise ValueError(
            f"a transform step must be a mapping with exactly one key, got {raw!r}"
        )
    kind, payload = next(iter(raw.items()))
    cls = STEP_REGISTRY.get(kind)
    if cls is None:
        known_steps = ", ".join(sorted(STEP_REGISTRY))
        raise ValueError(f"unknown transform step {kind!r}; known steps: {known_steps}")
    if isinstance(payload, dict):
        # YAML 1.1 reads a bare `on:` key as the boolean True, so a hand-written
        # join step arrives as {True: {...}} and fails to construct
        if kind == "join" and True in payload and "on" not in payload:
            payload = {("on" if k is True else k): v for k, v in payload.items()}
        if kind in ("cast", "derive", "rename") and "columns" not in payload:
            payload = {"columns": payload}
        elif kind == "fill_na" and "values" not in payload:
            payload = {"values": payload}
    return cls(**(payload or {}))


@register
class SelectStep(Step):
    kind: ClassVar[str] = "select"
    group: ClassVar[str] = "shape"
    label: ClassVar[str] = "Keep columns"
    columns: List[str]

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        return f"SELECT {quote_idents(self.columns)} FROM {source}"


@register
class DropStep(Step):
    kind: ClassVar[str] = "drop"
    group: ClassVar[str] = "shape"
    label: ClassVar[str] = "Drop columns"
    columns: List[str]

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        return f"SELECT * EXCLUDE ({quote_idents(self.columns)}) FROM {source}"


@register
class RenameStep(Step):
    kind: ClassVar[str] = "rename"
    group: ClassVar[str] = "shape"
    label: ClassVar[str] = "Rename columns"
    columns: Dict[str, str]

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        pairs = ", ".join(
            f"{quote_ident(old)} AS {quote_ident(new)}"
            for old, new in self.columns.items()
        )
        return f"SELECT * RENAME ({pairs}) FROM {source}"


@register
class SortStep(Step):
    kind: ClassVar[str] = "sort"
    group: ClassVar[str] = "shape"
    label: ClassVar[str] = "Sort rows"
    by: List[str]
    desc: bool = False

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        direction = "DESC" if self.desc else "ASC"
        order = ", ".join(f"{quote_ident(column)} {direction}" for column in self.by)
        return f"SELECT * FROM {source} ORDER BY {order}"


@register
class LimitStep(Step):
    kind: ClassVar[str] = "limit"
    group: ClassVar[str] = "shape"
    label: ClassVar[str] = "Limit rows"
    n: int

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        return f"SELECT * FROM {source} LIMIT {int(self.n)}"


# Cast targets are validated against an allow-list: the type text is interpolated
# into SQL, so a free-form string would be an injection point.
ALLOWED_CAST_TYPES = re.compile(
    r"^(?:boolean|tinyint|smallint|integer|int|bigint|hugeint|"
    r"float|double|real|decimal\(\d{1,2},\s*\d{1,2}\)|numeric\(\d{1,2},\s*\d{1,2}\)|"
    r"varchar|text|string|date|time|timestamp|timestamptz|uuid|json|blob)$",
    re.IGNORECASE,
)


def _validate_expression(expr: str, what: str) -> str:
    """Reject anything that could terminate the statement or start a comment."""
    if ";" in expr or "--" in expr or "/*" in expr:
        raise ValueError(f"{what} must be a single boolean expression, got {expr!r}")
    return expr


@register
class FilterStep(Step):
    kind: ClassVar[str] = "filter"
    group: ClassVar[str] = "shape"
    label: ClassVar[str] = "Filter rows"
    where: str

    def model_post_init(self, __context: Any) -> None:
        _validate_expression(self.where, "filter.where")

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        return f"SELECT * FROM {source} WHERE {self.where}"


@register
class CastStep(Step):
    kind: ClassVar[str] = "cast"
    group: ClassVar[str] = "clean"
    label: ClassVar[str] = "Change column types"
    columns: Dict[str, str]

    def model_post_init(self, __context: Any) -> None:
        for col, target in self.columns.items():
            if not ALLOWED_CAST_TYPES.match(target.strip()):
                raise ValueError(f"unsupported cast type for {col!r}: {target!r}")

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        # Bad values become NULL instead of failing the whole run.
        parts = ", ".join(
            f"TRY_CAST({quote_ident(c)} AS {t}) AS {quote_ident(c)}"
            for c, t in self.columns.items()
        )
        return f"SELECT * REPLACE ({parts}) FROM {source}"


@register
class CleanStep(Step):
    kind: ClassVar[str] = "clean"
    group: ClassVar[str] = "clean"
    label: ClassVar[str] = "Clean values"
    columns: List[str]
    nulls: List[str] = []
    trim: bool = False
    lower: bool = False
    currency: bool = False

    def _expr(self, col: str) -> str:
        expr = quote_ident(col)
        if self.currency:
            # Strip currency symbols, thousands separators, percent signs and spaces.
            expr = f"regexp_replace({expr}, '[$,%\\s]', '', 'g')"
        if self.trim:
            expr = f"TRIM({expr})"
        if self.lower:
            expr = f"LOWER({expr})"
        for token in self.nulls:
            escaped = token.replace("'", "''")
            expr = f"NULLIF({expr}, '{escaped}')"
        return expr

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        parts = ", ".join(f"{self._expr(c)} AS {quote_ident(c)}" for c in self.columns)
        return f"SELECT * REPLACE ({parts}) FROM {source}"


@register
class FillNaStep(Step):
    kind: ClassVar[str] = "fill_na"
    group: ClassVar[str] = "clean"
    label: ClassVar[str] = "Fill missing values"
    values: Dict[str, Any]

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        def lit(v: Any) -> str:
            if v is None:
                return "NULL"
            if isinstance(v, bool):
                return "TRUE" if v else "FALSE"
            if isinstance(v, (int, float)):
                return str(v)
            return "'" + str(v).replace("'", "''") + "'"

        parts = ", ".join(
            f"COALESCE({quote_ident(c)}, {lit(v)}) AS {quote_ident(c)}"
            for c, v in self.values.items()
        )
        return f"SELECT * REPLACE ({parts}) FROM {source}"


@register
class DedupeStep(Step):
    kind: ClassVar[str] = "dedupe"
    group: ClassVar[str] = "clean"
    label: ClassVar[str] = "Remove duplicates"
    keys: List[str] = []
    order_by: str | None = None
    keep: str = "first"

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        if not self.keys:
            return f"SELECT DISTINCT * FROM {source}"

        partition = quote_idents(self.keys)
        if self.order_by:
            direction = "DESC" if self.keep == "last" else "ASC"
            order = f"{quote_ident(self.order_by)} {direction}"
        else:
            order = "1"
        return (
            f"SELECT * EXCLUDE (_rn) FROM ("
            "SELECT *, ROW_NUMBER() OVER "
            f"(PARTITION BY {partition} ORDER BY {order}) AS _rn "
            f"FROM {source}) WHERE _rn = 1"
        )


AGG_FUNCTIONS = {
    "sum": "SUM",
    "count": "COUNT",
    "avg": "AVG",
    "min": "MIN",
    "max": "MAX",
}
JOIN_TYPES = {
    "inner": "INNER",
    "left": "LEFT",
    "right": "RIGHT",
    "full": "FULL OUTER",
}


@register
class DeriveStep(Step):
    kind: ClassVar[str] = "derive"
    group: ClassVar[str] = "derive"
    label: ClassVar[str] = "Add calculated column"
    columns: Dict[str, str]

    def model_post_init(self, __context: Any) -> None:
        for name, expr in self.columns.items():
            _validate_expression(expr, f"derive.{name}")

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        parts = ", ".join(
            f"{expr} AS {quote_ident(name)}" for name, expr in self.columns.items()
        )
        return f"SELECT *, {parts} FROM {source}"


@register
class AggregateStep(Step):
    kind: ClassVar[str] = "aggregate"
    group: ClassVar[str] = "reshape"
    label: ClassVar[str] = "Group and aggregate"
    by: List[str] = []
    sum: List[str] = []
    count: List[str] = []
    avg: List[str] = []
    min: List[str] = []
    max: List[str] = []

    def model_post_init(self, __context: Any) -> None:
        if not (self.sum or self.count or self.avg or self.min or self.max):
            raise ValueError(
                "aggregate requires at least one measure (sum/count/avg/min/max)"
            )

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        selects = [quote_ident(c) for c in self.by]
        for key, fn in AGG_FUNCTIONS.items():
            for col in getattr(self, key):
                selects.append(f"{fn}({quote_ident(col)}) AS {quote_ident(col)}")

        sql = f"SELECT {', '.join(selects)} FROM {source}"
        if self.by:
            sql += f" GROUP BY {quote_idents(self.by)}"
        return sql


@register
class JoinStep(Step):
    kind: ClassVar[str] = "join"
    group: ClassVar[str] = "combine"
    label: ClassVar[str] = "Join another asset"
    asset: str
    how: str = "left"
    on: Dict[str, str]

    def model_post_init(self, __context: Any) -> None:
        if self.how not in JOIN_TYPES:
            raise ValueError(
                f"unsupported join type {self.how!r}; use one of {sorted(JOIN_TYPES)}"
            )
        if not self.on:
            raise ValueError("join requires at least one `on` pair")

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        alias = f"j{ctx.index}"
        conditions = " AND ".join(
            f"{source}.{quote_ident(left)} = {alias}.{quote_ident(right)}"
            for left, right in self.on.items()
        )
        excluded = quote_idents(list(self.on.values()))
        return (
            f"SELECT {source}.*, {alias}.* EXCLUDE ({excluded}) FROM {source} "
            f"{JOIN_TYPES[self.how]} JOIN {self.asset} AS {alias} ON {conditions}"
        )


@register
class UnionStep(Step):
    kind: ClassVar[str] = "union"
    group: ClassVar[str] = "combine"
    label: ClassVar[str] = "Union another asset"
    asset: str
    all: bool = True

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        op = "UNION ALL" if self.all else "UNION"
        return f"SELECT * FROM {source} {op} BY NAME SELECT * FROM {self.asset}"


@register
class PivotStep(Step):
    kind: ClassVar[str] = "pivot"
    group: ClassVar[str] = "reshape"
    label: ClassVar[str] = "Pivot"
    on: str
    using: str
    agg: str = "sum"
    group_by: List[str] = []

    def model_post_init(self, __context: Any) -> None:
        if self.agg not in AGG_FUNCTIONS:
            raise ValueError(f"unsupported pivot aggregate {self.agg!r}")

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        sql = (
            f"PIVOT {source} ON {quote_ident(self.on)} "
            f"USING {self.agg}({quote_ident(self.using)})"
        )
        if self.group_by:
            sql += f" GROUP BY {quote_idents(self.group_by)}"
        return sql


@register
class UnpivotStep(Step):
    kind: ClassVar[str] = "unpivot"
    group: ClassVar[str] = "reshape"
    label: ClassVar[str] = "Unpivot"
    columns: List[str]
    name_column: str = "name"
    value_column: str = "value"

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        return (
            f"UNPIVOT {source} ON {quote_idents(self.columns)} "
            f"INTO NAME {quote_ident(self.name_column)} "
            f"VALUE {quote_ident(self.value_column)}"
        )


@register
class ScaleStep(Step):
    kind: ClassVar[str] = "scale"
    group: ClassVar[str] = "reshape"
    label: ClassVar[str] = "Scale values"
    columns: List[str]
    method: str = "minmax"

    def model_post_init(self, __context: Any) -> None:
        if self.method not in ("minmax", "zscore"):
            raise ValueError(
                f"unsupported scale method {self.method!r}; use minmax or zscore"
            )

    def _expr(self, col: str) -> str:
        c = quote_ident(col)
        if self.method == "minmax":
            return (
                f"({c} - MIN({c}) OVER ()) / "
                f"NULLIF(MAX({c}) OVER () - MIN({c}) OVER (), 0)"
            )
        return f"({c} - AVG({c}) OVER ()) / " f"NULLIF(STDDEV_POP({c}) OVER (), 0)"

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        parts = ", ".join(f"{self._expr(c)} AS {quote_ident(c)}" for c in self.columns)
        return f"SELECT * REPLACE ({parts}) FROM {source}"


@register
class FillDownStep(Step):
    """Carry the last present value down empty cells, like a spreadsheet fill."""

    kind: ClassVar[str] = "fill_down"
    group: ClassVar[str] = "clean"
    label: ClassVar[str] = "Fill down"
    columns: List[str]
    order_by: Optional[str] = None
    partition_by: List[str] = []

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        order = quote_ident(self.order_by) if self.order_by else "1"
        partition = (
            f"PARTITION BY {quote_idents(self.partition_by)} "
            if self.partition_by
            else ""
        )
        window = (
            f"{partition}ORDER BY {order} "
            "ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW"
        )
        parts = ", ".join(
            f"last_value({quote_ident(c)} IGNORE NULLS) OVER ({window}) AS {quote_ident(c)}"
            for c in self.columns
        )
        return f"SELECT * REPLACE ({parts}) FROM {source}"


@register
class ClusterStep(Step):
    """Rewrite messy labels to one official spelling (USA → United States)."""

    kind: ClassVar[str] = "cluster"
    group: ClassVar[str] = "clean"
    label: ClassVar[str] = "Group similar values"
    column: str
    mapping: Dict[str, str]

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        col = quote_ident(self.column)
        if not self.mapping:
            return f"SELECT * FROM {source}"
        branches = " ".join(
            f"WHEN '{str(raw).replace(chr(39), chr(39)+chr(39))}' THEN "
            f"'{str(canon).replace(chr(39), chr(39)+chr(39))}'"
            for raw, canon in self.mapping.items()
        )
        expr = f"CASE TRIM(CAST({col} AS VARCHAR)) {branches} ELSE {col} END"
        return f"SELECT * REPLACE ({expr} AS {col}) FROM {source}"


@register
class SqlStep(Step):
    kind: ClassVar[str] = "sql"
    group: ClassVar[str] = "escape"
    label: ClassVar[str] = "Raw SQL"
    query: str

    def model_post_init(self, __context: Any) -> None:
        if "{input}" not in self.query:
            raise ValueError("sql step must reference the previous step as {input}")
        if ";" in self.query:
            raise ValueError("sql step must be a single statement")

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        return self.query.replace("{input}", source)


@register
class ValidateStep(Step):
    """Data-quality expectations."""

    kind: ClassVar[str] = "validate"
    group: ClassVar[str] = "validate"
    label: ClassVar[str] = "Validate rows"
    not_null: List[str] = []
    unique: List[str] = []
    accepted_values: Dict[str, List[Any]] = {}
    range: Dict[str, List[Any]] = {}
    regex: Dict[str, str] = {}
    expr: Optional[str] = None
    on_fail: str = "warn"

    def model_post_init(self, __context: Any) -> None:
        if not any(
            [
                self.not_null,
                self.unique,
                self.accepted_values,
                self.range,
                self.regex,
                self.expr,
            ]
        ):
            raise ValueError("validate requires at least one rule")
        if self.on_fail not in ("warn", "quarantine", "fail"):
            raise ValueError(f"unsupported on_fail {self.on_fail!r}")
        if self.expr:
            _validate_expression(self.expr, "validate.expr")

    def _rules(self) -> List[tuple[str, str]]:
        """(rule_name, pass_predicate) pairs."""
        out: List[tuple[str, str]] = []

        for col in self.not_null:
            out.append((f"not_null:{col}", f"({quote_ident(col)} IS NOT NULL)"))

        for col in self.unique:
            out.append(
                (
                    f"unique:{col}",
                    f"(COUNT(*) OVER (PARTITION BY {quote_ident(col)}) = 1)",
                )
            )

        for col, values in self.accepted_values.items():
            literals = ", ".join("'" + str(v).replace("'", "''") + "'" for v in values)
            out.append(
                (
                    f"accepted_values:{col}",
                    f"({quote_ident(col)} IN ({literals}))",
                )
            )

        for col, bounds in self.range.items():
            lo, hi = bounds[0], bounds[1]
            out.append((f"range:{col}", f"({quote_ident(col)} BETWEEN {lo} AND {hi})"))

        for col, pattern in self.regex.items():
            escaped = pattern.replace("'", "''")
            out.append(
                (
                    f"regex:{col}",
                    f"(regexp_matches({quote_ident(col)}, '{escaped}'))",
                )
            )

        if self.expr:
            out.append(("expr", f"({self.expr})"))

        return out

    def predicate_sql(self) -> str:
        return " AND ".join(pred for _, pred in self._rules())

    def failure_reason_sql(self) -> str:
        branches = " ".join(
            f"WHEN NOT {pred} THEN '{name}'" for name, pred in self._rules()
        )
        return f"CASE {branches} ELSE 'unknown' END"

    def _uses_window(self) -> bool:
        # `unique` is a COUNT(*) OVER (...) rule; window functions are not
        # allowed in WHERE, so those predicates are evaluated as a column first.
        return bool(self.unique)

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        if self.on_fail == "warn":
            return f"SELECT * FROM {source}"
        if self.on_fail == "quarantine":
            if self._uses_window():
                return (
                    f"SELECT * EXCLUDE (_validation_ok) FROM ("
                    f"SELECT *, ({self.predicate_sql()}) AS _validation_ok FROM {source}"
                    f") WHERE _validation_ok"
                )
            return f"SELECT * FROM {source} WHERE {self.predicate_sql()}"
        return (
            f"SELECT * EXCLUDE (_validation_check) FROM ("
            f"SELECT *, CASE WHEN NOT ({self.predicate_sql()}) "
            f"THEN error('validation failed: ' || {self.failure_reason_sql()}) "
            f"ELSE NULL END AS _validation_check FROM {source})"
        )

    def quarantine_cte(self, source: str, ctx: CompileContext) -> str:
        if self._uses_window():
            return (
                f"SELECT * EXCLUDE (_validation_ok) FROM ("
                f"SELECT *, ({self.predicate_sql()}) AS _validation_ok, "
                f"{self.failure_reason_sql()} AS _quarantine_reason FROM {source}"
                f") WHERE NOT (_validation_ok)"
            )
        return (
            f"SELECT *, {self.failure_reason_sql()} AS _quarantine_reason "
            f"FROM {source} WHERE NOT ({self.predicate_sql()})"
        )


def _sql_str(value: Any) -> str:
    return "'" + str(value).replace("'", "''") + "'"


@register
class ExtractStep(Step):
    """Pull part of a text value into a new column with a pattern."""

    kind: ClassVar[str] = "extract"
    group: ClassVar[str] = "derive"
    label: ClassVar[str] = "Extract text"
    column: str
    pattern: str
    into: str
    group_index: int = 0

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        col = f"CAST({quote_ident(self.column)} AS VARCHAR)"
        expr = f"NULLIF(regexp_extract({col}, {_sql_str(self.pattern)}, {int(self.group_index)}), '')"
        return f"SELECT *, {expr} AS {quote_ident(self.into)} FROM {source}"


@register
class ConcatStep(Step):
    """Join several columns into one text column."""

    kind: ClassVar[str] = "concat"
    group: ClassVar[str] = "derive"
    label: ClassVar[str] = "Combine columns"
    columns: List[str]
    into: str
    separator: str = " "

    def model_post_init(self, __context: Any) -> None:
        if len(self.columns) < 2:
            raise ValueError("concat needs at least two columns")

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        cols = ", ".join(f"CAST({quote_ident(c)} AS VARCHAR)" for c in self.columns)
        return f"SELECT *, concat_ws({_sql_str(self.separator)}, {cols}) AS {quote_ident(self.into)} FROM {source}"


MASK_METHODS = ("hash", "redact", "last4")


@register
class MaskStep(Step):
    """Hide personal data while keeping the column usable for joins and counts."""

    kind: ClassVar[str] = "mask"
    group: ClassVar[str] = "clean"
    label: ClassVar[str] = "Mask personal data"
    columns: List[str]
    method: str = "hash"

    def model_post_init(self, __context: Any) -> None:
        if self.method not in MASK_METHODS:
            raise ValueError(f"unsupported mask method {self.method!r}; use one of {MASK_METHODS}")

    def _expr(self, c: str) -> str:
        col = f"CAST({quote_ident(c)} AS VARCHAR)"
        if self.method == "hash":
            return f"CASE WHEN {col} IS NULL THEN NULL ELSE md5({col}) END"
        if self.method == "last4":
            return f"CASE WHEN {col} IS NULL THEN NULL ELSE repeat('*', greatest(length({col}) - 4, 0)) || right({col}, 4) END"
        return f"CASE WHEN {col} IS NULL THEN NULL ELSE '[redacted]' END"

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        parts = ", ".join(f"{self._expr(c)} AS {quote_ident(c)}" for c in self.columns)
        return f"SELECT * REPLACE ({parts}) FROM {source}"


_JSON_PATH_RE = re.compile(r"^\$(\.[A-Za-z_][A-Za-z0-9_]*|\[\d+\]|\.\"[^\"']+\")*$")


@register
class FlattenJsonStep(Step):
    """Turn fields inside a JSON column into their own columns."""

    kind: ClassVar[str] = "flatten_json"
    group: ClassVar[str] = "reshape"
    label: ClassVar[str] = "Flatten JSON"
    column: str
    fields: Dict[str, str]  # new column -> JSON path, e.g. {"city": "$.address.city"}
    keep_original: bool = False

    def model_post_init(self, __context: Any) -> None:
        if not self.fields:
            raise ValueError("flatten_json needs at least one field")
        for name, path in self.fields.items():
            if not _JSON_PATH_RE.match(path):
                raise ValueError(f"invalid JSON path for {name!r}: {path!r}")

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        col = f"CAST({quote_ident(self.column)} AS JSON)"
        parts = ", ".join(
            f"json_extract_string({col}, {_sql_str(path)}) AS {quote_ident(name)}"
            for name, path in self.fields.items()
        )
        base = "*" if self.keep_original else f"* EXCLUDE ({quote_ident(self.column)})"
        return f"SELECT {base}, {parts} FROM {source}"


@register
class ExplodeStep(Step):
    """One row per item of a list or JSON array column."""

    kind: ClassVar[str] = "explode"
    group: ClassVar[str] = "reshape"
    label: ClassVar[str] = "Expand list into rows"
    column: str
    json: bool = True

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        col = quote_ident(self.column)
        items = f"json_extract(CAST({col} AS JSON), '$[*]')" if self.json else col
        return f"SELECT * REPLACE (UNNEST({items}) AS {col}) FROM {source}"


# ---------------------------------------------------------------------------
# Typed parsing shared by set_types, parse_date and parse_number.
# ---------------------------------------------------------------------------

_FORMAT_RE = re.compile(r"^[%A-Za-z0-9 ,./:_\-TZ+]{1,40}$")


def _check_format(fmt: str) -> str:
    if not _FORMAT_RE.match(fmt or "") or "%" not in fmt:
        raise ValueError(f"invalid date format {fmt!r}; use codes like %d-%b-%Y")
    return fmt


def date_expr(col_sql: str, formats: List[str], *, with_time: bool = False, excel_serial: bool = False) -> str:
    """Text to DATE/TIMESTAMP trying every format; values that match none become empty."""
    fmts = [_check_format(f) for f in formats if f]
    text = f"CAST({col_sql} AS VARCHAR)"
    parts = []
    if excel_serial:
        parts.append(
            f"CASE WHEN TRY_CAST({text} AS DOUBLE) BETWEEN 1 AND 2958465 "
            f"THEN CAST(DATE '1899-12-30' + CAST(floor(TRY_CAST({text} AS DOUBLE)) AS INTEGER) AS TIMESTAMP) END"
        )
    if fmts:
        listed = ", ".join(_sql_str(f) for f in fmts)
        parts.append(f"TRY_STRPTIME(trim({text}), [{listed}])")
    # Values that are already dates (or ISO text) keep working.
    parts.append(f"TRY_CAST({col_sql} AS TIMESTAMP)")
    expr = f"COALESCE({', '.join(parts)})"
    return expr if with_time else f"CAST({expr} AS DATE)"


def number_expr(col_sql: str, *, locale: str = "us", percent: bool = True) -> str:
    """'1,234.50', '$99', '(45)', '12%' and '1.234,50' (eu) as numbers."""
    if locale not in ("us", "eu"):
        raise ValueError("number locale must be 'us' or 'eu'")
    text = f"trim(CAST({col_sql} AS VARCHAR))"
    digits = f"regexp_replace({text}, '[^0-9,.\\-]', '', 'g')"
    if locale == "eu":
        digits = f"replace(replace({digits}, '.', ''), ',', '.')"
    else:
        digits = f"replace({digits}, ',', '')"
    value = f"TRY_CAST({digits} AS DOUBLE)"
    value = f"(CASE WHEN regexp_matches({text}, '^\\(.*\\)$') THEN -abs({value}) ELSE {value} END)"
    if percent:
        value = f"(CASE WHEN {text} LIKE '%\\%%' ESCAPE '\\' THEN {value} / 100.0 ELSE {value} END)"
    return value


def boolean_expr(col_sql: str, true_values: List[str], false_values: List[str]) -> str:
    text = f"lower(trim(CAST({col_sql} AS VARCHAR)))"
    t = ", ".join(_sql_str(v.lower()) for v in true_values)
    f = ", ".join(_sql_str(v.lower()) for v in false_values)
    return f"(CASE WHEN {text} IN ({t}) THEN TRUE WHEN {text} IN ({f}) THEN FALSE END)"


TRUE_WORDS = ["true", "yes", "y", "1", "t"]
FALSE_WORDS = ["false", "no", "n", "0", "f"]
TYPE_NAMES = ("text", "integer", "number", "decimal", "boolean", "date", "datetime")


def typed_expr(col_sql: str, spec: Dict[str, Any]) -> str:
    kind = spec.get("type")
    if kind == "text":
        return f"CAST({col_sql} AS VARCHAR)"
    if kind == "number":
        return number_expr(col_sql, locale=spec.get("locale", "us"), percent=spec.get("percent", True))
    if kind == "integer":
        return f"CAST(round({number_expr(col_sql, locale=spec.get('locale', 'us'), percent=False)}) AS BIGINT)"
    if kind == "decimal":
        return f"CAST({number_expr(col_sql, locale=spec.get('locale', 'us'), percent=spec.get('percent', True))} AS DECIMAL(18, 2))"
    if kind == "boolean":
        return boolean_expr(col_sql, spec.get("true_values") or TRUE_WORDS, spec.get("false_values") or FALSE_WORDS)
    if kind in ("date", "datetime"):
        return date_expr(col_sql, list(spec.get("formats") or []), with_time=kind == "datetime",
                         excel_serial=bool(spec.get("excel_serial")))
    raise ValueError(f"unsupported type {kind!r}; use one of {TYPE_NAMES}")


@register
class SetTypesStep(Step):
    """Give columns their real types, reading messy text the way people write it."""

    kind: ClassVar[str] = "set_types"
    group: ClassVar[str] = "clean"
    label: ClassVar[str] = "Set column types"
    columns: Dict[str, Dict[str, Any]]

    def model_post_init(self, __context: Any) -> None:
        if not self.columns:
            raise ValueError("set_types needs at least one column")
        for col, spec in self.columns.items():
            typed_expr(quote_ident(col), spec)  # validates

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        parts = ", ".join(f"{typed_expr(quote_ident(c), spec)} AS {quote_ident(c)}" for c, spec in self.columns.items())
        return f"SELECT * REPLACE ({parts}) FROM {source}"


@register
class ParseDateStep(Step):
    """Read text dates in one or more formats; values that match none become empty."""

    kind: ClassVar[str] = "parse_date"
    group: ClassVar[str] = "clean"
    label: ClassVar[str] = "Parse dates"
    columns: List[str]
    format: Optional[str] = None
    formats: List[str] = []
    with_time: bool = False
    excel_serial: bool = False

    def model_post_init(self, __context: Any) -> None:
        if not (self.formats or self.format or self.excel_serial):
            raise ValueError("parse_date needs at least one format")
        self._fmts()

    def _fmts(self) -> List[str]:
        return [_check_format(f) for f in ([self.format] if self.format else []) + list(self.formats)]

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        parts = ", ".join(
            f"{date_expr(quote_ident(c), self._fmts(), with_time=self.with_time, excel_serial=self.excel_serial)} AS {quote_ident(c)}"
            for c in self.columns
        )
        return f"SELECT * REPLACE ({parts}) FROM {source}"


@register
class ParseNumberStep(Step):
    """Read numbers written with separators, currency, brackets or percent signs."""

    kind: ClassVar[str] = "parse_number"
    group: ClassVar[str] = "clean"
    label: ClassVar[str] = "Parse numbers"
    columns: List[str]
    locale: str = "us"
    percent: bool = True

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        parts = ", ".join(
            f"{number_expr(quote_ident(c), locale=self.locale, percent=self.percent)} AS {quote_ident(c)}" for c in self.columns
        )
        return f"SELECT * REPLACE ({parts}) FROM {source}"


CASES = ("upper", "lower", "title", "sentence")


@register
class ChangeCaseStep(Step):
    kind: ClassVar[str] = "change_case"
    group: ClassVar[str] = "clean"
    label: ClassVar[str] = "Change text case"
    columns: List[str]
    case: str = "title"

    def model_post_init(self, __context: Any) -> None:
        if self.case not in CASES:
            raise ValueError(f"unsupported case {self.case!r}; use one of {CASES}")

    def _expr(self, c: str) -> str:
        text = f"CAST({quote_ident(c)} AS VARCHAR)"
        if self.case == "upper":
            return f"upper({text})"
        if self.case == "lower":
            return f"lower({text})"
        if self.case == "sentence":
            return f"(upper(left({text}, 1)) || lower(substr({text}, 2)))"
        return f"array_to_string(list_transform(string_split(lower({text}), ' '), w -> upper(w[1]) || w[2:]), ' ')"

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        parts = ", ".join(f"{self._expr(c)} AS {quote_ident(c)}" for c in self.columns)
        return f"SELECT * REPLACE ({parts}) FROM {source}"


SPLIT_MODES = ("delimiter", "whitespace", "positions", "rows")


@register
class SplitStep(Step):
    """Split one text column into several columns, or into rows."""

    kind: ClassVar[str] = "split"
    group: ClassVar[str] = "reshape"
    label: ClassVar[str] = "Split column"
    column: str
    mode: str = "delimiter"
    delimiter: str = ","
    positions: List[int] = []
    into: List[str] = []
    parts: int = 2
    keep_original: bool = False

    def model_post_init(self, __context: Any) -> None:
        if self.mode not in SPLIT_MODES:
            raise ValueError(f"unsupported split mode {self.mode!r}; use one of {SPLIT_MODES}")
        if self.mode == "delimiter" and not self.delimiter:
            raise ValueError("split needs a delimiter")
        if self.mode == "positions" and not self.positions:
            raise ValueError("split by position needs at least one position")

    def _names(self, count: int) -> List[str]:
        names = list(self.into)
        while len(names) < count:
            names.append(f"{self.column}_{len(names) + 1}")
        return names[:count]

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        col = f"CAST({quote_ident(self.column)} AS VARCHAR)"
        if self.mode == "rows":
            pieces = (
                f"regexp_split_to_array(trim({col}), '\\s+')" if not self.delimiter.strip() and self.delimiter
                else f"string_split({col}, {_sql_str(self.delimiter)})"
            )
            return f"SELECT * REPLACE (trim(UNNEST({pieces})) AS {quote_ident(self.column)}) FROM {source}"
        if self.mode == "positions":
            cuts = [0] + sorted(int(p) for p in self.positions if int(p) > 0)
            names = self._names(len(cuts))
            exprs = []
            for i, start in enumerate(cuts):
                length = f", {cuts[i + 1] - start}" if i + 1 < len(cuts) else ""
                exprs.append(f"NULLIF(trim(substr({col}, {start + 1}{length})), '') AS {quote_ident(names[i])}")
        else:
            count = max(len(self.into), int(self.parts), 1)
            names = self._names(count)
            if self.mode == "whitespace":
                arr = f"regexp_split_to_array(trim({col}), '\\s+')"
            else:
                arr = f"string_split({col}, {_sql_str(self.delimiter)})"
            exprs = []
            for i, name in enumerate(names):
                # The last column keeps the rest, so nothing is silently dropped.
                if i == count - 1:
                    piece = f"array_to_string({arr}[{i + 1}:], {_sql_str(' ' if self.mode == 'whitespace' else self.delimiter)})"
                else:
                    piece = f"{arr}[{i + 1}]"
                exprs.append(f"NULLIF(trim({piece}), '') AS {quote_ident(name)}")
        base = "*" if self.keep_original else f"* EXCLUDE ({quote_ident(self.column)})"
        return f"SELECT {base}, {', '.join(exprs)} FROM {source}"


MATCH_MODES = ("contains", "whole", "regex")


@register
class ReplaceStep(Step):
    """Replace text: one pair or a list of pairs, partial or whole-value, any case."""

    kind: ClassVar[str] = "replace"
    group: ClassVar[str] = "clean"
    label: ClassVar[str] = "Replace values"
    columns: List[str]
    find: Optional[str] = None
    replace_with: str = ""
    mapping: Dict[str, str] = {}
    match: str = "contains"
    regex: bool = False
    case_sensitive: bool = True

    def model_post_init(self, __context: Any) -> None:
        if self.regex:
            self.match = "regex"
        if self.match not in MATCH_MODES:
            raise ValueError(f"unsupported match {self.match!r}; use one of {MATCH_MODES}")
        if not self._pairs():
            raise ValueError("replace needs something to find")

    def _pairs(self) -> List[tuple[str, str]]:
        pairs = list(self.mapping.items())
        if self.find is not None and self.find != "":
            pairs.insert(0, (self.find, self.replace_with))
        return pairs

    def _expr(self, c: str) -> str:
        expr = f"CAST({quote_ident(c)} AS VARCHAR)"
        if self.match == "whole":
            cmp = expr if self.case_sensitive else f"lower(trim({expr}))"
            whens = " ".join(
                f"WHEN {cmp} = {_sql_str(old if self.case_sensitive else old.strip().lower())} THEN {_sql_str(new)}"
                for old, new in self._pairs()
            )
            return f"(CASE {whens} ELSE {expr} END)"
        for old, new in self._pairs():
            if self.match == "regex":
                pattern = old if self.case_sensitive else f"(?i){old}"
                expr = f"regexp_replace({expr}, {_sql_str(pattern)}, {_sql_str(new)}, 'g')"
            elif self.case_sensitive:
                expr = f"replace({expr}, {_sql_str(old)}, {_sql_str(new)})"
            else:
                expr = f"regexp_replace({expr}, {_sql_str('(?i)' + re.escape(old))}, {_sql_str(new)}, 'g')"
        return expr

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        parts = ", ".join(f"{self._expr(c)} AS {quote_ident(c)}" for c in self.columns)
        return f"SELECT * REPLACE ({parts}) FROM {source}"


FILL_STRATEGIES = ("value", "down", "up", "mean", "median", "mode")


@register
class FillStep(Step):
    """Fill empty cells with a value, the neighbouring value, or a column statistic."""

    kind: ClassVar[str] = "fill"
    group: ClassVar[str] = "clean"
    label: ClassVar[str] = "Fill empty cells"
    columns: List[str]
    strategy: str = "value"
    value: Any = None

    def model_post_init(self, __context: Any) -> None:
        if self.strategy not in FILL_STRATEGIES:
            raise ValueError(f"unsupported fill strategy {self.strategy!r}; use one of {FILL_STRATEGIES}")
        if self.strategy == "value" and self.value is None:
            raise ValueError("fill with a value needs the value")

    def _expr(self, c: str) -> str:
        col = quote_ident(c)
        if self.strategy == "value":
            v = self.value
            lit = str(v) if isinstance(v, (int, float)) and not isinstance(v, bool) else _sql_str(v)
            return f"COALESCE({col}, {lit})"
        if self.strategy == "down":
            return f"COALESCE({col}, last_value({col} IGNORE NULLS) OVER (ORDER BY 1 ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW))"
        if self.strategy == "up":
            return f"COALESCE({col}, first_value({col} IGNORE NULLS) OVER (ORDER BY 1 ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING))"
        fn = {"mean": "avg", "median": "median", "mode": "mode"}[self.strategy]
        return f"COALESCE({col}, {fn}({col}) OVER ())"

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        parts = ", ".join(f"{self._expr(c)} AS {quote_ident(c)}" for c in self.columns)
        return f"SELECT * REPLACE ({parts}) FROM {source}"


CONDITION_OPS = (
    "equals", "not_equals", "contains", "not_contains", "starts_with", "ends_with",
    "gt", "gte", "lt", "lte", "between", "is_empty", "not_empty", "in_list", "matches",
)


def _num_or_none(value: Any) -> Optional[str]:
    try:
        return repr(float(str(value).replace(",", "")))
    except (TypeError, ValueError):
        return None


def condition_sql(cond: Dict[str, Any]) -> str:
    """One row condition from the builder, as safe SQL."""
    col = quote_ident(str(cond.get("column") or ""))
    op = cond.get("op")
    if op not in CONDITION_OPS:
        raise ValueError(f"unsupported condition {op!r}")
    text = f"CAST({col} AS VARCHAR)"
    value = cond.get("value")
    if op == "is_empty":
        return f"({col} IS NULL OR trim({text}) = '')"
    if op == "not_empty":
        return f"({col} IS NOT NULL AND trim({text}) <> '')"
    if op == "in_list":
        values = cond.get("values") or [v.strip() for v in str(value or "").split(",") if v.strip()]
        if not values:
            raise ValueError("'is one of' needs at least one value")
        return f"(lower(trim({text})) IN ({', '.join(_sql_str(str(v).strip().lower()) for v in values)}))"
    if value is None:
        raise ValueError(f"condition {op!r} needs a value")
    sval = str(value)
    if op in ("equals", "not_equals"):
        num = _num_or_none(sval)
        same = f"(lower(trim({text})) = {_sql_str(sval.strip().lower())}" + (
            f" OR TRY_CAST({col} AS DOUBLE) = {num})" if num else ")")
        return same if op == "equals" else f"(NOT COALESCE({same}, FALSE))"
    if op in ("contains", "not_contains"):
        like = f"({text} ILIKE {_sql_str('%' + sval.replace('%', '').replace('_', '') + '%')})"
        return like if op == "contains" else f"(NOT COALESCE({like}, FALSE))"
    if op == "starts_with":
        return f"({text} ILIKE {_sql_str(sval.replace('%', '') + '%')})"
    if op == "ends_with":
        return f"({text} ILIKE {_sql_str('%' + sval.replace('%', ''))})"
    if op == "matches":
        return f"regexp_matches({text}, {_sql_str(sval)})"

    def bound(v: Any) -> tuple[str, str]:
        num = _num_or_none(v)
        if num is not None:
            return f"TRY_CAST({col} AS DOUBLE)", num
        return f"TRY_CAST({col} AS TIMESTAMP)", f"TRY_CAST({_sql_str(str(v))} AS TIMESTAMP)"

    left, right = bound(value)
    if op == "between":
        left2, right2 = bound(cond.get("value2"))
        return f"({left} BETWEEN {right} AND {right2})"
    sym = {"gt": ">", "gte": ">=", "lt": "<", "lte": "<="}[op]
    return f"({left} {sym} {right})"


def conditions_sql(conditions: List[Dict[str, Any]], match: str = "all") -> str:
    if not conditions:
        raise ValueError("add at least one condition")
    joiner = " AND " if match == "all" else " OR "
    return "(" + joiner.join(condition_sql(c) for c in conditions) + ")"


@register
class FilterRowsStep(Step):
    """Keep or remove the rows that match conditions."""

    kind: ClassVar[str] = "filter_rows"
    group: ClassVar[str] = "shape"
    label: ClassVar[str] = "Filter rows"
    conditions: List[Dict[str, Any]]
    match: str = "all"
    action: str = "keep"

    def model_post_init(self, __context: Any) -> None:
        if self.match not in ("all", "any") or self.action not in ("keep", "remove"):
            raise ValueError("filter_rows match must be all/any and action keep/remove")
        conditions_sql(self.conditions, self.match)

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        pred = conditions_sql(self.conditions, self.match)
        where = pred if self.action == "keep" else f"NOT COALESCE({pred}, FALSE)"
        return f"SELECT * FROM {source} WHERE {where}"


def _value_sql(spec: Any) -> str:
    """A rule result: {"column": name} or {"value": literal}."""
    if isinstance(spec, dict) and spec.get("column"):
        return quote_ident(str(spec["column"]))
    raw = spec.get("value") if isinstance(spec, dict) else spec
    if raw is None:
        return "NULL"
    if isinstance(raw, bool):
        return "TRUE" if raw else "FALSE"
    if isinstance(raw, (int, float)):
        return repr(raw)
    return _sql_str(raw)


@register
class ConditionalStep(Step):
    """A new column whose value depends on conditions (if / else if / else)."""

    kind: ClassVar[str] = "conditional"
    group: ClassVar[str] = "derive"
    label: ClassVar[str] = "Conditional column"
    into: str
    rules: List[Dict[str, Any]]
    otherwise: Any = None
    replace: bool = False

    def model_post_init(self, __context: Any) -> None:
        if not self.rules:
            raise ValueError("add at least one rule")
        self._case()

    def _case(self) -> str:
        whens = " ".join(
            f"WHEN {conditions_sql(r.get('conditions') or [], r.get('match', 'all'))} THEN {_value_sql(r.get('then'))}"
            for r in self.rules
        )
        return f"CASE {whens} ELSE {_value_sql(self.otherwise)} END"

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        if self.replace:
            return f"SELECT * REPLACE ({self._case()} AS {quote_ident(self.into)}) FROM {source}"
        return f"SELECT *, {self._case()} AS {quote_ident(self.into)} FROM {source}"


@register
class FormulaStep(Step):
    """A calculated column written as a spreadsheet formula or a SQL expression."""

    kind: ClassVar[str] = "formula"
    group: ClassVar[str] = "derive"
    label: ClassVar[str] = "Formula column"
    into: str
    expression: str
    language: str = "excel"
    replace: bool = False

    def model_post_init(self, __context: Any) -> None:
        if self.language not in ("excel", "sql"):
            raise ValueError("formula language must be 'excel' or 'sql'")
        self._sql()

    def _sql(self) -> str:
        from src.shared.formula import FormulaError, translate

        try:
            return translate(self.expression, language=self.language).sql
        except FormulaError as exc:
            raise ValueError(str(exc)) from exc

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        if self.replace:
            return f"SELECT * REPLACE ({self._sql()} AS {quote_ident(self.into)}) FROM {source}"
        return f"SELECT *, {self._sql()} AS {quote_ident(self.into)} FROM {source}"


def runtime_table(index: int) -> str:
    """Where a model or AI step's output waits for the next step (filled by prep.engine.runtime)."""
    return f"_rt{int(index)}"


class RuntimeStep(Step):
    """A step whose new columns come from a model or the AI, not from SQL. The runner computes
    them over the rows so far and hands them on as a table; this step just reads that table."""

    def to_cte(self, source: str, ctx: CompileContext) -> str:
        return f"SELECT * FROM {quote_ident(runtime_table(ctx.index))}"


@register
class PredictStep(RuntimeStep):
    """Add the approved version of a prediction model's answer to every row."""

    kind: ClassVar[str] = "predict"
    group: ClassVar[str] = "ai"
    label: ClassVar[str] = "Add a prediction"
    model_id: str
    into: Optional[str] = None


@register
class AiAnswerStep(RuntimeStep):
    """Ask an AI decision of every row; adds the answer, how sure it was, and whether a person
    should check it."""

    kind: ClassVar[str] = "ai_answer"
    group: ClassVar[str] = "ai"
    label: ClassVar[str] = "Add an AI answer"
    decision_id: str
    columns: List[str]
    into: Optional[str] = None

    def model_post_init(self, __context: Any) -> None:
        if not self.columns:
            raise ValueError("choose the columns the AI should read")


RUNTIME_KINDS = {PredictStep.kind, AiAnswerStep.kind}
