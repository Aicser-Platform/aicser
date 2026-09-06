"""OrgContextService — composition layer over KPI memory and smart-context
personalization.

get_similar_patterns()/get_schema_rag_tables()/build_full_context() were
removed 2026-09-01: an audit found zero callers of any of the three outside
this file's own tests -- both jobs are already done elsewhere (few_shot_
retrieval.py for NL2SQL few-shot; rag_retrieval_node.py's own schema_
retrieval_service call for RAG), so they were dead, duplicate implementations
rather than a gap to wire in.
"""
from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.services.org_context_service import OrgContextService


@pytest.mark.asyncio
async def test_get_kpi_context_empty_org_id_short_circuits():
    svc = OrgContextService()
    result = await svc.get_kpi_context(None, "revenue trend")
    assert result == ""


@pytest.mark.asyncio
async def test_get_kpi_context_delegates_to_kpi_memory_service():
    svc = OrgContextService()
    with patch(
        "ee.modules.ai.services.kpi_memory_service.load_org_kpi_context",
        new=AsyncMock(return_value="BUSINESS CONTEXT (org-verified KPI definitions):\n- MRR: ..."),
    ) as mock_load:
        result = await svc.get_kpi_context("org-1", "what is MRR", "ds-1", max_definitions=5)
    assert "MRR" in result
    mock_load.assert_awaited_once_with(
        organization_id="org-1", query="what is MRR", data_source_id="ds-1", max_definitions=5,
    )


@pytest.mark.asyncio
async def test_get_kpi_context_fails_open_on_exception():
    svc = OrgContextService()
    with patch(
        "ee.modules.ai.services.kpi_memory_service.load_org_kpi_context",
        new=AsyncMock(side_effect=RuntimeError("db down")),
    ):
        result = await svc.get_kpi_context("org-1", "revenue")
    assert result == ""


@pytest.mark.asyncio
async def test_get_smart_context_fails_open_on_exception():
    svc = OrgContextService()
    with patch(
        "ee.modules.ai.services.smart_context_engineer.get_smart_context_engineer",
        side_effect=RuntimeError("engineer init failed"),
    ):
        result = await svc.get_smart_context(query="hi", user_id="u", organization_id="o")
    assert result == {}
