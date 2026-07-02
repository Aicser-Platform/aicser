"""Community-edition RBAC decorators.

CE does not ship organization/project RBAC tables. These decorators preserve
route signatures while leaving authorization to the normal auth dependencies.
"""

from __future__ import annotations

from functools import wraps
from typing import Any, Callable

from src.core.edition import is_ee_enabled


if is_ee_enabled():
    from ee.modules.authentication.rbac.decorators import (  # noqa: F401
        get_role_permissions,
        require_permission,
        require_role,
    )
else:

    def require_permission(
        permission: str,
        resource_type: str | None = None,
        resource_id_param: str | None = None,
    ) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            @wraps(func)
            async def wrapper(*args: Any, **kwargs: Any) -> Any:
                return await func(*args, **kwargs)

            return wrapper

        return decorator

    def require_role(role_name: str, resource_type: str | None = None) -> Callable[[Callable[..., Any]], Callable[..., Any]]:
        def decorator(func: Callable[..., Any]) -> Callable[..., Any]:
            @wraps(func)
            async def wrapper(*args: Any, **kwargs: Any) -> Any:
                return await func(*args, **kwargs)

            return wrapper

        return decorator

    def get_role_permissions(role_name: str) -> set[str]:
        return set()
