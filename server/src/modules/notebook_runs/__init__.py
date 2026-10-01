"""CE shim: redirect src.modules.notebook_runs.* to ee/modules/notebook_runs/ (scheduled
notebook runs are an Enterprise feature)."""
import os as _os

from src.core.edition import is_ee_enabled

_ee_path = _os.path.normpath(_os.path.join(_os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "notebook_runs"))
if is_ee_enabled() and _os.path.isdir(_ee_path):
    __path__ = [_ee_path]
