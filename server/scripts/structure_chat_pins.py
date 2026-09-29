"""Convert charts pinned from AI chat to table + fields where their SQL has an exact equivalent.

    python -m scripts.structure_chat_pins            # dry run: list what would change
    python -m scripts.structure_chat_pins --apply    # write the changes

New pins are converted when they are created; this brings earlier pins in line. The original
saved query id and SQL are kept on the chart (origin_saved_query_id / origin_sql), so every
change can be traced and reverted.
"""

from __future__ import annotations

import argparse
import asyncio
import json


async def run(apply: bool) -> int:
    import src.main  # noqa: F401  (registers every ORM model the lookups touch)
    from sqlalchemy import text

    from src.db.session import async_session
    from src.modules.charts.services.sql_to_chart_query import structure_pinned_chart

    async with async_session() as db:
        rows = (await db.execute(text(
            "SELECT id::text, title, chart_query, chart_options, data_source_id, project_id FROM charts "
            "WHERE NOT COALESCE(is_deleted, false) AND chart_options->>'__source' = 'ai_chat' "
            "AND (chart_query ? 'saved_query_id' OR chart_options ? 'sample_sql') "
            "AND NOT (chart_query ? 'origin_sql')"))).all()
        changed = 0
        for cid, title, query, options, ds_id, project_id in rows:
            payload = {
                "chart_query": dict(query or {}),
                "chart_options": dict(options or {}),
                "data_source_id": ds_id,
            }
            out = await structure_pinned_chart(db, payload, project_id)
            if "origin_sql" not in (out.get("chart_query") or {}):
                continue
            changed += 1
            q = out["chart_query"]
            print(f"{cid}  {title!r}: {q.get('tableName')} · x={q.get('x')} · "
                  + ", ".join(f"{m['aggregation']}({m['field']})" for m in q.get("yMetrics") or []))
            if apply:
                await db.execute(text(
                    "UPDATE charts SET chart_query = CAST(:q AS jsonb), chart_options = CAST(:o AS jsonb), "
                    "data_source_id = :ds, updated_at = now() WHERE id::text = :id"),
                    {"q": json.dumps(q), "o": json.dumps(out["chart_options"]), "ds": out["data_source_id"], "id": cid})
        if apply:
            await db.commit()
    print(f"\n{changed} of {len(rows)} chat chart(s) {'converted' if apply else 'would be converted (dry run; pass --apply)'}")
    return 0


def main() -> None:
    ap = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    ap.add_argument("--apply", action="store_true")
    asyncio.run(run(ap.parse_args().apply))


if __name__ == "__main__":
    main()
