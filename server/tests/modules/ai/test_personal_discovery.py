"""Suggested questions put what this person (and their role) actually asks first, per request."""

import pytest

from ee.modules.ai import router as ai_router


@pytest.mark.asyncio
async def test_learned_questions_lead_without_duplicates(monkeypatch):
    from ee.modules.ai.services import query_pattern_service as qps

    async def learned(self, ds_id, user_id, limit=3):
        assert user_id == "u1"
        return ["Revenue by branch last month", "Top 10 customers"]

    monkeypatch.setattr(qps.QueryPatternService, "get_personal_questions", learned)
    out = await ai_router._personalize_questions(["top 10 customers", "Monthly trend", "Churn by plan"], "ds", "u1", 4)
    assert out == ["Revenue by branch last month", "Top 10 customers", "Monthly trend", "Churn by plan"]


@pytest.mark.asyncio
async def test_no_history_leaves_suggestions_unchanged(monkeypatch):
    from ee.modules.ai.services import query_pattern_service as qps

    async def none(self, ds_id, user_id, limit=3):
        return []

    monkeypatch.setattr(qps.QueryPatternService, "get_personal_questions", none)
    assert await ai_router._personalize_questions(["A", "B"], "ds", None, 5) == ["A", "B"]
