"""Import-system fix for the CE/EE module-shim architecture.

The problem
───────────
Many `src/modules/<name>/__init__.py` files are a thin CE-facing shim: when
EE is enabled, they redirect their own `__path__` to the matching
`ee/modules/<name>/` directory, so `from src.modules.<name>.X import Y` finds
its content there instead of failing (CE ships no code for these modules at
all - the redirect is what lets an optional `ee/` git submodule supply it).

That redirect only changes *where Python looks for a submodule it hasn't
loaded yet* - it does nothing for a name that's already resolved, and it does
nothing about the same file being reached under its other, direct name. Code
written *inside* `ee/` naturally imports its own siblings the absolute way -
`from ee.modules.<name>.X import Y` - since that's genuinely correct from
where that code lives. Both import spellings are individually "correct", but
Python's import system tracks modules purely by dotted name, not by file
path, so it has no way to know `src.modules.<name>.X` and `ee.modules.<name>.X`
are the same file. The result: every such module's top-level code - class
bodies very much included - runs twice, as two independent objects.

For a SQLAlchemy model this is a hard crash the first time both paths get
touched in one process ("Table 'x' is already defined for this MetaData
instance"), order- and combination-dependent enough to pass in isolation and
fail only in specific import sequences. For a plain ContextVar or a plain
class it's a silent split-brain: `set_stream_queue()` called through one name
is invisible to `get_stream_queue()` called through the other, and two
`isinstance()` checks against what looks like "the same" class can disagree.
Patched around all session with `__table_args__ = {"extend_existing": True}`
on individual models and by fixing individual test files to patch whichever
path production code actually resolves through - real, but symptom-level;
this closes the actual gap so neither category of bug can recur.

The fix
───────
A `sys.meta_path` finder: the first time anything imports
`src.modules.<name>.<rest>` for a `<name>` that genuinely uses the wholesale
shim pattern, it imports `ee.modules.<name>.<rest>` instead and aliases
`sys.modules[src-name]` to that exact object - not a copy, not a re-execution,
the same object both dotted paths now resolve to. Every subsequent import of
either name, from anywhere, is a cache hit onto that one object. Submodules
at any depth are covered automatically, with no per-file changes and no
`ee/`-side changes at all, because the finder acts once per dotted name the
first time it's imported, the same way Python's own import caching does.

Which `<name>`s this applies to is discovered by scanning `src/modules/*/`
for `__init__.py` files that actually contain the shim pattern (checked for
`is_ee_enabled` and `__path__` both appearing in the source), not by
hardcoding a list that would silently go stale, and not by merely checking
whether a same-named `ee/modules/<name>/` directory exists - some modules
(`data`, `charts`, `dashboards`, ...) have substantial native CE code in
`src/` *and* separate, additive EE-only files under `ee/modules/<name>/`;
redirecting those wholesale would break CE's own code, not fix anything.

Fails open by design: any error anywhere in this finder (a directory that
moved, a module that fails to import for its own unrelated reasons, EE not
enabled) makes it return None for that lookup, handing the import back to
Python's normal mechanism exactly as if this finder didn't exist. This must
never be the thing that turns a real import error into a confusing one.
"""

from __future__ import annotations

import importlib
import importlib.abc
import importlib.util
import logging
import os
import sys
from typing import Optional, Set

logger = logging.getLogger(__name__)

_SERVER_ROOT = os.path.abspath(os.path.join(os.path.dirname(__file__), "..", ".."))
_SRC_MODULES_DIR = os.path.join(_SERVER_ROOT, "src", "modules")
_EE_MODULES_DIR = os.path.join(_SERVER_ROOT, "ee", "modules")

_shimmed_roots_cache: Optional[Set[str]] = None


