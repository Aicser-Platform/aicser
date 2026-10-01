"""CE shim: redirect src.modules.mlops.* to ee/modules/mlops/"""
import os as _os

from src.core.edition import is_ee_enabled

_ee_path = _os.path.normpath(_os.path.join(_os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "mlops"))
if is_ee_enabled() and _os.path.isdir(_ee_path):
    __path__ = [_ee_path]
