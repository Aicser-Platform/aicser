"""Branded (McKinsey-style SCQA) PDF/PPTX report generation.

presentation_templates.py previously had a literal syntax error on line 1
(a stray "image.png" pasted before the module docstring's opening triple-
quote), so the module was completely unimportable -- every call site caught
the resulting exception and silently fell back to an unbranded artifact or a
bare error. These tests exist so that class of regression (an unimportable
module with zero coverage) can't hide again.
"""
from unittest.mock import AsyncMock

import pytest

from ee.modules.ai.services.brand_config_service import BrandConfig
from ee.modules.ai.services.export_artifacts_service import _scqa_shaped_context

SAMPLE_REPORT_SECTIONS = [
    {
        "id": "s1", "type": "kpi", "title": "Revenue Overview", "status": "complete",
        "narrative": "Total revenue reached $4.2M, up 18% from last quarter.",
        "key_metric": "Total Revenue", "key_metric_value": "$4.2M",
        "data": [{"region": "APAC", "revenue": 1800000}, {"region": "EMEA", "revenue": 1200000}],
    },
    {
        "id": "s2", "type": "trend", "title": "Churn Risk", "status": "complete",
        "narrative": "Churn ticked up 2pp in the SMB segment.",
        "key_metric": "SMB Churn Rate", "key_metric_value": "4.1%", "data": [],
    },
    {"id": "s3", "type": "trend", "title": "Pipeline Coverage", "status": "failed", "error": "timeout"},
]


def test_module_imports_cleanly():
    """Regression guard for the line-1 syntax error: a bad edit that breaks
    parsing must fail immediately and loudly, not vanish behind a try/except
    at every call site."""
    import ee.modules.ai.services.presentation_templates as pt

    assert hasattr(pt, "build_presentation")
    assert hasattr(pt, "build_scqa_pdf")
    assert hasattr(pt, "build_scqa_presentation")


def test_scqa_shaped_context_maps_report_sections():
    ctx = {"report_sections": SAMPLE_REPORT_SECTIONS}
    shaped = _scqa_shaped_context(ctx)

    # Only the 2 "complete" sections surface; the failed one is dropped.
    assert len(shaped["insights"]) == 2
    assert shaped["insights"][0]["title"] == "Revenue Overview"
    assert {k["label"] for k in shaped["kpis"]} == {"Total Revenue", "SMB Churn Rate"}
    assert any("4.2M" in f for f in shaped["data_facts"])


def test_scqa_shaped_context_falls_back_to_flat_insights_without_sections():
    ctx = {"insights": [{"title": "Foo", "description": "bar"}]}
    shaped = _scqa_shaped_context(ctx)
    assert shaped["insights"] == ctx["insights"]
    assert shaped["kpis"] == []


@pytest.mark.asyncio
async def test_build_scqa_pdf_produces_real_pdf(tmp_path, monkeypatch):
    pytest.importorskip("reportlab")
    monkeypatch.setenv("AISER_ARTIFACTS_DIR", str(tmp_path))
    from ee.modules.ai.services.presentation_templates import build_scqa_pdf

    ctx = {"report_sections": SAMPLE_REPORT_SECTIONS}
    shaped = _scqa_shaped_context(ctx)
    context = {
        "title": "Q3 Revenue Deep Dive",
        "executive_summary": "Revenue grew 18% QoQ.",
        "insights": shaped["insights"],
        "kpis": shaped["kpis"],
        "data_facts": shaped["data_facts"],
        "report_blocks": shaped["report_blocks"],
        "recommendations": [],
        "decision_brief": {},
    }
    out_path = tmp_path / "test_report.pdf"
    result = await build_scqa_pdf(context, BrandConfig(), out_path)

    assert result.exists()
    assert result.read_bytes()[:4] == b"%PDF"


@pytest.mark.asyncio
async def test_build_scqa_presentation_produces_real_pptx(tmp_path, monkeypatch):
    pytest.importorskip("pptx")
    monkeypatch.setenv("AISER_ARTIFACTS_DIR", str(tmp_path))
    from ee.modules.ai.services.presentation_templates import build_presentation

    ctx = {"report_sections": SAMPLE_REPORT_SECTIONS}
    shaped = _scqa_shaped_context(ctx)
    context = {
        "title": "Q3 Revenue Deep Dive",
        "executive_summary": "Revenue grew 18% QoQ.",
        "insights": shaped["insights"],
        "kpis": shaped["kpis"],
        "recommendations": [],
        "organization_id": "org-1",
        "conversation_id": "conv-1",
    }
    out_path = await build_presentation("scqa_executive", context, BrandConfig())

    assert out_path.exists()
    from pptx import Presentation
    prs = Presentation(str(out_path))
    assert len(prs.slides._sldIdLst) >= 3


@pytest.mark.asyncio
async def test_generate_pdf_uses_branded_builder_not_html_fallback(tmp_path, monkeypatch):
    pytest.importorskip("reportlab")
    monkeypatch.setenv("AISER_ARTIFACTS_DIR", str(tmp_path))
    monkeypatch.setattr(
        "ee.modules.ai.services.skill_entitlements.check_export_format_entitlement",
        AsyncMock(return_value=None),
    )
    from ee.modules.ai.services.export_artifacts_service import generate_pdf

    result = await generate_pdf({
        "organization_id": "org-1",
        "conversation_id": "conv-1",
        "chart_title": "Q3 Revenue Deep Dive",
        "report_sections": SAMPLE_REPORT_SECTIONS,
    })

    assert result.get("success") is True
    assert result.get("filename", "").endswith(".pdf")


@pytest.mark.asyncio
async def test_generate_pptx_uses_branded_builder_not_html_fallback(tmp_path, monkeypatch):
    pytest.importorskip("pptx")
    monkeypatch.setenv("AISER_ARTIFACTS_DIR", str(tmp_path))
    monkeypatch.setattr(
        "ee.modules.ai.services.skill_entitlements.check_export_format_entitlement",
        AsyncMock(return_value=None),
    )
    from ee.modules.ai.services.export_artifacts_service import generate_pptx

    result = await generate_pptx({
        "organization_id": "org-1",
        "conversation_id": "conv-1",
        "chart_title": "Q3 Revenue Deep Dive",
        "report_sections": SAMPLE_REPORT_SECTIONS,
    })

    assert result.get("success") is True
    assert result.get("filename", "").endswith(".pptx")
