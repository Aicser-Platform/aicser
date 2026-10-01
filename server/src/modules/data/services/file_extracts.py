"""File extracts: parse an uploaded file once, query the parsed copy afterwards.

Every query on a file source used to re-read the whole CSV / JSON / Excel file into a fresh
in-memory table. The first load now also writes those tables to a DuckDB file keyed by the
upload; later queries attach it read-only and read through views, so DuckDB scans only the
columns and row groups a query needs (the same idea as Tableau extracts or Power BI import).

Keys include the upload's object key and the source's updated_at, so replacing the file or
editing the source makes a new extract; old ones are removed when the source changes and by a
size / count cap. Security is unchanged: row and column rules rewrite or gate the SQL before it
runs, and the extract holds exactly what the upload already held.
"""

from __future__ import annotations

import glob
import hashlib
import logging
import os
import re
import uuid
from typing import Any, Dict, List, Optional

logger = logging.getLogger(__name__)

_ATTACH_AS = "aicser_extract"
_SAFE_ID = re.compile(r"[^A-Za-z0-9_-]")


def extract_dir() -> str:
    base = os.getenv("AISER_EXTRACT_DIR") or os.path.join(os.getenv("UPLOAD_DIR", "uploads"), "extracts")
    os.makedirs(base, exist_ok=True)
    return base


def enabled() -> bool:
    return os.getenv("AISER_FILE_EXTRACTS", "on").strip().lower() not in ("0", "off", "false", "no")


def extract_path(data_source: Dict[str, Any]) -> Optional[str]:
    """Where this source's extract lives, or None when the upload can't be identified."""
    source_id = str(data_source.get("id") or "").strip()
    location = data_source.get("file_path") or ((data_source.get("schema") or {}).get("storage") or {}).get("object_key")
    if not source_id or not location:
        return None
    parts = [str(location), str(data_source.get("updated_at") or ""), str(data_source.get("format") or "")]
    if isinstance(location, str) and os.path.isfile(location):  # a local file: its own size and time
        st = os.stat(location)
        parts += [str(st.st_size), str(int(st.st_mtime))]
    digest = hashlib.sha256("\u0000".join(parts).encode()).hexdigest()[:24]
    return os.path.join(extract_dir(), f"{_SAFE_ID.sub('_', source_id)}-{digest}.duckdb")


def _quote(name: str) -> str:
    return '"' + str(name).replace('"', '""') + '"'


def attach(conn: Any, path: str) -> List[str]:
    """Expose every table of an extract as a view in the main schema; returns the table names."""
    safe = path.replace("'", "''")
    conn.execute(f"ATTACH '{safe}' AS {_ATTACH_AS} (READ_ONLY)")
    names = [
        r[0]
        for r in conn.execute(
            f"SELECT table_name FROM duckdb_tables() WHERE database_name = '{_ATTACH_AS}' AND schema_name = 'main'"
        ).fetchall()
    ]
    if not names:
        raise ValueError("empty extract")
    for name in names:
        conn.execute(f"CREATE OR REPLACE VIEW {_quote(name)} AS SELECT * FROM {_ATTACH_AS}.main.{_quote(name)}")
    return names


def write(conn: Any, path: str) -> None:
    """Save the tables just loaded into the in-memory database as this source's extract."""
    names = [
        r[0]
        for r in conn.execute(
            "SELECT table_name FROM duckdb_tables() WHERE database_name = current_database() AND schema_name = 'main'"
        ).fetchall()
    ]
    if not names:
        return
    tmp = f"{path}.{uuid.uuid4().hex}.tmp"
    safe = tmp.replace("'", "''")
    conn.execute(f"ATTACH '{safe}' AS aicser_extract_out")
    try:
        for name in names:
            conn.execute(f"CREATE TABLE aicser_extract_out.main.{_quote(name)} AS SELECT * FROM main.{_quote(name)}")
    finally:
        conn.execute("DETACH aicser_extract_out")
    os.replace(tmp, path)  # atomic: a reader never sees a half-written extract
    prune()


def drop_for_source(data_source_id: Optional[str]) -> None:
    """Remove a source's extracts (it was edited, re-uploaded or deleted)."""
    if not data_source_id:
        return
    for path in glob.glob(os.path.join(extract_dir(), f"{_SAFE_ID.sub('_', str(data_source_id))}-*.duckdb")):
        try:
            os.remove(path)
        except OSError:
            pass


def prune() -> None:
    """Keep the extract folder within AISER_EXTRACT_MAX_MB (default 5 GB), oldest removed first."""
    cap = int(os.getenv("AISER_EXTRACT_MAX_MB", "5120")) * 1024 * 1024
    files = sorted(glob.glob(os.path.join(extract_dir(), "*.duckdb")), key=os.path.getmtime, reverse=True)
    total = 0
    for path in files:
        try:
            total += os.path.getsize(path)
            if total > cap:
                os.remove(path)
        except OSError:
            continue
