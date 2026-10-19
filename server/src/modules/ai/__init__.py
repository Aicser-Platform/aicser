import os

from src.core.edition import is_ee_enabled

_ce_ai_path = os.path.dirname(os.path.abspath(__file__))
_ee_ai_path = os.path.normpath(
    os.path.join(_ce_ai_path, "..", "..", "..", "ee", "modules", "ai")
)

# EE modules shadow CE by name; CE-only helpers (e.g. surface_context_schema) stay importable.
if is_ee_enabled() and os.path.isdir(_ee_ai_path):
    __path__ = [_ee_ai_path, _ce_ai_path]
