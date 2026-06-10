"""Ensure the shared sample DuckDB file exists (used on server startup)."""

from __future__ import annotations

import os
import sys

from src.shared.sample_data.generate_duckdb import default_sample_duckdb_path, generate_sample_duckdb


def main() -> int:
    output_path = default_sample_duckdb_path()
    force = os.getenv("FORCE_REGENERATE_SAMPLE_DATA", "").lower() in {"1", "true", "yes"}

    if os.path.isfile(output_path) and not force and os.path.getsize(output_path) > 0:
        print(f"Sample DuckDB already present: {output_path}")
        return 0

    try:
        generate_sample_duckdb(output_path, force=force)
    except Exception as exc:
        print(f"Failed to generate sample DuckDB: {exc}", file=sys.stderr)
        return 1

    print(f"Sample DuckDB ready: {output_path}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
