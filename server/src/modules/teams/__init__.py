"""CE shim for Teams bot module."""
import os as _os
import sys as _sys

_ee_root = _os.path.normpath(_os.path.join(_os.path.dirname(__file__), "..", "..", "..", "ee"))
if _os.path.isdir(_ee_root) and _ee_root not in _sys.path:
    _sys.path.insert(0, _ee_root)
