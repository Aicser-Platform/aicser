"""Tests for export artifacts service."""
import pytest
from unittest.mock import AsyncMock

from ee.modules.ai.services.export_artifacts_service import (
    generate_docx,
    generate_xlsx,
    generate_csv,
    resolve_artifact,
)


@pytest.mark.asyncio
async def test_generate_docx_from_context(tmp_path, monkeypatch):
    try:
        import docx  # noqa: F401
    except ImportError:
        pytest.skip("python-docx not installed")
    monkeypatch.setenv("AISER_ARTIFACTS_DIR", str(tmp_path))
    # docx is Pro+ (see plans.py's export_formats lists) — bypass the
    # entitlement lookup here since this test is about the document-assembly
    # logic, not plan gating (that's covered by test_generate_docx_denied_on_free_plan).
    monkeypatch.setattr(
        "ee.modules.ai.services.skill_entitlements.check_export_format_entitlement",
        AsyncMock(return_value=None),
    )
    result = await generate_docx(
        {
            "organization_id": "org-1",
            "conversation_id": "conv-1",
            "query": "Revenue report",
            "executive_summary": "Sales are up 10%.",
            "insights": [{"title": "Growth in Q1"}],
            "sql_query": "SELECT 1",
        }
    )
    assert result.get("success") is True
    assert result.get("filename", "").endswith(".docx")
    rec = await resolve_artifact(result["artifact_id"], "org-1")
    assert rec is not None


@pytest.mark.asyncio
async def test_generate_docx_denied_on_free_plan(tmp_path, monkeypatch):
    """docx is Pro+ (see plans.py) — an org with no paid subscription (or an
    unresolvable org id) must be denied, not silently exported for free.
    Regression guard: generate_docx used to have no entitlement check at all."""
    monkeypatch.setenv("AISER_ARTIFACTS_DIR", str(tmp_path))
    result = await generate_docx(
        {
            "organization_id": "org-1",
            "conversation_id": "conv-1",
            "query": "Revenue report",
        }
    )
    assert result.get("success") is False
    assert result.get("upgrade_required") is True
    assert result.get("feature") == "export_formats"


@pytest.mark.asyncio
async def test_generate_xlsx_requires_data():
    result = await generate_xlsx({"organization_id": "org-1", "query_result": []})
    assert result.get("success") is False


@pytest.mark.asyncio
async def test_generate_xlsx_with_rows(tmp_path, monkeypatch):
    try:
        import openpyxl  # noqa: F401
    except ImportError:
        pytest.skip("openpyxl not installed")
    monkeypatch.setenv("AISER_ARTIFACTS_DIR", str(tmp_path))
    monkeypatch.setattr(
        "ee.modules.ai.services.skill_entitlements.check_export_format_entitlement",
        AsyncMock(return_value=None),
    )
    result = await generate_xlsx(
        {
            "organization_id": "org-1",
            "conversation_id": "conv-1",
            "query_result": [{"region": "North", "sales": 100}, {"region": "South", "sales": 80}],
        }
    )
    assert result.get("success") is True
    assert ".xlsx" in result.get("filename", "")


@pytest.mark.asyncio
async def test_generate_xlsx_denied_on_free_plan(tmp_path, monkeypatch):
    """xlsx isn't in the free-tier export_formats list -- an org with no paid
    subscription (or an unresolvable org id) must be denied, not silently
    exported."""
    monkeypatch.setenv("AISER_ARTIFACTS_DIR", str(tmp_path))
    result = await generate_xlsx(
        {
            "organization_id": "org-1",
            "conversation_id": "conv-1",
            "query_result": [{"region": "North", "sales": 100}],
        }
    )
    assert result.get("success") is False
    assert result.get("upgrade_required") is True
    assert result.get("feature") == "export_formats"


@pytest.mark.asyncio
async def test_generate_csv(tmp_path, monkeypatch):
    monkeypatch.setenv("AISER_ARTIFACTS_DIR", str(tmp_path))
    result = await generate_csv(
        {
            "organization_id": "org-1",
            "query_result": [{"a": 1, "b": 2}],
        }
    )
    assert result.get("success") is True
    assert result.get("filename", "").endswith(".csv")
