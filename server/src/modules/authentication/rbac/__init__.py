"""
CE shim: extend package path so ``src.modules.authentication.rbac.*`` resolves EE modules.

``guard.py`` in this folder re-exports from ``ee.modules.authentication.rbac.guard``.
Other RBAC modules (models, decorators, rbac_service, …) live under ``ee/modules/authentication/rbac/``.
"""
import os

from src.core.edition import is_ee_enabled

_ee_rbac_path = os.path.normpath(
    os.path.join(os.path.dirname(os.path.abspath(__file__)), "..", "..", "..", "..", "ee", "modules", "authentication", "rbac")
)

if os.path.isdir(_ee_rbac_path) and _ee_rbac_path not in __path__:
    __path__.append(_ee_rbac_path)

if is_ee_enabled():
    from ee.modules.authentication.rbac import *  # noqa: F401, F403
    from ee.modules.authentication.rbac import __all__  # noqa: F401
else:
    from src.modules.authentication.rbac_service import has_dashboard_access

    __all__ = ["has_dashboard_access"]
