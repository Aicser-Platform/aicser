"""Scanned PDF pages (no text layer) are read as images; the rest of the document is unchanged."""

import pytest

fitz = pytest.importorskip("fitz")

from src.modules.knowledge.services import document_ingestion_service as ingest  # noqa: E402
from src.modules.knowledge.services.document_ingestion_service import DocumentIngestionService, RawSection  # noqa: E402


def _pdf(tmp_path):
    doc = fitz.open()
    doc.new_page().insert_text((72, 72), "Page one has a text layer.")
    doc.new_page()  # image-only page: nothing extractable
    path = tmp_path / "mixed.pdf"
    doc.save(str(path))
    return str(path)


@pytest.mark.asyncio
async def test_pages_without_text_are_sent_to_ocr(tmp_path, monkeypatch):
    seen = {}

    async def fake_ocr(self, file_path, pages, filename):
        seen["pages"] = pages
        return [RawSection(text="Scanned invoice total 990", page_number=p + 1, source_filename=filename, content_type="ocr") for p in pages]

    monkeypatch.setattr(DocumentIngestionService, "_ocr_pages", fake_ocr)
    svc = DocumentIngestionService.__new__(DocumentIngestionService)
    sections, meta = await svc._parse_pdf(_pdf(tmp_path), "mixed.pdf")
    assert seen["pages"] == [1]
    assert [s.page_number for s in sections] == [1, 2]
    assert meta["ocr_pages"] == 1 and meta["pages_without_text"] == 0


@pytest.mark.asyncio
async def test_without_a_vision_model_the_pages_are_counted(tmp_path, monkeypatch):
    async def no_ocr(self, file_path, pages, filename):
        return []

    monkeypatch.setattr(DocumentIngestionService, "_ocr_pages", no_ocr)
    svc = DocumentIngestionService.__new__(DocumentIngestionService)
    sections, meta = await svc._parse_pdf(_pdf(tmp_path), "mixed.pdf")
    assert len(sections) == 1 and meta["pages_without_text"] == 1
    assert ingest._OCR_MAX_PAGES >= 1
