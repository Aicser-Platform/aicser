"""Bind SQL identifiers to the connected schema (any dialect / source type).

LLM world-knowledge often invents conventional FKs (e.g. ``transactions.account_id``)
that are not on the actual table. Prompt text alone does not stop that — this
module is the mechanical check used by NL2SQL, CE text-to-SQL, validation,
and error correction.

Does not execute SQL. Schema-missing → no-op (do not block).
"""

from __future__ import annotations

import re
from dataclasses import dataclass, field
from typing import Any, Dict, List, Mapping, Optional, Tuple

_SQL_KEYWORDS = frozenset(
    {
        "on",
        "where",
        "group",
        "order",
        "limit",
        "join",
        "left",
        "right",
        "inner",
        "outer",
        "full",
        "cross",
        "select",
        "from",
        "and",
        "or",
        "as",
        "union",
        "having",
        "with",
        "case",
        "when",
        "then",
        "else",
        "end",
        "using",
        "by",
        "asc",
        "desc",
        "null",
        "not",
        "in",
        "is",
        "between",
        "like",
        "natural",
        "lateral",
        "over",
        "partition",
        "rows",
        "range",
        "unbounded",
        "preceding",
        "following",
        "current",
        "row",
        "distinct",
        "all",
        "exists",
        "true",
        "false",
        "cast",
        "extract",
    }
)

_TABLE_REF = re.compile(
    r"\b(?:FROM|JOIN)\s+"
    r'(?P<table>(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w]+)'
    r'(?:\s*\.\s*(?:"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w]+))?)'
    r'(?:\s+(?:AS\s+)?(?P<alias>"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w]+))?',
    re.IGNORECASE,
)

_QUAL_COL = re.compile(
    r'(?P<alias>"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w]*)'
    r"\s*\.\s*"
    r'(?P<col>"[^"]+"|`[^`]+`|\[[^\]]+\]|[A-Za-z_][\w]*)',
)

_ON_EQ = re.compile(
    r"\bON\s+"
    r'(?P<la>"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w]+)\s*\.\s*(?P<lc>"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w]+)'
    r"\s*=\s*"
    r'(?P<ra>"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w]+)\s*\.\s*(?P<rc>"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w]+)',
    re.IGNORECASE,
)

_AND_EQ = re.compile(
    r"\bAND\s+"
    r'(?P<la>"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w]+)\s*\.\s*(?P<lc>"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w]+)'
    r"\s*=\s*"
    r'(?P<ra>"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w]+)\s*\.\s*(?P<rc>"[^"]+"|`[^`]+`|\[[^\]]+\]|[\w]+)',
    re.IGNORECASE,
)


def unquote_ident(name: str) -> str:
    raw = (name or "").strip()
    if len(raw) >= 2 and raw[0] == raw[-1] and raw[0] in {'"', "`"}:
        return raw[1:-1]
    if raw.startswith("[") and raw.endswith("]"):
        return raw[1:-1]
    return raw


def _is_id_like(name: str) -> bool:
    n = unquote_ident(name).lower()
    return n in ("id", "pk", "key") or n.endswith("_id") or n.endswith("_key") or n.endswith("_pk") or n.endswith("_fk")


def _table_columns(table: Mapping[str, Any]) -> Dict[str, str]:
    out: Dict[str, str] = {}
    for col in table.get("columns") or table.get("fields") or []:
        if isinstance(col, dict):
            name = str(col.get("name") or col.get("column_name") or "").strip()
        else:
            name = str(col).strip()
        if name:
            out[unquote_ident(name).lower()] = name
    return out


def _table_leaf(table: Mapping[str, Any]) -> str:
    name = str(table.get("name") or table.get("table_name") or "").strip()
    return unquote_ident(name).split(".")[-1].lower()


def _qualified_table_name(table: Mapping[str, Any]) -> str:
    explicit = str(table.get("qualified_name") or "").strip()
    if explicit:
        return explicit
    name = str(table.get("name") or table.get("table_name") or "").strip()
    schema_n = str(table.get("schema") or "").strip()
    if schema_n and "." not in name:
        return f"{schema_n}.{name}"
    return name


def _iter_schema_tables(schema: Optional[Mapping[str, Any]]) -> List[Mapping[str, Any]]:
    if not isinstance(schema, Mapping):
        return []
    tables = schema.get("tables") or schema.get("schema") or []
    if isinstance(tables, list):
        return [t for t in tables if isinstance(t, Mapping)]
    if isinstance(tables, dict):
        out: List[Mapping[str, Any]] = []
        for name, info in tables.items():
            if isinstance(info, Mapping):
                row = dict(info)
                row.setdefault("name", name)
                out.append(row)
            elif isinstance(info, list):
                out.append({"name": name, "columns": info})
        return out
    return []


