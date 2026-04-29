"""CE shim: redirect src.modules.lakehouse.* to ee/modules/lakehouse/"""
import os as _os
_ee_path = _os.path.normpath(_os.path.join(_os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "lakehouse"))
if _os.path.isdir(_ee_path):
    __path__ = [_ee_path]
