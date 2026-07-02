import os

from src.core.edition import is_ee_enabled

_ee_ai_path = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "ai")
)

if is_ee_enabled() and os.path.isdir(_ee_ai_path):
    __path__ = [_ee_ai_path]
