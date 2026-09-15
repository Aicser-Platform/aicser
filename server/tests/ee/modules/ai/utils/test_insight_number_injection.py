"""Regression: number injection must not turn $706.5K into $$706.5K.5K."""

from ee.modules.ai.utils.insight_normalization import (
    _apply_result_replacements,
    _build_result_replacements,
    _repair_broken_compact_numbers,
    inject_query_result_into_insights,
)


def test_repair_broken_double_currency_and_suffix():
    assert _repair_broken_compact_numbers("Branch 5=$$706.5K.5K (23.7%)") == "Branch 5=$706.5K (23.7%)"
    assert _repair_broken_compact_numbers("$1.2M.2M") == "$1.2M"


def test_apply_does_not_rewrite_digits_inside_compact_form():
    rows = [{"collateral_amount": 706500.5, "branch": "Branch 5"}]
    replacements = _build_result_replacements(rows)
    # Must not include short "706" / "706k" scaled forms
    raws = {r[0] for r in replacements}
    assert "706" not in raws
    assert "706k" not in raws

    text = "Branch 5=$706.5K (23.7%), Branch 2=609,031.13 (20.4%)"
    out = _apply_result_replacements(text, replacements)
    assert "$$" not in out
    assert ".5K.5K" not in out
    assert "$706.5K" in out


def test_inject_insights_what_field():
    insights = [
        {
            "title": "WHAT",
            "what": "Branch 5=$$706.5K.5K (23.7%), Branch 2=609,031.13 (20.4%)",
        }
    ]
    rows = [{"collateral_amount": 706500.5}]
    out = inject_query_result_into_insights(insights, rows)
    assert out[0]["what"] == "Branch 5=$706.5K (23.7%), Branch 2=609,031.13 (20.4%)"
