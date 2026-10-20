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
Community code never names `ee.` itself. Two spellings reach Enterprise code:
`src.modules.<name>.*` for wholesale shims, and `src.enterprise.<rest>` (aliased
to `ee.<rest>`) for EE files added next to a CE module that has code of its own
(`data`, `authentication`, `knowledge`, ...). Without EE enabled or checked out,
`src.enterprise.*` simply doesn't exist (ImportError), like any optional module.

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
    """Loader that hands back the ee.* module object itself.

    The ee import happens here, in create_module(), not in the finder: Python calls finders
    while holding its global import lock, and running a module's code under that lock
    deadlocks as soon as the module imports something another thread is loading (seen with
    the embedding warm-up thread loading sentence_transformers while /health imported an EE
    module). Loading runs under only this module's own lock, where nested imports are safe.

    exec_module() intentionally does nothing - the ee.* import already ran its top-level code
    exactly once; running it again would recreate the double-execution this mechanism prevents.
    """

    def __init__(self, ee_name: str, ce_dir: Optional[str] = None):
        self._ee_name = ee_name
        self._ce_dir = ce_dir

    def create_module(self, spec):
        module = importlib.import_module(self._ee_name)
        # A shimmed package keeps its CE-only files importable (the shim's own __path__ lists
        # both folders; the alias would otherwise replace it with the EE folder alone): EE wins
        # a name that exists in both, a name only CE has (e.g. src.modules.ai.surface_context_schema)
        # is still found.
        if self._ce_dir and hasattr(module, "__path__") and self._ce_dir not in list(module.__path__):
            module.__path__.append(self._ce_dir)
        return module

    def exec_module(self, module):
        pass


def _ee_location(ee_name: str):
    """(origin file, package directory or None) for an ee.* name, read from disk only - finding
    it through importlib would import its parent packages, which is what must not happen here."""
    base = os.path.join(_SERVER_ROOT, *ee_name.split("."))
    if os.path.isdir(base):
        init = os.path.join(base, "__init__.py")
        return (init if os.path.isfile(init) else None), base
    if os.path.isfile(base + ".py"):
        return base + ".py", None
    return None


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
        if len(parts) < 3 or parts[0] != "src" or parts[1] not in ("modules", "enterprise"):
            return None
        if parts[1] == "modules" and parts[2] not in _discover_shimmed_roots():
            return None

        from src.core.edition import is_ee_enabled

        if not is_ee_enabled():
            return None

        # src.modules.<shimmed>.<rest> → ee.modules.<shimmed>.<rest>; src.enterprise.<rest> → ee.<rest>
        # (additive EE code next to a CE module with its own code, e.g. ee.modules.data.services.*).
        ee_name = ("ee.modules." if parts[1] == "modules" else "ee.") + ".".join(parts[2:])
        # The finder only locates the file; the loader imports it (see _AliasLoader). Python's
        # own _bootstrap._load still writes sys.modules and wires parent.child attributes, so
        # `import src.modules.X.Y; X.Y.thing` works as for any module.
        location = _ee_location(ee_name)
        if location is None:
            return None  # no such ee module: let the normal import report it
        origin, package_dir = location
        ce_dir = None
        if parts[1] == "modules" and package_dir is not None:
            candidate = os.path.join(_SRC_MODULES_DIR, *parts[2:])
            ce_dir = candidate if os.path.isdir(candidate) else None
        spec = importlib.util.spec_from_loader(fullname, _AliasLoader(ee_name, ce_dir), origin=origin)
        # Package-shaped targets (e.g. src.modules.chats aliasing to ee.modules.chats) must
        # declare submodule_search_locations, or Python's bootstrap can't resolve *children* of
        # this alias (src.modules.chats.models) as part of a package at all.
        if package_dir is not None:
            spec.submodule_search_locations = [package_dir] + ([ce_dir] if ce_dir else [])
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
