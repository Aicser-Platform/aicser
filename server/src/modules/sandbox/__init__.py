"""Try-before-you-sign-up workspaces. Enterprise only; this shim points at ee/modules/sandbox."""
import os

from src.core.edition import is_ee_enabled

_ee_path = os.path.normpath(os.path.join(os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "sandbox"))
if is_ee_enabled() and os.path.isdir(_ee_path):
    __path__ = [_ee_path]
