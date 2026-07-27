#!/usr/bin/env python3
"""Generate draft semantic YAML for a connected Aicser data source.

Reads the stored schema of a data source (read-only) and writes
semantic/<slug>/ YAML files in the native schema. Descriptions are drafted and
marked "TODO: review".

Usage (from server/):
    python3 scripts/generate_semantic_yaml.py --data-source-id <id> [--out ../semantic] [--dry-run]
    python3 scripts/generate_semantic_yaml.py --list          # show available data sources
"""

from __future__ import annotations

import argparse
import asyncio
import re
import sys
from pathlib import Path

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))


def _slug(name: str) -> str:
    s = re.sub(r"[^a-z0-9]+", "-", (name or "source").lower()).strip("-")
    return s or "source"


async def _list_sources() -> int:
    from sqlalchemy import text as sa_text
    from src.db.session import async_session

    async with async_session() as db:
        result = await db.execute(sa_text(
            "SELECT id, name, type, db_type FROM data_sources ORDER BY created_at DESC LIMIT 50"
        ))
        rows = result.fetchall()
    if not rows:
        print("No data sources found.")
        return 1
    for r in rows:
        print(f"{r[0]}  {r[1]!r}  type={r[2]} db={r[3]}")
    return 0


async def _generate(data_source_id: str, out_dir: Path, dry_run: bool) -> int:
    from ee.modules.semantic.introspect import draft_manifest_files
    from ee.modules.semantic.loader import load_semantic_dir
    from src.db.session import async_session
    from src.modules.data.models import DataSource

    async with async_session() as db:
        ds = await db.get(DataSource, data_source_id)
        if not ds:
            print(f"Data source not found: {data_source_id}")
            return 1
        schema_info = ds.schema if isinstance(ds.schema, dict) else {}
        if not schema_info.get("tables") and schema_info.get("table"):
            # Single-table sources store {table, columns} — normalize
            schema_info = {"tables": [{
                "name": schema_info.get("table"),
                "schema": schema_info.get("schema") or "public",
                "columns": schema_info.get("columns") or [],
            }]}
        if not schema_info.get("tables"):
            print(f"Data source {data_source_id} has no stored schema tables; nothing to generate.")
            return 1
        dialect = ds.db_type or ds.type or "postgres"
        name = ds.name or data_source_id

    files = draft_manifest_files(
        schema_info,
        data_source_id=data_source_id,
        dialect=str(dialect),
        source_name=str(name),
    )

    target = out_dir / _slug(str(name))
    if dry_run:
        for rel, text in files.items():
            print(f"--- {target / rel} ---")
            print(text)
        return 0

    target.mkdir(parents=True, exist_ok=True)
    for rel, text in files.items():
        path = target / rel
        if path.exists():
            print(f"skip (exists): {path}")
            continue
        path.write_text(text)
        print(f"wrote: {path}")

    manifest, issues = load_semantic_dir(target)
    if issues:
        print("\nValidation issues:")
        for issue in issues:
            print(f"  {issue.file} [{issue.path}]: {issue.message}")
        return 1
    print(f"\nValidated OK: {len(manifest.tables)} table file(s) in {target}")
    return 0


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("--data-source-id")
    parser.add_argument("--out", default="../semantic", help="semantic/ root (default: repo root)")
    parser.add_argument("--dry-run", action="store_true")
    parser.add_argument("--list", action="store_true", help="list data sources and exit")
    args = parser.parse_args()

    if args.list:
        return asyncio.run(_list_sources())
    if not args.data_source_id:
        parser.error("--data-source-id is required (or use --list)")
    return asyncio.run(_generate(args.data_source_id, Path(args.out), args.dry_run))


if __name__ == "__main__":
    raise SystemExit(main())
