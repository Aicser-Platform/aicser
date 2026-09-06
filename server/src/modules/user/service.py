"""
User Service
Reads and writes profile data directly from/to the `users` table.
"""

import logging
import uuid
from typing import Optional, Dict, Any

from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

logger = logging.getLogger(__name__)

# Columns that are safe to read/write via the profile endpoint
_PROFILE_COLUMNS = (
    "is_pro",
    "email",
    "username",
    "first_name",
    "last_name",
    "phone_number",
    "company",
    "location",
    "timezone",
    "bio",
    "job_role",
    "industry",
    "company_size",
    "data_experience",
    "primary_use_case",
    "data_frequency",
    "goals",
    "onboarding_completed_at",
    "avatar_url",
    "telegram_chat_id",
    "telegram_username",
    "telegram_status",
)


class UserService:
    def __init__(self, db: AsyncSession):
        self.db = db

    # ── helpers ──────────────────────────────────────────────────────────────

    @staticmethod
    def _to_uuid(user_id: str):
        return uuid.UUID(user_id) if isinstance(user_id, str) else user_id

    # ── read ─────────────────────────────────────────────────────────────────

    async def get_profile(self, user_id: str) -> Optional[Dict[str, Any]]:
        """Return profile data for *user_id* from the users table.

        Matches either the ``user_id`` column (Supabase/EE users) or the ``id``
        primary key (CE-registered users whose JWT ``sub`` equals their PK).
        """
        u_id = self._to_uuid(user_id)
        cols = ", ".join(_PROFILE_COLUMNS)
        result = await self.db.execute(
            text(
                f"SELECT id, user_id, {cols} FROM users"
                " WHERE user_id = :uid OR id = :uid"
                " LIMIT 1"
            ),
            {"uid": u_id},
        )
        row = result.fetchone()
        if not row:
            return None

        profile: Dict[str, Any] = {
            "id": str(row.id),
            "user_id": str(row.user_id),
        }
        for col in _PROFILE_COLUMNS:
            val = getattr(row, col, None)
            if hasattr(val, "isoformat"):
                val = val.isoformat()
            profile[col] = val
        return profile

    # ── write ────────────────────────────────────────────────────────────────

    async def update_profile(
        self, user_id: str, data: Dict[str, Any]
    ) -> Optional[Dict[str, Any]]:
        """
        Update allowed profile columns in the users table.
        Only keys present in *data* (and in _PROFILE_COLUMNS) are touched.
        Returns the refreshed profile on success, None if user not found.
        """
        import json

        u_id = self._to_uuid(user_id)

        # Filter to allowed writable columns (exclude read-only ones)
        _READONLY = {"onboarding_completed_at", "email", "is_pro", "telegram_chat_id", "telegram_username", "telegram_status"}
        allowed = {
            k: v
            for k, v in data.items()
            if k in _PROFILE_COLUMNS and k not in _READONLY and v is not None
        }
        if not allowed:
            return await self.get_profile(user_id)

        # Resolve the ONE real row first (same "user_id OR id" + LIMIT 1 match
        # get_profile already uses), then update strictly by its own primary
        # key. Doing the OR-match directly in the UPDATE's WHERE (as this used
        # to) touches every row satisfying it - normally just one, but a
        # single bad `user_id` value that happens to equal another row's `id`
        # (confirmed to exist in this DB: a dangling duplicate account whose
        # user_id pointed at a real account's id) makes it silently update
        # BOTH, overwriting one user's real profile data with another's every
        # time. Scoping to the resolved id closes that off entirely regardless
        # of what any row's user_id column happens to contain.
        resolved = await self.db.execute(
            text("SELECT id FROM users WHERE user_id = :uid OR id = :uid LIMIT 1"),
            {"uid": u_id},
        )
        resolved_row = resolved.fetchone()
        if not resolved_row:
            return None
        resolved_id = resolved_row.id

        # Build SET clause dynamically
        set_parts = []
        params: Dict[str, Any] = {"resolved_id": resolved_id}
        for col, val in allowed.items():
            set_parts.append(f"{col} = :{col}")
            # JSONB columns (goals) need json-serialised strings cast in SQL
            if col == "goals":
                params[col] = json.dumps(val) if not isinstance(val, str) else val
                set_parts[-1] = f"goals = CAST(:{col} AS jsonb)"
            else:
                params[col] = val

        set_clause = ", ".join(set_parts)
        await self.db.execute(
            text(f"""
                UPDATE users
                SET {set_clause},
                    updated_at = NOW()
                WHERE id = :resolved_id
            """),
            params,
        )
        await self.db.commit()
        return await self.get_profile(user_id)
