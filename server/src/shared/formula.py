"""One expression language in two spellings: spreadsheet formulas and SQL.

Spreadsheet formulas (``=IF([Amount] > 100, "High", "Low")``) are translated into a
single DuckDB SQL expression; SQL expressions are checked by ``validate_sql_expression``.
Prepare's formula and conditional columns use this, so a formula written in Sheets reads
the same here. Column names go in [brackets]; a bare name also works when it matches a
column exactly.
"""

from __future__ import annotations

import re
from dataclasses import dataclass
from typing import Callable, Dict, List, Optional, Sequence

from src.shared.sql_expression_validator import validate_sql_expression


class FormulaError(ValueError):
    """A formula that can't be read; the message says where and why."""


@dataclass
class _Tok:
    kind: str  # num | str | ref | name | op | lparen | rparen | comma
    value: str
    pos: int


_TOKEN_RE = re.compile(
    r"""
    (?P<ws>\s+)
  | (?P<num>\d+(?:\.\d+)?(?:[eE][+-]?\d+)?)
  | (?P<str>"(?:[^"]|"")*")
  | (?P<ref>\[[^\]]+\])
  | (?P<name>[A-Za-z_][A-Za-z0-9_.]*)
  | (?P<op><>|<=|>=|[-+*/^&=<>%])
  | (?P<lparen>\()
  | (?P<rparen>\))
  | (?P<comma>[,;])
    """,
    re.VERBOSE,
)


def _tokenize(text: str) -> List[_Tok]:
    out: List[_Tok] = []
    pos = 0
    while pos < len(text):
        m = _TOKEN_RE.match(text, pos)
        if not m:
            raise FormulaError(f"Unexpected character {text[pos]!r} at position {pos + 1}.")
        kind = m.lastgroup or ""
        if kind != "ws":
            out.append(_Tok(kind, m.group(), pos))
        pos = m.end()
    return out


def _q(name: str) -> str:
    return '"' + name.replace('"', '""') + '"'


def _lit(text: str) -> str:
    return "'" + text.replace("'", "''") + "'"


def _txt(sql: str) -> str:
    return f"CAST({sql} AS VARCHAR)"


def _excel_date_format(fmt: str) -> str:
    """yyyy-mm-dd style (as in TEXT) to strftime."""
    out = fmt
    for src, dst in (("yyyy", "%Y"), ("yy", "%y"), ("mmmm", "%B"), ("mmm", "%b"), ("dddd", "%A"),
                     ("ddd", "%a"), ("hh", "%H"), ("ss", "%S"), ("mm", "%m"), ("dd", "%d")):
        out = out.replace(src, dst)
    return out.replace("%m:%S", "%M:%S").replace("%H:%m", "%H:%M")


def _text_fn(args: List[str], raw: List[Optional[str]]) -> str:
    value, fmt = args[0], raw[1]
    if fmt is None:
        raise FormulaError("TEXT needs a quoted format, for example TEXT([Date], \"yyyy-mm-dd\").")
    if re.search(r"[ymdhs]", fmt, re.IGNORECASE) and not re.fullmatch(r"[#0.,%]+", fmt):
        return f"strftime(CAST({value} AS TIMESTAMP), {_lit(_excel_date_format(fmt))})"
    decimals = len(fmt.split(".")[1].rstrip("%")) if "." in fmt else 0
    if fmt.endswith("%"):
        return f"(format('{{:.{decimals}f}}', CAST({value} AS DOUBLE) * 100) || '%')"
    grouping = "," if "," in fmt else ""
    return f"format('{{:{grouping}.{decimals}f}}', CAST({value} AS DOUBLE))"


def _round_dir(fn: str) -> Callable[[List[str], List[Optional[str]]], str]:
    def build(a: List[str], _raw: List[Optional[str]]) -> str:
        places = a[1] if len(a) > 1 else "0"
        return f"({fn}(({a[0]}) * power(10, {places})) / power(10, {places}))"
    return build


def _datedif(a: List[str], raw: List[Optional[str]]) -> str:
    unit = (raw[2] or "d").strip().lower() if len(raw) > 2 else "d"
    part = {"d": "day", "m": "month", "y": "year"}.get(unit)
    if not part:
        raise FormulaError('DATEDIF unit must be "d", "m" or "y".')
    return f"date_diff('{part}', CAST({a[0]} AS DATE), CAST({a[1]} AS DATE))"


