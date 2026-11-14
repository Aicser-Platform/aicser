"""A configured OCR server is used alone: pages never fall back to a cloud model."""

import base64

import pytest

from src.modules.knowledge.services.document_ingestion_service import DocumentIngestionService
from src.shared import ocr_endpoint


@pytest.mark.asyncio
async def test_pages_go_only_to_the_configured_server(monkeypatch):
    monkeypatch.setenv("OCR_ENDPOINT_URL", "http://gpu:8000/v1")
    monkeypatch.setattr("src.shared.pdf.page_images", lambda path, pages, dpi=150: [(p, base64.b64encode(b"x").decode()) for p in pages])

    async def fake_read(png):
        return "Invoice total 990"

    monkeypatch.setattr(ocr_endpoint, "read_page", fake_read)
    svc = DocumentIngestionService.__new__(DocumentIngestionService)
    out = await svc._ocr_pages("a.pdf", [1], "a.pdf")
    assert [(s.text, s.page_number, s.content_type) for s in out] == [("Invoice total 990", 2, "ocr")]

    async def broken(png):
        raise RuntimeError("down")

    monkeypatch.setattr(ocr_endpoint, "read_page", broken)
    assert await svc._ocr_pages("a.pdf", [1], "a.pdf") == []
