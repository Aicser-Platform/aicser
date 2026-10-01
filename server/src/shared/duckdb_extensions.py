"""DuckDB extensions used by location analysis (spatial, h3) and the Enterprise warehouse
(iceberg, httpfs).

The image installs them at build time (Dockerfile.prod), so a running server never downloads
code. Outside the image (local development, tests) a missing extension is installed on first
use unless ``DUCKDB_EXTENSIONS_OFFLINE`` is set. Licences: spatial, iceberg and httpfs are MIT
(spatial bundles GEOS, LGPL-2.1, and PROJ/GDAL, MIT); the h3 community extension is Apache-2.0.
"""

from __future__ import annotations

import logging
import os
import threading
from typing import Iterable

logger = logging.getLogger(__name__)

_COMMUNITY = {"h3"}
_lock = threading.Lock()


class DuckDBExtensionUnavailable(RuntimeError):
    """An extension isn't installed and can't be installed here."""


def load_extensions(conn, names: Iterable[str]) -> None:
    """LOAD each extension on ``conn``, installing it first when allowed."""
    for name in names:
        try:
            conn.execute(f"LOAD {name}")
            continue
        except Exception:
            pass
        if os.getenv("DUCKDB_EXTENSIONS_OFFLINE", "").lower() in ("1", "true", "yes"):
            raise DuckDBExtensionUnavailable(f"The {name} extension isn't installed on this server.")
        with _lock:
            try:
                source = " FROM community" if name in _COMMUNITY else ""
                conn.execute(f"INSTALL {name}{source}")
                conn.execute(f"LOAD {name}")
                logger.info("Installed DuckDB extension %s", name)
            except Exception as exc:
                raise DuckDBExtensionUnavailable(f"The {name} extension couldn't be loaded: {exc}") from exc