def _case_when(pairs: Sequence[str], default: Optional[str]) -> str:
    whens = " ".join(f"WHEN {pairs[i]} THEN {pairs[i + 1]}" for i in range(0, len(pairs) - 1, 2))
    return f"CASE {whens} ELSE {default if default is not None else 'NULL'} END"


# name -> (min args, max args or None, builder(sql args, raw string literals))
_FUNCS: Dict[str, tuple] = {
    "IF": (2, 3, lambda a, r: _case_when(a[:2], a[2] if len(a) > 2 else None)),
    "IFS": (2, None, lambda a, r: _case_when(a, None)),
    "SWITCH": (3, None, lambda a, r: f"CASE {a[0]} " + " ".join(
        f"WHEN {a[i]} THEN {a[i + 1]}" for i in range(1, len(a) - 1, 2)) + f" ELSE {a[-1] if len(a) % 2 == 0 else 'NULL'} END"),
    "AND": (1, None, lambda a, r: "(" + " AND ".join(a) + ")"),
    "OR": (1, None, lambda a, r: "(" + " OR ".join(a) + ")"),
    "NOT": (1, 1, lambda a, r: f"(NOT {a[0]})"),
    "IFERROR": (2, 2, lambda a, r: f"COALESCE({a[0]}, {a[1]})"),
    "COALESCE": (1, None, lambda a, r: f"COALESCE({', '.join(a)})"),
    "ISBLANK": (1, 1, lambda a, r: f"({a[0]} IS NULL OR TRIM({_txt(a[0])}) = '')"),
    "ISNUMBER": (1, 1, lambda a, r: f"(TRY_CAST({_txt(a[0])} AS DOUBLE) IS NOT NULL)"),
    "LEFT": (1, 2, lambda a, r: f"left({_txt(a[0])}, {a[1] if len(a) > 1 else 1})"),
    "RIGHT": (1, 2, lambda a, r: f"right({_txt(a[0])}, {a[1] if len(a) > 1 else 1})"),
    "MID": (3, 3, lambda a, r: f"substr({_txt(a[0])}, {a[1]}, {a[2]})"),
    "LEN": (1, 1, lambda a, r: f"length({_txt(a[0])})"),
    "UPPER": (1, 1, lambda a, r: f"upper({_txt(a[0])})"),
    "LOWER": (1, 1, lambda a, r: f"lower({_txt(a[0])})"),
    "PROPER": (1, 1, lambda a, r: f"array_to_string(list_transform(string_split(lower({_txt(a[0])}), ' '), w -> upper(w[1]) || w[2:]), ' ')"),
    "TRIM": (1, 1, lambda a, r: f"trim(regexp_replace({_txt(a[0])}, '\\s+', ' ', 'g'))"),
    "CONCAT": (1, None, lambda a, r: f"concat({', '.join(a)})"),
    "CONCATENATE": (1, None, lambda a, r: f"concat({', '.join(a)})"),
    "TEXTJOIN": (3, None, lambda a, r: f"concat_ws({a[0]}, {', '.join(a[2:])})"),
    "SUBSTITUTE": (3, 3, lambda a, r: f"replace({_txt(a[0])}, {a[1]}, {a[2]})"),
    "FIND": (2, 2, lambda a, r: f"NULLIF(strpos({_txt(a[1])}, {a[0]}), 0)"),
    "SEARCH": (2, 2, lambda a, r: f"NULLIF(strpos(lower({_txt(a[1])}), lower({a[0]})), 0)"),
    "VALUE": (1, 1, lambda a, r: f"TRY_CAST(regexp_replace({_txt(a[0])}, '[,$%\\s]', '', 'g') AS DOUBLE)"),
    "TEXT": (2, 2, _text_fn),
    "ROUND": (1, 2, lambda a, r: f"round({a[0]}, {a[1] if len(a) > 1 else 0})"),
    "ROUNDUP": (1, 2, _round_dir("ceil")),
    "ROUNDDOWN": (1, 2, _round_dir("trunc")),
    "INT": (1, 1, lambda a, r: f"floor({a[0]})"),
    "ABS": (1, 1, lambda a, r: f"abs({a[0]})"),
    "MOD": (2, 2, lambda a, r: f"(({a[0]}) % ({a[1]}))"),
    "POWER": (2, 2, lambda a, r: f"power({a[0]}, {a[1]})"),
    "SQRT": (1, 1, lambda a, r: f"sqrt({a[0]})"),
    "MIN": (1, None, lambda a, r: f"least({', '.join(a)})"),
    "MAX": (1, None, lambda a, r: f"greatest({', '.join(a)})"),
    "SUM": (1, None, lambda a, r: "(" + " + ".join(f"COALESCE({x}, 0)" for x in a) + ")"),
    "AVERAGE": (1, None, lambda a, r: "((" + " + ".join(f"COALESCE({x}, 0)" for x in a) + f") / {len(a)})"),
    "TODAY": (0, 0, lambda a, r: "current_date"),
    "NOW": (0, 0, lambda a, r: "now()"),
    "YEAR": (1, 1, lambda a, r: f"year(CAST({a[0]} AS DATE))"),
    "MONTH": (1, 1, lambda a, r: f"month(CAST({a[0]} AS DATE))"),
    "DAY": (1, 1, lambda a, r: f"day(CAST({a[0]} AS DATE))"),
    "WEEKDAY": (1, 1, lambda a, r: f"(dayofweek(CAST({a[0]} AS DATE)) + 1)"),
    "WEEKNUM": (1, 1, lambda a, r: f"week(CAST({a[0]} AS DATE))"),
    "DATE": (3, 3, lambda a, r: f"make_date(CAST({a[0]} AS BIGINT), CAST({a[1]} AS BIGINT), CAST({a[2]} AS BIGINT))"),
    "DATEVALUE": (1, 1, lambda a, r: f"TRY_CAST({_txt(a[0])} AS DATE)"),
    "DATEDIF": (3, 3, _datedif),
    "EDATE": (2, 2, lambda a, r: f"CAST(CAST({a[0]} AS DATE) + to_months(CAST({a[1]} AS INTEGER)) AS DATE)"),
    "EOMONTH": (2, 2, lambda a, r: f"last_day(CAST(CAST({a[0]} AS DATE) + to_months(CAST({a[1]} AS INTEGER)) AS DATE))"),
}

