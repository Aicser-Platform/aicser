"""Community fallback for project services.

Projects are an enterprise workspace feature. CE routes still accept
``project_id`` in a few shared paths, so this stub keeps public builds
importable without pulling in EE modules.
"""

from __future__ import annotations

from typing import Any


class ProjectService:
    @staticmethod
    async def get_user_projects(user_id: str, *args: Any, **kwargs: Any) -> tuple[list[Any], int]:
        return [], 0

    @staticmethod
    async def add_data_source_to_project(*args: Any, **kwargs: Any) -> None:
        return None
