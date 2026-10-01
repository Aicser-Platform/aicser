"""Sheet formulas from a description: grounded in the sheet's layout, cleaned, never reaching
outside the workbook, and an honest refusal when the sheet can't answer."""

import json

import pytest

from ee.modules.ai.services.sheet_formula import clean_formula, write_formula


class FakeLLM:
    def __init__(self, reply):
        self.reply, self.prompts = reply, []

    async def generate_completion(self, **kwargs):
        self.prompts.append(kwargs["prompt"])
        return {"success": True, "content": json.dumps(self.reply)}


def test_formulas_are_cleaned_and_outside_calls_refused():
    assert clean_formula("SUM(B2:B10)") == "=SUM(B2:B10)"
    assert clean_formula("`=AVERAGE(C:C)`") == "=AVERAGE(C:C)"
    assert clean_formula('=WEBSERVICE("http://x")') == ""
    assert clean_formula("=cmd|' /C calc'!A0") == ""
    assert clean_formula("=[book.xlsx]Sheet1!A1") == ""
    assert clean_formula('=TEXTJOIN("|",TRUE,A1:A3)') == '=TEXTJOIN("|",TRUE,A1:A3)'


@pytest.mark.asyncio
async def test_prompt_carries_the_sheet_and_ranges():
    llm = FakeLLM({"formula": "=SUMIFS(C2:C120,A2:A120,\"S1\")", "explanation": "Total for S1"})
    out = await write_formula("total amount for store S1", sheet="Sheet1", cell="F2",
                              grid="A1: store\nC1: amount\nA2: S1\nC2: 120",
                              ranges=[{"name": "Orders", "area": "Sheet1!A1:C120", "header_row": 1, "columns": ["store", "day", "amount"]}],
                              litellm_service=llm)
    assert out == {"success": True, "formula": '=SUMIFS(C2:C120,A2:A120,"S1")', "explanation": "Total for S1"}
    p = llm.prompts[0]
    assert "Sheet1!F2" in p and "Sheet1!A1:C120" in p and "store, day, amount" in p and "C2: 120" in p


@pytest.mark.asyncio
async def test_retry_mentions_the_error_and_empty_formula_is_an_honest_refusal():
    llm = FakeLLM({"formula": "", "explanation": "There is no cost column in this sheet."})
    out = await write_formula("margin", sheet="S", cell="A1", grid="", ranges=[], litellm_service=llm,
                              previous="=B2-C2", error="#VALUE!")
    assert out == {"success": False, "error": "There is no cost column in this sheet."}
    assert "=B2-C2 gave #VALUE!" in llm.prompts[0]
