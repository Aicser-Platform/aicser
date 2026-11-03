"""Plug-in Registry — discovers and validates Aicser plug-in wheels."""

from __future__ import annotations

import importlib
import importlib.metadata
import importlib.resources
import logging
import os
import sys
import threading
import tomllib
from dataclasses import dataclass
from pathlib import Path
from typing import Any, Dict, List, Optional, Tuple

from src.core.edition import is_ee_enabled
from src.modules.plugins.manifest import (
    ConnectorContribution,
    Contribution,
    PluginManifest,
    VisualContribution,
)

logger = logging.getLogger(__name__)

ENTRY_POINT_GROUP = "aicser.plugins"

CORE_DB_TYPES = frozenset({"postgres", "postgresql", "mysql", "duckdb", "sqlite"})
CORE_CHART_TYPES = frozenset(
    {"line", "bar", "pie", "area", "scatter", "table", "metric", "stat", "donut", "radar"}
)


@dataclass
class PluginRegistration:
    manifest: PluginManifest
    package_dir: Optional[Path] = None
    resolved_assets_path: Optional[Path] = None
    source: str = "entry_point"


class PluginRegistry:
    """Thread-safe registry for Installed plug-ins and their Contributions."""

    def __init__(self) -> None:
        self._lock = threading.RLock()
        self._discovered = False
        self._registrations: Dict[str, PluginRegistration] = {}
        self._connectors: Dict[str, Tuple[str, ConnectorContribution]] = {}
        self._resolved_connectors: Dict[str, Any] = {}
        self._visuals: Dict[str, Tuple[str, VisualContribution]] = {}

    def reset(self) -> None:
        """Clear all registered plug-ins (used in unit tests)."""
        with self._lock:
            self._discovered = False
            self._registrations.clear()
            self._connectors.clear()
            self._resolved_connectors.clear()
            self._visuals.clear()

    def _ensure_discovered(self) -> None:
        if not self._discovered:
            self.discover()

    def discover(self, force: bool = False) -> None:
        """Discover installed plug-ins via `aicser.plugins` entry points (and local dev packages)."""
        with self._lock:
            if self._discovered and not force:
                return
            if force:
                self.reset()
            self._discovered = True

            ep_func = importlib.metadata.entry_points
            is_mocked = hasattr(ep_func, "_mock_name") or hasattr(ep_func, "assert_called")

            try:
                eps = ep_func(group=ENTRY_POINT_GROUP)
            except TypeError:
                # Fallback for older signatures returning a dict
                all_eps = ep_func()
                eps = all_eps.get(ENTRY_POINT_GROUP, []) if isinstance(all_eps, dict) else []
            except Exception as err:
                logger.error("Failed to query entry points for '%s': %s", ENTRY_POINT_GROUP, err)
                eps = []

            for ep in eps:
                self._load_entry_point(ep)

            # In real (non-mocked) environments, also scan local monorepo `server/plugins/*`
            # unless running in slim image mode where only pip-installed wheels should load.
            if not is_mocked and os.getenv("AISER_IMAGE_FLAVOR", "full").strip().lower() != "slim":
                self._discover_local_monorepo_plugins()

    def _load_entry_point(self, ep: Any) -> None:
        ep_name = getattr(ep, "name", str(ep))
        ep_value = getattr(ep, "value", str(ep))
        try:
            raw_obj = ep.load()
            if callable(raw_obj) and not isinstance(raw_obj, dict):
                raw_obj = raw_obj()
            if not isinstance(raw_obj, dict):
                logger.error(
                    "Entry point '%s' (%s) did not resolve to a dict (got %s); skipping",
                    ep_name,
                    ep_value,
                    type(raw_obj).__name__,
                )
                return

            package_dir: Optional[Path] = None
            module_name = ep_value.split(":", 1)[0].strip() if ":" in ep_value else ""
            if module_name:
                mod = sys.modules.get(module_name)
                if mod and getattr(mod, "__file__", None):
                    package_dir = Path(mod.__file__).resolve().parent

            self.register_manifest_dict(raw_obj, package_dir=package_dir, source=f"entry_point:{ep_name}")
        except Exception as err:
            logger.error("Failed to load plug-in entry point '%s' (%s): %s", ep_name, ep_value, err)

    def _discover_local_monorepo_plugins(self) -> None:
        server_root = Path(__file__).resolve().parents[3]
        search_roots = [server_root / "plugins"]
        if is_ee_enabled():
            search_roots.append(server_root / "ee" / "plugins")

        for root in search_roots:
            if not root.is_dir():
                continue
            for plugin_dir in sorted(root.iterdir()):
                if not plugin_dir.is_dir():
                    continue
                pyproject_file = plugin_dir / "pyproject.toml"
                if not pyproject_file.is_file():
                    continue
                try:
                    data = tomllib.loads(pyproject_file.read_text(encoding="utf-8"))
                    ep_table = (
                        data.get("project", {})
                        .get("entry-points", {})
                        .get(ENTRY_POINT_GROUP, {})
                    )
                    if not isinstance(ep_table, dict):
                        continue
                    for ep_name, target in ep_table.items():
                        if ":" not in target:
                            continue
                        mod_name, attr_name = target.split(":", 1)
                        pkg_root_str = str(plugin_dir.resolve())
                        if pkg_root_str not in sys.path:
                            sys.path.insert(0, pkg_root_str)
                        mod = importlib.import_module(mod_name.strip())
                        raw_manifest = getattr(mod, attr_name.strip())
                        if isinstance(raw_manifest, dict):
                            manifest_id = raw_manifest.get("id")
                            if manifest_id and manifest_id in self._registrations:
                                continue
                            pkg_dir = (
                                Path(mod.__file__).resolve().parent
                                if getattr(mod, "__file__", None)
                                else plugin_dir
                            )
                            self.register_manifest_dict(
                                raw_manifest,
                                package_dir=pkg_dir,
                                source=f"local:{ep_name}",
                            )
                except Exception as err:
                    logger.error(
                        "Failed to load local plug-in from '%s': %s",
                        plugin_dir,
                        err,
                    )

    def register_manifest_dict(
        self,
        raw_manifest: Dict[str, Any],
        package_dir: Optional[Path] = None,
        source: str = "manual",
    ) -> Optional[PluginManifest]:
        """Validate and register a raw manifest dictionary."""
        with self._lock:
            try:
                manifest = PluginManifest.model_validate(raw_manifest)
            except Exception as err:
                logger.error("Invalid plug-in manifest from %s: %s", source, err)
                return None

            if manifest.id in self._registrations:
                logger.warning(
                    "Duplicate plugin id '%s' from %s; skipping",
                    manifest.id,
                    source,
                )
                return None

            accepted_contributions: List[Contribution] = []
            for contrib in manifest.contributions:
                if isinstance(contrib, ConnectorContribution):
                    db_t = contrib.db_type.lower()
                    if db_t in CORE_DB_TYPES:
                        logger.warning(
                            "Plug-in '%s' attempted to register reserved Core db_type '%s'; skipping contribution",
                            manifest.id,
                            db_t,
                        )
                        continue
                    if db_t in self._connectors:
                        existing_owner = self._connectors[db_t][0]
                        logger.warning(
                            "Plug-in '%s' db_type '%s' collides with '%s'; skipping contribution",
                            manifest.id,
                            db_t,
                            existing_owner,
                        )
                        continue
                    self._connectors[db_t] = (manifest.id, contrib)
                    accepted_contributions.append(contrib)

                elif isinstance(contrib, VisualContribution):
                    chart_t = contrib.chart_type.lower()
                    if chart_t in CORE_CHART_TYPES:
                        logger.warning(
                            "Plug-in '%s' attempted to register reserved Core chart_type '%s'; skipping contribution",
                            manifest.id,
                            chart_t,
                        )
                        continue
                    if chart_t in self._visuals:
                        existing_owner = self._visuals[chart_t][0]
                        logger.warning(
                            "Plug-in '%s' chart_type '%s' collides with '%s'; skipping contribution",
                            manifest.id,
                            chart_t,
                            existing_owner,
                        )
                        continue
                    self._visuals[chart_t] = (manifest.id, contrib)
                    accepted_contributions.append(contrib)
                else:
                    accepted_contributions.append(contrib)

            manifest.contributions = accepted_contributions

            resolved_assets: Optional[Path] = None
            if manifest.assets_dir and package_dir:
                candidate = (package_dir / manifest.assets_dir).resolve()
                if candidate.is_relative_to(package_dir.resolve()):
                    resolved_assets = candidate

            self._registrations[manifest.id] = PluginRegistration(
                manifest=manifest,
                package_dir=package_dir,
                resolved_assets_path=resolved_assets,
                source=source,
            )
            return manifest

    def get_manifest(self, plugin_id: str) -> Optional[PluginManifest]:
        self._ensure_discovered()
        with self._lock:
            reg = self._registrations.get((plugin_id or "").lower())
            return reg.manifest if reg else None

    def get_all_manifests(self) -> List[PluginManifest]:
        self._ensure_discovered()
        with self._lock:
            return [reg.manifest for reg in self._registrations.values()]

    def get_connector_db_types(self) -> set[str]:
        self._ensure_discovered()
        with self._lock:
            return set(self._connectors.keys())

    def is_plugin_connector(self, db_type: str) -> bool:
        self._ensure_discovered()
        with self._lock:
            return (db_type or "").lower() in self._connectors

    def get_plugin_id_for_db_type(self, db_type: str) -> Optional[str]:
        self._ensure_discovered()
        with self._lock:
            entry = self._connectors.get((db_type or "").lower())
            return entry[0] if entry else None

    def get_connector_contribution(
        self, db_type: str
    ) -> Optional[Tuple[PluginManifest, ConnectorContribution]]:
        self._ensure_discovered()
        with self._lock:
            entry = self._connectors.get((db_type or "").lower())
            if not entry:
                return None
            plugin_id, contrib = entry
            reg = self._registrations.get(plugin_id)
            return (reg.manifest, contrib) if reg else None

    def get_connector(self, db_type: str) -> Optional[Any]:
        """Lazily import and return the connector implementation for `db_type`."""
        self._ensure_discovered()
        key = (db_type or "").lower()
        with self._lock:
            if key in self._resolved_connectors:
                return self._resolved_connectors[key]
            entry = self._connectors.get(key)
            if not entry:
                return None
            _, contrib = entry
            target = contrib.target

        mod_name, attr_name = target.split(":", 1)
        try:
            module = importlib.import_module(mod_name.strip())
            attr = getattr(module, attr_name.strip())
            instance = attr() if isinstance(attr, type) else attr
        except (ImportError, AttributeError) as err:
            raise RuntimeError(f"Failed to load connector for '{key}': {err}") from err

        with self._lock:
            self._resolved_connectors[key] = instance
        return instance

    def get_visual(
        self, chart_type: str
    ) -> Optional[Tuple[PluginManifest, VisualContribution]]:
        self._ensure_discovered()
        with self._lock:
            entry = self._visuals.get((chart_type or "").lower())
            if not entry:
                return None
            plugin_id, contrib = entry
            reg = self._registrations.get(plugin_id)
            return (reg.manifest, contrib) if reg else None

    def get_assets_dir(self, plugin_id: str) -> Optional[Path]:
        self._ensure_discovered()
        with self._lock:
            reg = self._registrations.get((plugin_id or "").lower())
            return reg.resolved_assets_path if reg else None

    def get_asset_path(self, plugin_id: str, relative_path: str) -> Optional[Path]:
        """Safely resolve a file inside `assets_dir`, returning None on traversal or missing file."""
        if not relative_path or "\0" in relative_path or "\\" in relative_path:
            return None
        assets_dir = self.get_assets_dir(plugin_id)
        if not assets_dir or not assets_dir.is_dir():
            return None
        try:
            assets_root = assets_dir.resolve()
            # Reject symlinks in path segments or final file pointing outside assets_root
            candidate = (assets_root / relative_path).resolve()
            if not candidate.is_relative_to(assets_root):
                return None
            if not candidate.is_file():
                return None
            return candidate
        except Exception:
            return None


registry = PluginRegistry()

