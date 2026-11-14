"""PDF reading on permissively licensed libraries (pypdfium2 for text and page images, pdfplumber
for tables). PyMuPDF is AGPL-or-commercial, which private Enterprise code can't take on."""
from __future__ import annotations

import base64
import io
from typing import Any, Iterable, List, Sequence, Tuple


def page_count(path: str) -> int:
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(path)
    try:
        return len(doc)
    finally:
        doc.close()


def page_texts(path: str, limit: int | None = None) -> List[str]:
    """The text layer of each page, in order ('' for a page without one)."""
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(path)
    try:
        texts: List[str] = []
        for n in range(min(len(doc), limit) if limit else len(doc)):
            page = doc[n]
            textpage = page.get_textpage()
            texts.append((textpage.get_text_bounded() or "").replace("\r\n", "\n"))
            textpage.close()
            page.close()
        return texts
    finally:
        doc.close()


def _markdown(rows: Iterable[Sequence[Any]]) -> str:
    cells = [["" if c is None else " ".join(str(c).split()).replace("|", "\\|") for c in row] for row in rows]
    if not cells:
        return ""
    head, *body = cells
    lines = ["| " + " | ".join(head) + " |", "|" + " --- |" * len(head)]
    lines += ["| " + " | ".join(row) + " |" for row in body]
    return "\n".join(lines)


def page_tables(path: str, limit: int | None = None) -> List[List[str]]:
    """Markdown for each table of each page (a table needs at least two rows and two columns)."""
    import pdfplumber

    out: List[List[str]] = []
    with pdfplumber.open(path) as pdf:
        for page in pdf.pages[:limit] if limit else pdf.pages:
            tables = [t for t in page.extract_tables() if len(t) >= 2 and len(t[0]) >= 2]
            out.append([md for md in (_markdown(t) for t in tables) if md])
            page.flush_cache()
    return out


def page_images(path: str, pages: Sequence[int], dpi: int = 150) -> List[Tuple[int, str]]:
    """(page index, base64 PNG) for the given pages."""
    import pypdfium2 as pdfium

    doc = pdfium.PdfDocument(path)
    try:
        out: List[Tuple[int, str]] = []
        for n in pages:
            page = doc[n]
            image = page.render(scale=dpi / 72).to_pil()
            buffer = io.BytesIO()
            image.save(buffer, format="PNG")
            out.append((n, base64.b64encode(buffer.getvalue()).decode()))
            page.close()
        return out
    finally:
        doc.close()
