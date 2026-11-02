"""Read and edit Word and PowerPoint files, keeping everything an edit doesn't touch.

Word edits are tracked changes by default, so the author reviews them in Word. Bytes in, bytes out:
the original file is never changed. Used by the agent's document tools.
"""

from __future__ import annotations

import copy
import io
import re
from datetime import datetime, timezone
from typing import Any, Dict, Iterable, List, Sequence

AUTHOR = "Aicser"
MAX_TEXT = 4000


class OfficeError(ValueError):
    pass


def _docx(data: bytes) -> Any:
    from docx import Document

    return Document(io.BytesIO(data))


def _pptx(data: bytes) -> Any:
    from pptx import Presentation

    return Presentation(io.BytesIO(data))


def _save(doc: Any) -> bytes:
    out = io.BytesIO()
    doc.save(out)
    return out.getvalue()


def _all_paragraphs(doc: Any) -> Iterable[Any]:
    yield from doc.paragraphs
    for table in doc.tables:
        for row in table.rows:
            for cell in row.cells:
                yield from cell.paragraphs


def visible_text(paragraph: Any) -> str:
    """The paragraph with tracked changes accepted: inserted text in, deleted text out."""
    from docx.oxml.ns import qn

    return "".join(node.text or "" for node in paragraph._p.iter(qn("w:t")))


def outline_docx(data: bytes) -> Dict[str, Any]:
    doc = _docx(data)
    paragraphs = [{"index": i, "style": p.style.name if p.style else "", "text": visible_text(p)[:MAX_TEXT]}
                  for i, p in enumerate(doc.paragraphs) if visible_text(p).strip()]
    tables = [[[c.text for c in row.cells] for row in table.rows] for table in doc.tables]
    return {"type": "docx", "paragraphs": paragraphs, "tables": tables}


def _shape_text(shape: Any) -> str:
    return shape.text_frame.text if getattr(shape, "has_text_frame", False) else ""


def outline_pptx(data: bytes) -> Dict[str, Any]:
    deck = _pptx(data)
    slides: List[Dict[str, Any]] = []
    for i, slide in enumerate(deck.slides):
        title = slide.shapes.title.text if slide.shapes.title is not None else ""
        shapes = [{"id": s.shape_id, "name": s.name, "text": _shape_text(s)[:MAX_TEXT]} for s in slide.shapes if _shape_text(s).strip()]
        notes = slide.notes_slide.notes_text_frame.text if slide.has_notes_slide else ""
        slides.append({"index": i, "title": title, "shapes": shapes, "notes": notes[:MAX_TEXT]})
    return {"type": "pptx", "slides": slides}


def outline(data: bytes, kind: str) -> Dict[str, Any]:
    return outline_docx(data) if kind == "docx" else outline_pptx(data)


def _text_run(paragraph: Any, text: str, props: Any, deleted: bool = False) -> Any:
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    run = OxmlElement("w:r")
    if props is not None:
        run.append(copy.deepcopy(props))
    node = OxmlElement("w:delText" if deleted else "w:t")
    node.set(qn("xml:space"), "preserve")
    node.text = text
    run.append(node)
    return run


def _revision(tag: str, change_id: int) -> Any:
    from docx.oxml import OxmlElement
    from docx.oxml.ns import qn

    node = OxmlElement(tag)
    node.set(qn("w:id"), str(change_id))
    node.set(qn("w:author"), AUTHOR)
    node.set(qn("w:date"), datetime.now(timezone.utc).strftime("%Y-%m-%dT%H:%M:%SZ"))
    return node


def _rewrite_paragraph(paragraph: Any, parts: Sequence[tuple], change_id: int) -> int:
    """parts: ("keep" | "del" | "ins", text). Takes the paragraph's first run formatting."""
    runs = paragraph.runs
    props = copy.deepcopy(runs[0]._r.rPr) if runs and runs[0]._r.rPr is not None else None
    for run in runs:
        paragraph._p.remove(run._r)
    for action, text in parts:
        if not text:
            continue
        if action == "keep":
            paragraph._p.append(_text_run(paragraph, text, props))
            continue
        change_id += 1
        wrapper = _revision("w:del" if action == "del" else "w:ins", change_id)
        wrapper.append(_text_run(paragraph, text, props, deleted=action == "del"))
        paragraph._p.append(wrapper)
    return change_id


def _replace_parts(text: str, find: str, replace: str) -> List[tuple]:
    parts: List[tuple] = []
    for i, piece in enumerate(text.split(find)):
        if i:
            parts += [("del", find), ("ins", replace)]
        parts.append(("keep", piece))
    return parts


def _plain_rewrite(paragraph: Any, text: str) -> None:
    runs = paragraph.runs
    if not runs:
        paragraph.add_run(text)
        return
    runs[0].text = text
    for run in runs[1:]:
        run.text = ""


