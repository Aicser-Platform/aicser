"""Scanned PDF pages (no text layer) are read as images; the rest of the document is unchanged."""

import pytest

pypdfium2 = pytest.importorskip("pypdfium2")

from src.modules.knowledge.services import document_ingestion_service as ingest  # noqa: E402
from src.modules.knowledge.services.document_ingestion_service import DocumentIngestionService, RawSection  # noqa: E402


def _pdf(tmp_path):
    """Two pages: one with a text layer, one with nothing extractable (built by hand, no writer lib)."""
    stream = b"BT /F1 12 Tf 72 720 Td (Page one has a text layer.) Tj ET"
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R 4 0 R] /Count 2 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] /Contents 5 0 R /Resources << /Font << /F1 6 0 R >> >> >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 612 792] >>",
        b"<< /Length %d >>\nstream\n%s\nendstream" % (len(stream), stream),
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    body = b"%PDF-1.4\n"
    offsets = []
    for i, obj in enumerate(objects, 1):
        offsets.append(len(body))
        body += b"%d 0 obj\n%s\nendobj\n" % (i, obj)
    xref = len(body)
    body += b"xref\n0 %d\n0000000000 65535 f \n" % (len(objects) + 1)
    body += b"".join(b"%010d 00000 n \n" % o for o in offsets)
    body += b"trailer\n<< /Size %d /Root 1 0 R >>\nstartxref\n%d\n%%%%EOF" % (len(objects) + 1, xref)
    path = tmp_path / "mixed.pdf"
    path.write_bytes(body)
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
