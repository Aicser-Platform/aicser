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


def test_protected_ce_modules_avoid_direct_ee_imports():
    """New CE modules must not import ee.modules directly (use shims / is_ee_enabled guards)."""
    protected = ["knowledge", "dashboards", "embed", "shared"]
    violations: list[str] = []
    for name in protected:
        module_dir = SERVER_SRC / name if name != "shared" else Path(__file__).resolve().parents[1] / "src" / "shared"
        if not module_dir.is_dir():
            continue
        for py_file in module_dir.rglob("*.py"):
            text = py_file.read_text(encoding="utf-8", errors="ignore")
            if "from ee.modules" in text or "import ee.modules" in text:
                violations.append(str(py_file))
    assert not violations, f"Direct EE imports: {violations}"