def schema_table_index(schema: Optional[Mapping[str, Any]]) -> Dict[str, Mapping[str, Any]]:
    index: Dict[str, Mapping[str, Any]] = {}
    for table in _iter_schema_tables(schema):
        name = str(table.get("name") or table.get("table_name") or "").strip()
        schema_n = str(table.get("schema") or "").strip()
        if not name:
            continue
        leaf = unquote_ident(name).lower()
        index[leaf] = table
        if schema_n:
            index[f"{unquote_ident(schema_n).lower()}.{leaf}"] = table
        qualified = str(table.get("qualified_name") or "").strip()
        if qualified:
            index[unquote_ident(qualified).replace(" ", "").lower()] = table
    return index


def schema_names(schema: Optional[Mapping[str, Any]]) -> set[str]:
    names: set[str] = set()
    if isinstance(schema, Mapping) and isinstance(schema.get("schemas"), list):
        for s in schema["schemas"]:
            if s and isinstance(s, str):
                names.add(s.strip().lower())
    for table in _iter_schema_tables(schema):
        s = str(table.get("schema") or "").strip().lower()
        if s:
            names.add(s)
    return names


def extract_table_aliases(sql: str) -> Dict[str, str]:
    """Map alias (or table leaf) → qualified table name as written in SQL."""
    aliases: Dict[str, str] = {}
    for match in _TABLE_REF.finditer(sql or ""):
        table = match.group("table") or ""
        alias = match.group("alias") or ""
        table_clean = re.sub(r"\s+", "", table)
        alias_clean = unquote_ident(alias).lower() if alias else ""
        if alias_clean in _SQL_KEYWORDS:
            alias_clean = ""
        leaf = unquote_ident(table_clean.split(".")[-1]).lower()
        if alias_clean:
            aliases[alias_clean] = table_clean
        if leaf:
            aliases.setdefault(leaf, table_clean)
    return aliases


def _resolve_table(
    alias: str,
    alias_map: Mapping[str, str],
    index: Mapping[str, Mapping[str, Any]],
) -> Tuple[str, Optional[Mapping[str, Any]]]:
    written = alias_map.get(unquote_ident(alias).lower(), alias)
    written_norm = unquote_ident(written).replace('"', "").replace("`", "").lower()
    leaf = written_norm.split(".")[-1]
    table = index.get(written_norm) or index.get(leaf)
    return written, table


def cte_names(sql: str) -> set[str]:
    return {m.lower() for m in re.findall(r"(\w+)\s+AS\s*\(", sql or "", flags=re.IGNORECASE)}


@dataclass
class BindIssue:
    alias: str
    column: str
    table: str
    available: List[str] = field(default_factory=list)
    in_on_clause: bool = False
    span: str = ""

    def message(self) -> str:
        avail = ", ".join(self.available[:12]) if self.available else "(none)"
        where = "JOIN ON" if self.in_on_clause else "SQL"
        return (
            f'{where}: table "{self.table}" (alias {self.alias}) has no column '
            f'"{self.column}". Columns on that table: {avail}'
        )


@dataclass
class BindResult:
    sql: str
    rewrites: List[str] = field(default_factory=list)
    issues: List[BindIssue] = field(default_factory=list)

    @property
    def ok(self) -> bool:
        return not self.issues


def find_unbound_qualified_columns(
    sql: str,
    schema: Optional[Mapping[str, Any]],
) -> List[BindIssue]:
    """Return alias.col references that do not exist on the aliased table."""
    if not sql or not schema:
        return []
    alias_map = extract_table_aliases(sql)
    index = schema_table_index(schema)
    schemas = schema_names(schema)
    ctes = cte_names(sql)
    on_spans = {m.group(0) for pat in (_ON_EQ, _AND_EQ) for m in pat.finditer(sql)}

    found: List[BindIssue] = []
    seen: set[Tuple[str, str]] = set()
    for match in _QUAL_COL.finditer(sql):
        la, lc = match.group("alias"), match.group("col")
        alias_l = unquote_ident(la).lower()
        col_l = unquote_ident(lc).lower()
        if not alias_l or not col_l:
            continue
        if alias_l in _SQL_KEYWORDS or col_l in _SQL_KEYWORDS:
            continue
        if alias_l.isdigit() or col_l.isdigit():
            continue
        # schema.table in FROM/JOIN, not alias.column
        if alias_l in schemas and alias_l not in alias_map:
            continue
        if alias_l in ctes and alias_l not in alias_map:
            continue
        written, table = _resolve_table(la, alias_map, index)
        if not table:
            continue
        cols = _table_columns(table)
        if col_l in cols:
            continue
        key = (alias_l, col_l)
        if key in seen:
            continue
        seen.add(key)
        table_label = _qualified_table_name(table) or written
        span = match.group(0)
        in_on = any(span in on_span or on_span.find(span) >= 0 for on_span in on_spans)
        found.append(
            BindIssue(
                alias=unquote_ident(la),
                column=unquote_ident(lc),
                table=table_label,
                available=list(cols.values()),
                in_on_clause=in_on,
                span=span,
            )
        )
    return found