def edit_docx(data: bytes, edits: Sequence[Dict[str, Any]], track: bool = True) -> Dict[str, Any]:
    """edits: {find, replace} everywhere it appears, or {paragraph, text} for one paragraph."""
    doc = _docx(data)
    changes: List[Dict[str, Any]] = []
    change_id = 9000
    for edit in edits:
        if edit.get("find"):
            find, replace = str(edit["find"]), str(edit.get("replace") or "")
            count = 0
            for para in _all_paragraphs(doc):
                if find not in para.text:
                    continue
                count += para.text.count(find)
                if track:
                    change_id = _rewrite_paragraph(para, _replace_parts(para.text, find, replace), change_id)
                else:
                    _plain_rewrite(para, para.text.replace(find, replace))
            if not count:
                raise OfficeError(f"Text not found: {find[:80]}")
            changes.append({"before": find, "after": replace, "count": count})
        elif edit.get("paragraph") is not None:
            index = int(edit["paragraph"])
            if not 0 <= index < len(doc.paragraphs):
                raise OfficeError(f"No paragraph {index}.")
            para = doc.paragraphs[index]
            before, after = para.text, str(edit.get("text") or "")
            if track:
                change_id = _rewrite_paragraph(para, [("del", before), ("ins", after)], change_id)
            else:
                _plain_rewrite(para, after)
            changes.append({"before": before[:300], "after": after[:300], "count": 1})
        else:
            raise OfficeError("Each edit needs find/replace, or paragraph and text.")
    return {"data": _save(doc), "changes": changes}


def _frame_paragraphs(deck: Any) -> Iterable[Any]:
    for slide in deck.slides:
        for shape in slide.shapes:
            if getattr(shape, "has_text_frame", False):
                yield from shape.text_frame.paragraphs
            if getattr(shape, "has_table", False):
                for row in shape.table.rows:
                    for cell in row.cells:
                        yield from cell.text_frame.paragraphs


def edit_pptx(data: bytes, edits: Sequence[Dict[str, Any]]) -> Dict[str, Any]:
    """edits: {find, replace}, {slide, shape, text} (shape id from the outline), {delete_slide}."""
    deck = _pptx(data)
    changes: List[Dict[str, Any]] = []
    # Deleted last, highest first, so the numbers in other edits keep meaning what the outline said.
    deletions = sorted({int(e["delete_slide"]) for e in edits if e.get("delete_slide") is not None}, reverse=True)
    for edit in edits:
        if edit.get("find"):
            find, replace = str(edit["find"]), str(edit.get("replace") or "")
            count = 0
            for para in _frame_paragraphs(deck):
                if find in para.text:
                    count += para.text.count(find)
                    _plain_rewrite(para, para.text.replace(find, replace))
            if not count:
                raise OfficeError(f"Text not found: {find[:80]}")
            changes.append({"before": find, "after": replace, "count": count})
        elif edit.get("slide") is not None:
            index = int(edit["slide"])
            if not 0 <= index < len(deck.slides):
                raise OfficeError(f"No slide {index}.")
            shape = next((s for s in deck.slides[index].shapes if s.shape_id == edit.get("shape")), None)
            if shape is None or not getattr(shape, "has_text_frame", False):
                raise OfficeError(f"No text shape {edit.get('shape')} on slide {index}.")
            before = shape.text_frame.text
            lines = str(edit.get("text") or "").split("\n")
            frame = shape.text_frame
            _plain_rewrite(frame.paragraphs[0], lines[0])
            for extra in frame.paragraphs[1:]:
                extra._p.getparent().remove(extra._p)
            for line in lines[1:]:
                para = frame.add_paragraph()
                para.level = frame.paragraphs[0].level
                para.add_run().text = line
            changes.append({"before": before[:300], "after": str(edit.get("text") or "")[:300], "count": 1})
    for index in deletions:
        if not 0 <= index < len(deck.slides):
            raise OfficeError(f"No slide {index}.")
        ids = deck.slides._sldIdLst
        target = ids[index]
        deck.part.drop_rel(target.rId)
        ids.remove(target)
        changes.append({"before": f"Slide {index + 1}", "after": "(removed)", "count": 1})
    return {"data": _save(deck), "changes": changes}


_FIELD = re.compile(r"\{\{\s*([A-Za-z0-9_ .-]+?)\s*\}\}")


def template_fields(data: bytes, kind: str) -> List[str]:
    paragraphs = _all_paragraphs(_docx(data)) if kind == "docx" else _frame_paragraphs(_pptx(data))
    return sorted({m for p in paragraphs for m in _FIELD.findall(p.text)})


def fill_template(data: bytes, kind: str, values: Dict[str, Any]) -> Dict[str, Any]:
    """Replace {{field}} markers in a company template; its masters and styles stay as they are."""
    doc = _docx(data) if kind == "docx" else _pptx(data)
    paragraphs = _all_paragraphs(doc) if kind == "docx" else _frame_paragraphs(doc)
    filled, missing = set(), set()

    def swap(match: "re.Match[str]") -> str:
        name = match.group(1)
        if name in values:
            filled.add(name)
            return str(values[name])
        missing.add(name)
        return match.group(0)

    for para in paragraphs:
        if "{{" in para.text:
            _plain_rewrite(para, _FIELD.sub(swap, para.text))
    return {"data": _save(doc), "filled": sorted(filled), "missing": sorted(missing)}


def confirm_edits(data: bytes, kind: str, changes: Sequence[Dict[str, Any]]) -> List[str]:
    """Reopen the saved file: the new text of each change that isn't in it."""
    outline_data = outline(data, kind)
    words = " ".join(p["text"] for p in outline_data["paragraphs"]) if kind == "docx" else " ".join(
        sh["text"] for slide in outline_data["slides"] for sh in slide["shapes"])
    if kind == "docx":
        words += " " + " ".join(c for t in outline_data["tables"] for row in t for c in row)
    flat = " ".join(words.split())
    return [str(c["after"]) for c in changes if c.get("after") and c["after"] != "(removed)" and " ".join(str(c["after"]).split())[:300] not in flat]
