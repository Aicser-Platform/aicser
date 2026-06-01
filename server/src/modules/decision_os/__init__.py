"""CE shim: redirect src.modules.decision_os.* to ee/modules/decision_os/ when EE is present."""
import os as _os

_ee_path = _os.path.normpath(
    _os.path.join(_os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "decision_os")
)
if _os.path.isdir(_ee_path):
    __path__ = [_ee_path]
