"""The finished answer's shape is checked before the person reads it: tables and repeats."""

from src.modules.agent.answer_check import answer_problems, repeated_paragraphs, table_problems

GOOD = """| Metric | Branch 2 | Others |
|---|---|---|
| Loans | 24 | 24 each |
| NPL | 1 (4.2%) | 3–4 |"""

# The scrambled table from a real run.
SCRAMBLED = """| Metric | Branch 66M |
| NPL count2 | Other branches |
|---|---|---|
| Loans | | 1 ( 24 | 24 each |
| Principal4.2%) | 3–4 (12. | $1.06M5–16.7%) |"""


def test_a_well_formed_table_passes():
    assert table_problems(GOOD) == []
    assert table_problems("Text with a | pipe in it.\n\nMore text.") == []


def test_the_scrambled_table_is_caught():
    problems = table_problems(SCRAMBLED)
    assert problems and "columns" in problems[0]


def test_escaped_pipes_are_not_cells():
    assert table_problems("| Rule | Example |\n|---|---|\n| or | a \\| b |") == []


def test_a_repeated_paragraph_is_caught_but_short_lines_are_not():
    para = "Branch 2 has the lowest bad-loan rate, 1 of 24, against 3–4 at every other branch."
    assert repeated_paragraphs(f"{para}\n\nMore.\n\n{para}")
    assert repeated_paragraphs("Done.\n\nDone.") == []
    assert answer_problems(f"{GOOD}\n\nAll good.") == []
