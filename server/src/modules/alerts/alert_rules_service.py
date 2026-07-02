"""Community fallback for enterprise alert rules."""

from __future__ import annotations

from typing import Any


class AlertRulesService:
    def __init__(self, db: Any) -> None:
        self.db = db

    async def list_events(self, org_id: str, limit: int = 10) -> list[dict[str, Any]]:
        return []
