import ast
import pathlib

import pytest

NL2SQL_ROOT = pathlib.Path(__file__).resolve().parents[3] / "src" / "modules" / "nl2sql"

FORBIDDEN_IMPORT_PREFIXES = (
    "ee.",
    "src.modules.ai",
)


def _iter_py_files():
    for path in NL2SQL_ROOT.rglob("*.py"):
        yield path


@pytest.mark.parametrize("path", list(_iter_py_files()), ids=lambda p: p.name)
def test_nl2sql_module_has_no_ee_imports(path: pathlib.Path):
    tree = ast.parse(path.read_text(encoding="utf-8"), filename=str(path))
    for node in ast.walk(tree):
        if isinstance(node, ast.Import):
            for alias in node.names:
                for prefix in FORBIDDEN_IMPORT_PREFIXES:
                    assert not alias.name.startswith(prefix), f"{path}: import {alias.name}"
        elif isinstance(node, ast.ImportFrom):
            module = node.module or ""
            for prefix in FORBIDDEN_IMPORT_PREFIXES:
                assert not module.startswith(prefix), f"{path}: from {module}"