FUNCTION_NAMES = sorted(_FUNCS)


class _Parser:
    def __init__(self, tokens: List[_Tok], columns: Optional[Sequence[str]]):
        self.toks = tokens
        self.i = 0
        self.columns = list(columns) if columns is not None else None
        self.used: List[str] = []

    def peek(self) -> Optional[_Tok]:
        return self.toks[self.i] if self.i < len(self.toks) else None

    def take(self) -> _Tok:
        tok = self.peek()
        if tok is None:
            raise FormulaError("The formula ends too early.")
        self.i += 1
        return tok

    def expect(self, kind: str, what: str) -> _Tok:
        tok = self.take()
        if tok.kind != kind:
            raise FormulaError(f"Expected {what} at position {tok.pos + 1}, found {tok.value!r}.")
        return tok

    def column(self, name: str, pos: int) -> str:
        if self.columns is not None:
            match = next((c for c in self.columns if c == name), None) or next(
                (c for c in self.columns if c.lower() == name.lower()), None)
            if match is None:
                raise FormulaError(f"There's no column named {name!r} (position {pos + 1}).")
            name = match
        self.used.append(name)
        return _q(name)

    # comparison < concat < additive < multiplicative < power < unary < percent < primary
    def parse(self) -> str:
        expr = self.comparison()
        if self.peek() is not None:
            tok = self.peek()
            raise FormulaError(f"Unexpected {tok.value!r} at position {tok.pos + 1}.")
        return expr

    def comparison(self) -> str:
        left = self.concat()
        while (tok := self.peek()) and tok.kind == "op" and tok.value in ("=", "<>", "<", ">", "<=", ">="):
            self.take()
            left = f"({left} {tok.value} {self.concat()})"
        return left

    def concat(self) -> str:
        left = self.additive()
        while (tok := self.peek()) and tok.kind == "op" and tok.value == "&":
            self.take()
            left = f"(COALESCE({_txt(left)}, '') || COALESCE({_txt(self.additive())}, ''))"
        return left

    def additive(self) -> str:
        left = self.multiplicative()
        while (tok := self.peek()) and tok.kind == "op" and tok.value in ("+", "-"):
            self.take()
            left = f"({left} {tok.value} {self.multiplicative()})"
        return left

    def multiplicative(self) -> str:
        left = self.power()
        while (tok := self.peek()) and tok.kind == "op" and tok.value in ("*", "/"):
            self.take()
            right = self.power()
            left = f"({left} * {right})" if tok.value == "*" else f"({left} / NULLIF({right}, 0))"
        return left

    def power(self) -> str:
        left = self.unary()
        while (tok := self.peek()) and tok.kind == "op" and tok.value == "^":
            self.take()
            left = f"power({left}, {self.unary()})"
        return left

    def unary(self) -> str:
        tok = self.peek()
        if tok and tok.kind == "op" and tok.value in ("-", "+"):
            self.take()
            inner = self.unary()
            return f"(-{inner})" if tok.value == "-" else inner
        return self.percent()

    def percent(self) -> str:
        value = self.primary()
        while (tok := self.peek()) and tok.kind == "op" and tok.value == "%":
            self.take()
            value = f"(({value}) / 100.0)"
        return value

    def primary(self) -> str:
        tok = self.take()
        if tok.kind == "num":
            return tok.value
        if tok.kind == "str":
            return _lit(tok.value[1:-1].replace('""', '"'))
        if tok.kind == "ref":
            return self.column(tok.value[1:-1].strip(), tok.pos)
        if tok.kind == "lparen":
            inner = self.comparison()
            self.expect("rparen", "')'")
            return f"({inner})"
        if tok.kind == "name":
            upper = tok.value.upper()
            nxt = self.peek()
            if nxt is not None and nxt.kind == "lparen":
                return self.call(upper, tok)
            if upper in ("TRUE", "FALSE"):
                return upper
            # Without a column list (compiling a saved step) a bare name is a column; the
            # engine reports it if no such column exists.
            if self.columns is None or any(c.lower() == tok.value.lower() for c in self.columns):
                return self.column(tok.value, tok.pos)
            raise FormulaError(f"Unknown name {tok.value!r} at position {tok.pos + 1}. Put column names in [brackets].")
        raise FormulaError(f"Unexpected {tok.value!r} at position {tok.pos + 1}.")

    def call(self, name: str, tok: _Tok) -> str:
        spec = _FUNCS.get(name)
        if spec is None:
            raise FormulaError(f"{tok.value} isn't a supported function. Try one of: {', '.join(FUNCTION_NAMES[:12])}…")
        self.expect("lparen", "'('")
        args: List[str] = []
        raw: List[Optional[str]] = []
        if not (self.peek() and self.peek().kind == "rparen"):
            while True:
                start = self.peek()
                args.append(self.comparison())
                raw.append(start.value[1:-1].replace('""', '"') if start and start.kind == "str" and self.toks[self.i - 1] is start else None)
                if self.peek() and self.peek().kind == "comma":
                    self.take()
                    continue
                break
        self.expect("rparen", f"')' to close {name}")
        lo, hi = spec[0], spec[1]
        if len(args) < lo or (hi is not None and len(args) > hi):
            want = f"{lo}" if hi == lo else f"{lo} or more" if hi is None else f"{lo} to {hi}"
            raise FormulaError(f"{name} takes {want} values, got {len(args)}.")
        return spec[2](args, raw)


@dataclass
class Translation:
    sql: str
    columns_used: List[str]


def translate(expression: str, *, language: str = "excel", columns: Optional[Sequence[str]] = None) -> Translation:
    """A formula or SQL expression as one checked SQL expression."""
    text = (expression or "").strip()
    if not text:
        raise FormulaError("Write a formula first.")
    if language == "sql":
        try:
            validate_sql_expression(text, dialect="duckdb", label="Formula")
        except ValueError as exc:
            raise FormulaError(str(exc)) from exc
        if ";" in text or "--" in text or "/*" in text:
            raise FormulaError("A formula is a single expression; remove ';' and comments.")
        return Translation(sql=text, columns_used=[])
    if text.startswith("="):
        text = text[1:]
    parser = _Parser(_tokenize(text), columns)
    sql = parser.parse()
    return Translation(sql=sql, columns_used=list(dict.fromkeys(parser.used)))
