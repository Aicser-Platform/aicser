"""Tests for export artifacts service."""
import pytest

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
    rec = resolve_artifact(result["artifact_id"], "org-1")
    assert rec is not None


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
