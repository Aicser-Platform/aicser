"""Guard against undefined names in the data router.

A NameError inside a request handler only surfaces when a user hits that path —
`effective_organization_id` shipped undefined and reached production as a 500.
Pyflakes finds these statically, so new ones fail here instead.

The allowlist records debt that already existed. It may shrink, never grow.
"""

import subprocess
import sys
from pathlib import Path

ROUTER = Path(__file__).resolve().parents[3] / "src" / "modules" / "data" / "router.py"

# Pre-existing undefined names, each a latent 500 on its own code path.
KNOWN_UNDEFINED = {
    "deployment_result",
    "cubes_result",
    "DataSource",
    "yaml_schema_service",
}


def _undefined_names(path: Path) -> set[str]:
    result = subprocess.run(
        [sys.executable, "-m", "pyflakes", str(path)],
        capture_output=True,
        text=True,
    )
    names = set()
    for line in result.stdout.splitlines():
        if "undefined name" in line:
            names.add(line.rsplit("undefined name", 1)[1].strip().strip("'\""))
    return names


def test_no_new_undefined_names_in_the_data_router():
    found = _undefined_names(ROUTER)
    assert found <= KNOWN_UNDEFINED, (
        f"New undefined name(s) in the data router: {sorted(found - KNOWN_UNDEFINED)}. "
        "These raise NameError at request time, not import time."
    )


def test_query_execute_identity_names_are_defined():
    """The names the row-security identity is built from must resolve."""
    found = _undefined_names(ROUTER)
    for name in ("effective_organization_id", "effective_project_id", "org_id"):
        assert name not in found, f"{name} is undefined in the data router"