def _shared_id_columns(left: Mapping[str, Any], right: Mapping[str, Any]) -> List[str]:
    left_cols = _table_columns(left)
    right_cols = _table_columns(right)
    shared = []
    for key, name in left_cols.items():
        if key in right_cols and _is_id_like(name):
            shared.append(name)
    shared.sort(key=lambda n: (0 if n.lower() == "id" else 1, len(n)), reverse=True)
    return shared


def list_join_paths(
    schema: Optional[Mapping[str, Any]],
    *,
    max_tables: int = 16,
    max_paths: int = 24,
) -> List[Tuple[str, str, str]]:
    """Pairs of tables that share an id-like column. Generic — no domain nouns."""
    tables = _iter_schema_tables(schema)[:max_tables]
    paths: List[Tuple[str, str, str]] = []
    for i, left in enumerate(tables):
        for right in tables[i + 1 :]:
            shared = _shared_id_columns(left, right)
            if not shared:
                continue
            paths.append((_qualified_table_name(left), _qualified_table_name(right), shared[0]))
            if len(paths) >= max_paths:
                return paths
    return paths


def format_join_paths_for_llm(
    schema: Optional[Mapping[str, Any]],
    *,
    compact: bool = False,
    max_tables: int = 16,
    max_paths: int = 24,
) -> str:
    tables = _iter_schema_tables(schema)
    if len(tables) < 2:
        return ""
    paths = list_join_paths(schema, max_tables=max_tables, max_paths=max_paths)
    if not paths:
        if compact:
            return (
                "JOIN PATHS: listed tables share no *_id / *_key columns — "
                "do not JOIN; query one table. Never invent columns to force a JOIN."
            )
        return (
            "JOIN PATHS: the listed tables share no *_id / *_key columns. "
            "Do not JOIN them. Query a single table. Never invent a column that is "
            "not listed on that table."
        )
    if compact:
        bits = [f"{a}↔{b} ON {k}" for a, b, k in paths]
        return (
            "JOIN PATHS (only these keys; never invent columns): " + "; ".join(bits)
        )
    lines = [
        "JOIN PATHS — join ONLY when a path is listed; never invent a column to force a JOIN:",
    ]
    for a, b, k in paths:
        lines.append(f"- {a} ↔ {b} ON {k}")
    lines.append(
        "If two tables are not listed together they have no shared key. "
        "Use a listed bridge table, or query one table."
    )
    return "\n".join(lines)


def tables_holding_column(
    schema: Optional[Mapping[str, Any]],
    column: str,
) -> List[Mapping[str, Any]]:
    want = unquote_ident(column).lower()
    if not want:
        return []
    return [t for t in _iter_schema_tables(schema) if want in _table_columns(t)]


def _alias_qualified_columns(sql: str, alias: str) -> set[str]:
    alias_l = unquote_ident(alias).lower()
    out: set[str] = set()
    for match in _QUAL_COL.finditer(sql or ""):
        if unquote_ident(match.group("alias")).lower() != alias_l:
            continue
        col = unquote_ident(match.group("col")).lower()
        if col and col not in _SQL_KEYWORDS:
            out.add(col)
    return out


def _replace_join_table_for_alias(sql: str, alias: str, new_table: str) -> str:
    alias_l = unquote_ident(alias).lower()
    for match in _TABLE_REF.finditer(sql):
        table = match.group("table") or ""
        al = match.group("alias") or ""
        alias_clean = unquote_ident(al).lower() if al else ""
        if alias_clean in _SQL_KEYWORDS:
            alias_clean = ""
        leaf = unquote_ident(re.sub(r"\s+", "", table).split(".")[-1]).lower()
        if alias_clean == alias_l or (not alias_clean and leaf == alias_l):
            start, end = match.span("table")
            return sql[:start] + new_table + sql[end:]
    return sql


def _same_table(a: Mapping[str, Any], b: Mapping[str, Any]) -> bool:
    return _qualified_table_name(a).lower() == _qualified_table_name(b).lower() or (
        _table_leaf(a) and _table_leaf(a) == _table_leaf(b)
    )