def _discover_shimmed_roots() -> Set[str]:
    """Scan src/modules/*/__init__.py once for the wholesale-shim pattern.

    Deliberately a text-content check ("is_ee_enabled" and "__path__" both
    present), not a hardcoded name list or an AST-exact match on one
    variable-naming convention - the real files use a couple of different
    local variable names (_ee_path, _ee_ai_path, ...) for the same pattern,
    so matching the two things that are actually load-bearing (the edition
    check, the __path__ reassignment) is both simpler and less likely to
    silently stop matching a real shim that's written slightly differently.
    """
    global _shimmed_roots_cache
    if _shimmed_roots_cache is not None:
        return _shimmed_roots_cache

    roots: Set[str] = set()
    try:
        for name in os.listdir(_SRC_MODULES_DIR):
            init_path = os.path.join(_SRC_MODULES_DIR, name, "__init__.py")
            if not os.path.isfile(init_path):
                continue
            try:
                with open(init_path, "r", encoding="utf-8") as fh:
                    source = fh.read()
            except OSError:
                continue
            if "is_ee_enabled" in source and "__path__" in source:
                # Only meaningful if there's actually an ee/modules/<name> to
                # redirect to - a shim with no EE counterpart checked out
                # (CE-only clone) has nothing for this finder to do.
                if os.path.isdir(os.path.join(_EE_MODULES_DIR, name)):
                    roots.add(name)
    except OSError as exc:
        logger.debug("ee_import_alias: root discovery skipped: %s", exc)
        roots = set()

    _shimmed_roots_cache = roots
    return roots


class _AliasLoader(importlib.abc.Loader):
    """Loader that hands back an already-imported module object as-is.

    exec_module() intentionally does nothing - the ee.modules.* import that
    produced `module` already ran its top-level code exactly once; running
    it again here would recreate the exact double-execution this whole
    mechanism exists to prevent.
    """

    def __init__(self, module):
        self._module = module

    def create_module(self, spec):
        return self._module

    def exec_module(self, module):
        pass


class _EEAliasFinder(importlib.abc.MetaPathFinder):
    """Redirects src.modules.<shimmed>.<rest> to the identical ee.modules
    object, so both dotted names always resolve to the same module."""

    def find_spec(self, fullname, path, target=None):
        try:
            return self._find_spec(fullname)
        except Exception as exc:  # never let this finder break an import
            logger.debug("ee_import_alias: %s lookup failed, falling through: %s", fullname, exc)
            return None

    def _find_spec(self, fullname: str):
        parts = fullname.split(".")
        if len(parts) < 3 or parts[0] != "src" or parts[1] != "modules":
            return None
        root = parts[2]
        if root not in _discover_shimmed_roots():
            return None

        from src.core.edition import is_ee_enabled

        if not is_ee_enabled():
            return None

        ee_name = "ee.modules." + ".".join(parts[2:])
        # importlib.import_module is itself a sys.modules-cache-checking
        # no-op when ee_name is already loaded, so this covers both cases
        # without this finder ever writing to sys.modules itself - leaving
        # that to Python's own _bootstrap._load, which is what actually
        # performs the parent.child attribute wiring (setattr(parent_module,
        # tail, module)) that make later `import src.modules.X.Y; X.Y.thing`
        # attribute-style access work, not just a sys.modules dict lookup.
        # A finder that pre-populates sys.modules itself short-circuits that
        # bootstrap step for the *parent* package spec, silently leaving the
        # already-loaded ee-side package missing the very submodule attribute
        # this whole mechanism exists to alias correctly.
        ee_module = importlib.import_module(ee_name)

        spec = importlib.util.spec_from_loader(fullname, _AliasLoader(ee_module), origin=getattr(ee_module, "__file__", None))
        # Package-shaped targets (anything with __path__, e.g. src.modules.chats
        # aliasing to ee.modules.chats) must declare submodule_search_locations,
        # or Python's bootstrap can't correctly resolve *children* of this
        # alias (src.modules.chats.models) as being part of a package at all.
        ee_path = getattr(ee_module, "__path__", None)
        if ee_path is not None:
            spec.submodule_search_locations = list(ee_path)
        return spec


_installed = False


def install() -> None:
    """Insert the alias finder at the front of sys.meta_path. Idempotent -
    safe to call from every entry point (main.py, the ARQ worker, ...) and
    from src.core.edition's own import, without double-installing."""
    global _installed
    if _installed:
        return
    sys.meta_path.insert(0, _EEAliasFinder())
    _installed = True
