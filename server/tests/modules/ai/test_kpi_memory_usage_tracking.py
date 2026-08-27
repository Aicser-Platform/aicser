"""load_org_kpi_context's usage_count was write-only until now - it ordered
matched definitions by usage_count but increment_kpi_usage() had zero callers
anywhere, so usage_count never moved off zero. Confirms it's now wired."""

import asyncio

import pytest

from ee.modules.ai.services import kpi_memory_service


@pytest.mark.asyncio
async def test_load_org_kpi_context_increments_usage_per_matched_definition(monkeypatch):
    calls: list = []

    async def fake_fetch(**kwargs):
        return [
            {"kpi_slug": "mrr", "kpi_name": "MRR", "sql_expression": "SUM(amount)", "required_tables": []},
            {"kpi_slug": "churn", "kpi_name": "Churn Rate", "sql_expression": "COUNT(*)", "required_tables": []},
        ]

    async def fake_increment(organization_id, kpi_slug, db_session=None):
        calls.append((organization_id, kpi_slug))

    monkeypatch.setattr(kpi_memory_service, "_fetch_matching_definitions", fake_fetch)
    monkeypatch.setattr(kpi_memory_service, "increment_kpi_usage", fake_increment)

    result = await kpi_memory_service.load_org_kpi_context("org-1", "what is our MRR and churn?")

    # increment_kpi_usage is fired via asyncio.ensure_future (fire-and-forget) -
    # give the event loop one tick to actually run those scheduled tasks.
    await asyncio.sleep(0)

    assert "MRR" in result
    assert "Churn Rate" in result
    assert ("org-1", "mrr") in calls
    assert ("org-1", "churn") in calls
    assert len(calls) == 2


@pytest.mark.asyncio
async def test_load_org_kpi_context_no_matches_no_usage_calls(monkeypatch):
    calls: list = []

    async def fake_fetch(**kwargs):
        return []

    async def fake_increment(organization_id, kpi_slug, db_session=None):
        calls.append((organization_id, kpi_slug))

    monkeypatch.setattr(kpi_memory_service, "_fetch_matching_definitions", fake_fetch)
    monkeypatch.setattr(kpi_memory_service, "increment_kpi_usage", fake_increment)

    result = await kpi_memory_service.load_org_kpi_context("org-1", "hello")
    await asyncio.sleep(0)

    assert result == ""
    assert calls == []
