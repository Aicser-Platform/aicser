"""Notebook comments: saved threads on a notebook or one of its cells (rules and shape in
src/shared/comment_threads.py; the router checks who can open the notebook)."""

from __future__ import annotations

from typing import Any, Dict, List, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.notebooks.models import Notebook, NotebookComment
from src.shared.comment_threads import CommentThreads

threads = CommentThreads(NotebookComment, "notebook_id", "cell_id")


async def list_threads(db: AsyncSession, nb: Notebook) -> List[Dict[str, Any]]:
    return await threads.list_threads(db, nb.id)


async def create(db: AsyncSession, nb: Notebook, user_id: str, body: str, *,
                 cell_id: Optional[str] = None, parent_id: Optional[str] = None) -> Dict[str, Any]:
    return await threads.create(db, nb.id, user_id, body, anchor=cell_id, parent_id=parent_id)


async def edit(db: AsyncSession, nb: Notebook, comment_id: str, user_id: str, body: str) -> Dict[str, Any]:
    return await threads.edit(db, nb.id, comment_id, user_id, body)


async def set_resolved(db: AsyncSession, nb: Notebook, comment_id: str, user_id: str, resolved: bool) -> Dict[str, Any]:
    return await threads.set_resolved(db, nb.id, comment_id, user_id, resolved)


async def delete(db: AsyncSession, nb: Notebook, comment_id: str, user_id: str) -> Dict[str, Any]:
    return await threads.delete(db, nb.id, nb.user_id, comment_id, user_id)
