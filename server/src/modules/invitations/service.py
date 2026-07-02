"""Community fallback for enterprise invitations."""

from __future__ import annotations

from typing import Any


class InvitationService:
    @staticmethod
    async def list_pending_invitations_for_email(db: Any, email: str) -> list[dict[str, Any]]:
        return []
