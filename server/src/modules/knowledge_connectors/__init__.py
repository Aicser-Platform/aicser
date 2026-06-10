"""CE shim: redirect src.modules.knowledge_connectors.* to ee/modules/knowledge_connectors/"""
import os as _os
import sys as _sys

_ee_path = _os.path.normpath(_os.path.join(_os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "knowledge_connectors"))
if _os.path.isdir(_ee_path) and _ee_path not in _sys.path:
    _sys.path.insert(0, _os.path.normpath(_os.path.join(_os.path.dirname(__file__), "..", "..", "..", "ee")))
