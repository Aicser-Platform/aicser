"""Word and PowerPoint read, edit and template filling on real files."""

import io
import zipfile

import pytest

docx = pytest.importorskip("docx")
pptx = pytest.importorskip("pptx")

from src.shared import office_docs as od  # noqa: E402


def _word():
    d = docx.Document()
    d.add_heading("Quarterly review", 1)
    para = d.add_paragraph()
    para.add_run("Revenue rose ").bold = True
    para.add_run("12% in Q3.")
    d.add_paragraph("Contact {{owner}} by {{date}}.")
    t = d.add_table(1, 1)
    t.cell(0, 0).text = "Revenue target"
    out = io.BytesIO()
    d.save(out)
    return out.getvalue()


def _deck():
    p = pptx.Presentation()
    for title in ("Intro", "Results", "Next steps"):
        s = p.slides.add_slide(p.slide_layouts[1])
        s.shapes.title.text = title
        s.placeholders[1].text = f"{title} body for {{{{client}}}}"
    out = io.BytesIO()
    p.save(out)
    return out.getvalue()


def _xml(data):
    return zipfile.ZipFile(io.BytesIO(data)).read("word/document.xml").decode()


def test_docx_outline():
    o = od.outline(_word(), "docx")
    assert o["paragraphs"][0] == {"index": 0, "style": "Heading 1", "text": "Quarterly review"}
    assert o["tables"] == [[["Revenue target"]]]


def test_docx_tracked_change_keeps_original_visible_as_a_revision():
    res = od.edit_docx(_word(), [{"find": "12%", "replace": "14%"}])
    xml = _xml(res["data"])
    assert "<w:delText" in xml and ">12%</w:delText>" in xml and "14%" in xml and 'w:author="Aicser"' in xml
    assert res["changes"] == [{"before": "12%", "after": "14%", "count": 1}]
    doc = docx.Document(io.BytesIO(res["data"]))  # still opens
    assert len(doc.paragraphs) == 3


def test_docx_untracked_and_tables():
    res = od.edit_docx(_word(), [{"find": "Revenue", "replace": "Sales"}], track=False)
    doc = docx.Document(io.BytesIO(res["data"]))
    assert "Sales rose 12% in Q3." in doc.paragraphs[1].text and doc.tables[0].cell(0, 0).text == "Sales target"
    assert res["changes"][0]["count"] == 2


def test_docx_missing_text_is_an_error_not_a_silent_no_op():
    with pytest.raises(od.OfficeError):
        od.edit_docx(_word(), [{"find": "nothing like this", "replace": "x"}])


def test_pptx_outline_edit_and_delete():
    data = _deck()
    o = od.outline(data, "pptx")
    assert [s["title"] for s in o["slides"]] == ["Intro", "Results", "Next steps"]
    shape = o["slides"][1]["shapes"][1]["id"]
    res = od.edit_pptx(data, [{"slide": 1, "shape": shape, "text": "Line one\nLine two"},
                              {"find": "Intro", "replace": "Opening"}, {"delete_slide": 2}])
    after = od.outline(res["data"], "pptx")
    assert [s["title"] for s in after["slides"]] == ["Opening", "Results"]
    assert after["slides"][1]["shapes"][1]["text"] == "Line one\nLine two"


def test_templates_fill_and_report_missing_fields():
    assert od.template_fields(_word(), "docx") == ["date", "owner"]
    res = od.fill_template(_word(), "docx", {"owner": "Dana"})
    assert res["filled"] == ["owner"] and res["missing"] == ["date"]
    assert "Contact Dana by {{date}}." in docx.Document(io.BytesIO(res["data"])).paragraphs[2].text
    deck = od.fill_template(_deck(), "pptx", {"client": "Acme"})
    assert "Intro body for Acme" in od.outline(deck["data"], "pptx")["slides"][0]["shapes"][1]["text"]
