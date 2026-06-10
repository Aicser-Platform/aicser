"""CE shim: redirect src.modules.collaboration.* to ee/modules/collaboration/."""
import os

_ee_path = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "ee", "modules", "collaboration")
)

if os.path.isdir(_ee_path):
    __path__ = [_ee_path]
