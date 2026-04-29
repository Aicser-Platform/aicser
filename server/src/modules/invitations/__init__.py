"""CE shim: redirect src.modules.invitations.* to ee/modules/invitations/"""
import os as _os
_ee_path = _os.path.normpath(_os.path.join(_os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "invitations"))
if _os.path.isdir(_ee_path):
    __path__ = [_ee_path]
