# Knowledge Base — Content Type Coverage

This document describes which **content types** inside documents are ingested and searchable.

## Requirements

- **PDF tables**: PyMuPDF (pymupdf) **1.23.0+** for `page.find_tables()` and `Table.to_markdown()`. Older versions only extract body text.
- **DOCX**: python-docx for paragraphs and `document.tables` (or body-order iteration).
- **Embeddings**: See `embedding_service.py` (API or local model) for chunk embedding.

## Supported today

| Content type | PDF | DOCX | MD / TXT | Notes |
|-------------|-----|------|----------|--------|
| **Body text** | ✅ | ✅ | ✅ | Full text from text layer (PDF), paragraphs (DOCX), or raw content (MD/TXT). |
| **Headings** | ✅ (in flow) | ✅ | ✅ | Preserved as section boundaries; DOCX/MD use heading styles / `#` for section_title. |
| **Tables** | ✅ | ✅ | ✅ (detected) | **Structured extraction**: PDF via PyMuPDF `find_tables()` → Markdown (tiny tables &lt; 2×2 skipped); DOCX in body order → Markdown-style rows; MD blocks that look like pipe tables get `content_type: "table"`. |

## Not supported (current behavior)

| Content type | Status | Reason / future option |
|--------------|--------|------------------------|
| **Images** | ❌ | Only text layer is used. Image-only or image-heavy pages are skipped. **Future:** OCR (e.g. PyMuPDF + Tesseract, or vision API) to extract text from images. |
| **Charts / diagrams** | ❌ | Rendered as vectors/images; no text extraction. **Future:** Same as images (OCR or vision). |
| **Video** | ❌ | No video file types or transcription. **Future:** Support video/audio files and use speech-to-text or captions for RAG. |
| **Audio** | ❌ | No audio file types or transcription. **Future:** Same as video. |
| **Embedded objects** | ❌ | OLE/embeds in DOCX not parsed. |
| **Form fields** | ❌ | PDF form field values not extracted. |
| **Annotations / comments** | ❌ | Not ingested. |

## File types accepted

- **PDF** (`.pdf`)
- **Word** (`.docx`, `.doc` → docx path)
- **Markdown** (`.md`, `.markdown`)
- **Plain text** (`.txt`, `.text`)

No native support yet for: HTML, Excel, PowerPoint, video (mp4, webm), or audio (mp3, wav).

## Caveats

- **DOCX merged cells**: Tables with merged or irregular cells may yield duplicated or missing cell text; extraction is best-effort.
- **PDF table detection**: Borderless or heavily styled tables may be missed or split; `find_tables()` uses line-based (or text-based) strategy.

## Future enhancements

- **Images**: OCR (PyMuPDF + Tesseract, or vision API) for image-only PDF pages and inline images.
- **Video / audio**: Support file types (e.g. mp4, mp3) and ingest via speech-to-text or caption tracks for RAG.
- **HTML / Excel / PowerPoint**: Parsers and optional ingestion for web and office content.
- **Config**: Optional env (e.g. `KNOWLEDGE_EXTRACT_TABLES=false`) to disable table extraction for lighter processing.

## Summary

- **Text, headings, and tables** are covered for PDF, DOCX, and MD (tables detected in MD); TXT is text-only.
- **Images, video, audio, and other rich media** are not ingested; add OCR or transcription in a later phase to cover them comprehensively.
