"""The report summary must survive the shapes models actually return."""

from ee.modules.ai.nodes.executive_report_synthesis_node import _as_text


def test_list_of_paragraphs_is_joined():
    assert _as_text(["Revenue rose 12%.", " Costs held. ", ""]) == "Revenue rose 12%.\n\nCosts held."


def test_object_of_paragraphs_is_joined():
    assert _as_text({"headline": "Revenue rose 12%.", "action": "Expand store 3."}) == "Revenue rose 12%.\n\nExpand store 3."


def test_string_unchanged_and_other_types_empty():
    assert _as_text("Plain summary.") == "Plain summary."
    assert _as_text(None) == ""
