"""alembic_version.version_num is VARCHAR(32): a longer revision id makes
`alembic upgrade` fail at startup (after the migration body ran), which takes
the server down."""

import re
from pathlib import Path

VERSIONS = Path(__file__).resolve().parents[1] / "alembic" / "versions"
REVISION = re.compile(r'^revision(?:\s*:\s*str)?\s*=\s*["\']([^"\']+)["\']', re.MULTILINE)


def test_every_revision_id_fits_alembic_version_column():
    too_long = {}
    for path in VERSIONS.glob("*.py"):
        match = REVISION.search(path.read_text())
        if match and len(match.group(1)) > 32:
            too_long[path.name] = match.group(1)
    assert not too_long, f"revision ids longer than 32 chars: {too_long}"


def test_revision_ids_are_unique():
    seen = {}
    for path in VERSIONS.glob("*.py"):
        match = REVISION.search(path.read_text())
        if match:
            assert match.group(1) not in seen, f"{path.name} reuses {match.group(1)} from {seen[match.group(1)]}"
            seen[match.group(1)] = path.name
