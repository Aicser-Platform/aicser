"""Answer text hygiene: consistent numbers, no doubled punctuation, no label-as-number edits."""

from ee.modules.ai.utils.insight_normalization import _join_sentences, harmonize_number_display
from ee.modules.ai.utils.narration_grounding import extract_numbers_from_text, soft_correct_text


def test_numbers_read_in_one_style():
    t = harmonize_number_display("Branch 5 has $1.66M; Branch 4 has $1,490,353.04 of $6,474,369.01; avg 539,531.40.")
    assert t == "Branch 5 has $1.66M; Branch 4 has $1.49M of $6.47M; avg 539,531."


def test_small_amounts_and_years_untouched():
    assert harmonize_number_display("1,234 loans, fee 2,024.50 in 2024") == "1,234 loans, fee 2,024.50 in 2024"


def test_joined_fragments_do_not_double_periods():
    assert _join_sentences(["Total is 5.", "So what", "Now what?"]) == "Total is 5. So what. Now what?"


def test_period_labels_are_not_numeric_claims():
    nums = extract_numbers_from_text("H2 was 14.9% above H1. Q4 fell; FY24 grew.")
    assert nums == {"14.9"}
    fixed, _, _ = soft_correct_text("H2 was 14.9% above H1. Then 1.0 later.", {"1.03", "14.9"})
    assert "H1." in fixed and "H1.03" not in fixed


def test_durations_and_counts_are_not_nudged_to_data_values():
    fixed, _, _ = soft_correct_text("require a plan within 30 days and a $30 fee", {"30.9", "30.8"})
    assert "within 30 days" in fixed and "$30.8" in fixed
