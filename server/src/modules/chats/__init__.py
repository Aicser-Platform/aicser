"""CE shim: redirect src.modules.chats.* to ee/modules/chats/"""
import os as _os
_ee_path = _os.path.normpath(_os.path.join(_os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "chats"))
if _os.path.isdir(_ee_path):
    __path__ = [_ee_path]
