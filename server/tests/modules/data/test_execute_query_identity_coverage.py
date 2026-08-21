"""Every data read states who it is for."""

import ast
from pathlib import Path

SERVER_ROOT = Path(__file__).resolve().parents[3]
SEARCH_ROOTS = [SERVER_ROOT / "src", SERVER_ROOT / "ee"]

# Definitions and internal plumbing, not MultiEngineQueryService call sites.
EXEMPT_FILES = {
    "src/modules/data/connectors/cassandra_connector.py",
    "src/modules/data/connectors/mongodb_connector.py",
    "src/modules/data/services/data_sources_crud.py",
    "src/modules/data/services/multi_engine_query_service.py",
}

# Same method name, different service.
EXEMPT_RECEIVERS = {
    "database_connector",
    "enterprise_connectors_service",
    "real_data_manager",
}


def _attribute_name(node: ast.AST) -> str | None:
    if isinstance(node, ast.Name):
        return node.id
    if isinstance(node, ast.Attribute):
        return node.attr
    return None


def _calls_missing_identity(path: Path) -> list[int]:
    try:
        tree = ast.parse(path.read_text(encoding="utf-8"))
    except (SyntaxError, UnicodeDecodeError):
        return []

    missing = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not isinstance(func, ast.Attribute) or func.attr != "execute_query":
            continue
        if _attribute_name(func.value) in EXEMPT_RECEIVERS:
            continue
        if not any(kw.arg == "identity" for kw in node.keywords):
            missing.append(node.lineno)
    return missing


def test_every_execute_query_call_states_an_identity():
    offenders = []
    for root in SEARCH_ROOTS:
        if not root.exists():
            continue
        for path in root.rglob("*.py"):
            relative = path.relative_to(SERVER_ROOT).as_posix()
            if relative in EXEMPT_FILES:
                continue
            for line in _calls_missing_identity(path):
                offenders.append(f"{relative}:{line}")

    assert not offenders, (
        "These execute_query calls pass no identity, so they will be denied on any "
        "data source with a row filter policy. Pass QueryIdentity for a user-triggered "
        "read, or SystemQuery(reason=...) for a background job:\n  "
        + "\n  ".join(sorted(offenders))
    )


def _call_name(node: ast.AST) -> str | None:
    func = getattr(node, "func", None)
    if isinstance(func, ast.Name):
        return func.id
    if isinstance(func, ast.Attribute):
        return func.attr
    return None


def test_queries_router_does_not_mint_a_guest_query_identity():
    path = SERVER_ROOT / "src/modules/queries/router.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    guests = []
    for node in ast.walk(tree):
        if not isinstance(node, ast.Call) or _call_name(node) != "QueryIdentity":
            continue
        for kw in node.keywords:
            if kw.arg != "user_id":
                continue
            if isinstance(kw.value, ast.Constant) and str(kw.value.value) == "guest":
                guests.append(node.lineno)
            if isinstance(kw.value, ast.Call) and any(
                isinstance(elt, ast.Constant) and elt.value == "guest"
                for elt in ast.walk(kw.value)
            ):
                guests.append(node.lineno)
    assert not guests, (
        "QueryIdentity must not use a fake guest principal; pass None so RLS fail-closes:\n  "
        + "\n  ".join(f"src/modules/queries/router.py:{n}" for n in guests)
    )


def test_create_materialized_view_runs_user_sql_as_query_identity():
    path = SERVER_ROOT / "src/modules/data/router.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    fn = next(
        n
        for n in tree.body
        if isinstance(n, ast.AsyncFunctionDef) and n.name == "create_materialized_view"
    )
    identity_names = []
    for node in ast.walk(fn):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not isinstance(func, ast.Attribute) or func.attr != "execute_query":
            continue
        ident = next((kw.value for kw in node.keywords if kw.arg == "identity"), None)
        identity_names.append(_call_name(ident) if ident is not None else None)
    assert identity_names == ["QueryIdentity"], (
        "CREATE MATERIALIZED VIEW runs caller SQL and must use QueryIdentity, "
        f"not SystemQuery: {identity_names}"
    )


def test_database_query_path_forwards_caller_identity_not_system_query():
    path = SERVER_ROOT / "src/modules/data/services/data_connectivity_service.py"
    tree = ast.parse(path.read_text(encoding="utf-8"))
    fn = next(
        n
        for n in tree.body
        if isinstance(n, ast.ClassDef) and n.name == "DataConnectivityService"
    )
    method = next(
        n
        for n in fn.body
        if isinstance(n, ast.AsyncFunctionDef) and n.name == "_query_database_data_source"
    )
    identity_values = []
    for node in ast.walk(method):
        if not isinstance(node, ast.Call):
            continue
        func = node.func
        if not isinstance(func, ast.Attribute) or func.attr != "execute_query":
            continue
        if _attribute_name(func.value) in EXEMPT_RECEIVERS:
            continue
        ident = next((kw.value for kw in node.keywords if kw.arg == "identity"), None)
        identity_values.append(ident)
    assert identity_values, "_query_database_data_source must call execute_query"
    for ident in identity_values:
        assert isinstance(ident, ast.Name) and ident.id == "identity", (
            "SQL reads in _query_database_data_source must forward the caller's "
            f"identity, not SystemQuery: {ast.dump(ident) if ident else None}"
        )


def test_column_security_is_enforced_in_the_query_service():
    """Masking used to live in one HTTP handler, so every other caller bypassed it.

    Pinning it to execute_query is what stops that recurring.
    """
    source = (SERVER_ROOT / "src/modules/data/services/multi_engine_query_service.py").read_text()
    assert "_enforce_column_security" in source
    tree = ast.parse(source)
    execute_query = next(
        node for node in ast.walk(tree)
        if isinstance(node, ast.AsyncFunctionDef) and node.name == "execute_query"
    )
    called = {
        n.func.attr for n in ast.walk(execute_query)
        if isinstance(n, ast.Call) and isinstance(n.func, ast.Attribute)
    }
    assert "_enforce_column_security" in called
    assert "_enforce_row_security" in called


def test_query_endpoint_does_not_apply_result_name_masking_after_cls():
    """The old output-name mask overwrote CLS output and masked hard-coded names.

    A policy for `password` rendered as hash/null/partial/fixed in SQL, then
    this HTTP handler changed it back to `***MASKED***` and also masked columns
    like `salary` even when no CLS policy governed them.
    """
    source = (SERVER_ROOT / "src/modules/data/router.py").read_text()
    assert "mask_query_result_rows" not in source
