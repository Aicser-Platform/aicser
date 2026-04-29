"""
CE shim: redirect src.modules.authentication.rbac.* imports to ee/modules/authentication/rbac/
"""
import os

_ee_rbac_path = os.path.normpath(
    os.path.join(os.path.dirname(__file__), "..", "..", "..", "..", "ee", "modules", "authentication", "rbac")
)

if os.path.isdir(_ee_rbac_path):
    __path__ = [_ee_rbac_path]
    from ee.modules.authentication.rbac import *  # noqa: F401, F403
    from ee.modules.authentication.rbac import __all__  # noqa: F401
