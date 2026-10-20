"""Verify core modules follow project conventions (models, router, service)."""

from pathlib import Path

import pytest

SERVER_SRC = Path(__file__).resolve().parents[1] / "src" / "modules"

REQUIRED_FILES = ("router.py", "models.py")


@pytest.mark.parametrize(
    "module_name",
    [
        "dashboards",
        "knowledge",
        "embed",
    ],
)
def test_module_has_required_files(module_name: str):
    module_dir = SERVER_SRC / module_name
    assert module_dir.is_dir(), f"Missing module directory: {module_name}"
    for filename in REQUIRED_FILES:
        assert (module_dir / filename).is_file(), f"{module_name} missing {filename}"


def test_community_code_never_imports_enterprise_directly():
    """Community code reaches Enterprise only through src.modules.<shim> or src.enterprise.*
    (one module object either way, see src/core/ee_import_alias.py), never by naming ee."""
    import ast
    import re

    src = Path(__file__).resolve().parents[1] / "src"
    dynamic = re.compile(r"import_module\(\s*[\"']ee\.")
    violations: list[str] = []
    for py_file in src.rglob("*.py"):
        if py_file.name == "ee_import_alias.py":
            continue
        text = py_file.read_text(encoding="utf-8", errors="ignore")
        for node in ast.walk(ast.parse(text)):
            names = [node.module or ""] if isinstance(node, ast.ImportFrom) and not node.level else \
                [a.name for a in node.names] if isinstance(node, ast.Import) else []
            if any(n == "ee" or n.startswith("ee.") for n in names):
                violations.append(f"{py_file.relative_to(src)}:{node.lineno}")
        if dynamic.search(text):
            violations.append(f"{py_file.relative_to(src)} (import_module)")
    assert not violations, f"Direct EE imports: {violations}"


def test_enterprise_names_resolve_to_one_module(monkeypatch):
    """src.enterprise.* and src.modules.<shim>.* are the very module ee code imports, so model
    classes and context variables exist once."""
    import importlib

    from src.core.edition import is_ee_enabled

    if not is_ee_enabled() or not (Path(__file__).resolve().parents[1] / "ee" / "modules").is_dir():
        pytest.skip("Enterprise not enabled here")
    via_ce = importlib.import_module("src.enterprise.modules.data.services.rls_predicate_builder")
    assert via_ce is importlib.import_module("ee.modules.data.services.rls_predicate_builder")
    shimmed = importlib.import_module("src.modules.ai.decisions.tool_models")
    assert shimmed is importlib.import_module("ee.modules.ai.decisions.tool_models")


def test_finding_an_enterprise_module_does_not_run_it():
    """Finders run under Python's global import lock; running module code there deadlocks when
    it imports something another thread is loading (e.g. the embedding warm-up). The alias
    finder must only locate the file; the module runs later, during loading."""
    import subprocess
    import sys

    root = Path(__file__).resolve().parents[1]
    if not (root / "ee" / "modules" / "data").is_dir():
        pytest.skip("Enterprise not checked out here")
    code = (
        "import sys; from src.core.ee_import_alias import _EEAliasFinder, install; install()\n"
        "name = 'ee.modules.data.services.rls_predicate_builder'\n"
        "spec = _EEAliasFinder().find_spec('src.enterprise.modules.data.services.rls_predicate_builder', None)\n"
        "assert spec is not None and name not in sys.modules, 'finder ran the module'\n"
        "import importlib; m = importlib.import_module('src.enterprise.modules.data.services.rls_predicate_builder')\n"
        "assert m is sys.modules[name]\n"
    )
    env = {**__import__("os").environ, "AISER_EDITION": "enterprise", "PYTHONPATH": str(root)}
    out = subprocess.run([sys.executable, "-c", code], cwd=root, env=env, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]


def test_a_shimmed_package_keeps_its_community_only_files():
    """src.modules.ai is a shim onto ee.modules.ai, yet some helpers live only in the Community
    folder (surface_context_schema, surface_connectivity). Aliasing the package must keep them
    importable, in a fresh interpreter where the alias resolves the package first."""
    import subprocess
    import sys

    root = Path(__file__).resolve().parents[1]
    if not (root / "ee" / "modules" / "ai").is_dir():
        pytest.skip("Enterprise not checked out here")
    code = (
        "from src.core.ee_import_alias import install; install()\n"
        "import importlib, sys\n"
        "pkg = importlib.import_module('src.modules.ai')\n"
        "assert pkg is sys.modules['ee.modules.ai']\n"
        "m = importlib.import_module('src.modules.ai.surface_context_schema')\n"
        "assert hasattr(m, 'parse_surface_context')\n"
        "assert importlib.import_module('src.modules.ai.decisions.tool_models') is importlib.import_module('ee.modules.ai.decisions.tool_models')\n"
    )
    env = {**__import__("os").environ, "AISER_EDITION": "enterprise", "PYTHONPATH": str(root)}
    out = subprocess.run([sys.executable, "-c", code], cwd=root, env=env, capture_output=True, text=True, timeout=120)
    assert out.returncode == 0, out.stderr[-2000:]