def rewrite_invented_join_tables(
    sql: str,
    schema: Optional[Mapping[str, Any]],
) -> Tuple[str, List[str]]:
    """Replace a JOIN target when ON uses a column that table does not have.

    Only substitutes when exactly one other catalog table has that column and
    also has every other column referenced via the same alias. Generic — no
    domain table names.
    """
    if not sql or not schema:
        return sql, []
    issues = [i for i in find_unbound_qualified_columns(sql, schema) if i.in_on_clause]
    if not issues:
        return sql, []

    alias_map = extract_table_aliases(sql)
    index = schema_table_index(schema)
    rewritten = sql
    notes: List[str] = []

    for issue in issues:
        _, wrong_table = _resolve_table(issue.alias, alias_map, index)
        if not wrong_table:
            continue
        needed = _alias_qualified_columns(rewritten, issue.alias)
        needed.add(unquote_ident(issue.column).lower())

        other_side_tables: List[Mapping[str, Any]] = []
        for pat in (_ON_EQ, _AND_EQ):
            for match in pat.finditer(rewritten):
                for side_alias in (match.group("la"), match.group("ra")):
                    al = unquote_ident(side_alias).lower()
                    if al == unquote_ident(issue.alias).lower():
                        continue
                    _, tbl = _resolve_table(side_alias, alias_map, index)
                    if tbl:
                        other_side_tables.append(tbl)

        donors: List[Mapping[str, Any]] = []
        for cand in tables_holding_column(schema, issue.column):
            if _same_table(cand, wrong_table):
                continue
            if any(_same_table(cand, other) for other in other_side_tables):
                continue
            cand_cols = _table_columns(cand)
            if all(col in cand_cols for col in needed):
                donors.append(cand)
        if len(donors) != 1:
            continue
        donor = donors[0]
        new_name = _qualified_table_name(donor)
        next_sql = _replace_join_table_for_alias(rewritten, issue.alias, new_name)
        if next_sql == rewritten:
            continue
        rewritten = next_sql
        notes.append(
            f'{issue.alias}.{issue.column} is not on {issue.table}; '
            f"JOIN target → {new_name}"
        )
        alias_map = extract_table_aliases(rewritten)
        index = schema_table_index(schema)

    return rewritten, notes


def bind_sql_to_schema(
    sql: str,
    schema: Optional[Mapping[str, Any]],
    *,
    rewrite: bool = True,
) -> BindResult:
    """Rewrite invented JOIN targets when unique, then report remaining unbound cols."""
    if not sql or not schema or not _iter_schema_tables(schema):
        return BindResult(sql=sql or "")
    current = sql
    notes: List[str] = []
    if rewrite:
        current, notes = rewrite_invented_join_tables(current, schema)
    issues = find_unbound_qualified_columns(current, schema)
    return BindResult(sql=current, rewrites=notes, issues=issues)


def format_bind_error(result: BindResult, schema: Optional[Mapping[str, Any]] = None) -> str:
    parts = [issue.message() for issue in result.issues]
    paths = format_join_paths_for_llm(schema) if schema else ""
    msg = "Schema bind error: " + "; ".join(parts)
    if paths:
        msg += "\n" + paths
    return msg


def bind_fix_instruction(result: BindResult, schema: Optional[Mapping[str, Any]] = None) -> str:
    """Prompt fragment for the SQL fixer — do not preserve a bad FROM/JOIN."""
    lines = [
        "The SQL references a column that is not on that FROM/JOIN table.",
        "Do NOT keep the current FROM/JOIN. Do NOT substitute a random column from Candidate bindings.",
        "Rebuild FROM/JOIN using only columns listed on each table and the JOIN PATHS.",
    ]
    for issue in result.issues:
        lines.append(issue.message())
        donors = tables_holding_column(schema, issue.column)
        if donors:
            names = ", ".join(_qualified_table_name(t) for t in donors[:8])
            lines.append(f'Column "{issue.column}" exists on: {names} — not on {issue.table}.')
    paths = format_join_paths_for_llm(schema) if schema else ""
    if paths:
        lines.append(paths)
    return "\n".join(lines)


def is_unbound_column_error(error_message: str) -> bool:
    """Warehouse rejected an identifier that is not on the FROM tables.

    Covers Postgres, MySQL, Snowflake, BigQuery, SQL Server, DuckDB binder
    (``does not have a column named`` / Candidate bindings), etc.
    Dialect quoting cannot fix this — the grain or JOIN must change.
    """
    el = (error_message or "").lower()
    if not el:
        return False
    if "not found in from" in el or "referenced column" in el:
        return True
    if "does not have a column named" in el:
        return True
    if "candidate bindings" in el:
        return True
    if "binder error" in el and "column" in el:
        return True
    if "does not exist" in el and "column" in el:
        return True
    if "unknown column" in el or "no such column" in el:
        return True
    if "unrecognized name" in el or "invalid column name" in el:
        return True
    if "no matching signature" in el and "column" in el:
        return True
    return False
