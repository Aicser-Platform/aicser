"""What the reader's profile asks of an answer."""

from ee.modules.ai.utils.markdown_response_instructions import PROFESSIONAL_VOICE
from ee.modules.ai.utils.prompt_context import get_audience_context_line
from ee.modules.ai.utils.reader_profile import PLAIN_LANGUAGE, TECHNICAL_LANGUAGE, language_rule, reader_block


def test_plain_language_is_the_default():
    assert language_rule({}) == PLAIN_LANGUAGE
    assert "**Plain language:**" in PROFESSIONAL_VOICE
    assert language_rule({"data_experience": "beginner"}) == PLAIN_LANGUAGE


def test_people_who_work_with_data_can_read_technical_terms():
    assert language_rule({"data_experience": "Expert"}) == TECHNICAL_LANGUAGE


def test_the_block_names_the_job_and_leaves_out_what_is_unknown():
    block = reader_block({"job_role": "CEO"})
    assert "CEO" in block and "industry" not in block and PLAIN_LANGUAGE in block


def test_ask_gets_the_same_rule_without_a_profile():
    state = {"agent_context": {"metadata": {"user_preferences": {}}}}
    assert PLAIN_LANGUAGE in get_audience_context_line(state)


def test_an_unconfirmed_number_is_labelled_once_and_others_are_left_alone():
    from ee.modules.ai.utils.narration_grounding import mark_estimates

    text = "Revenue was $5.1M, up 12% from 4,120."
    assert mark_estimates(text, ["$5.1M"]) == "Revenue was $5.1M (estimate), up 12% from 4,120."
    assert mark_estimates(mark_estimates(text, ["12%"]), ["12%"]).count("(estimate)") == 1


def test_ask_is_told_what_to_remember():
    state = {"agent_context": {"metadata": {"user_preferences": {"workspace_memory": "Use fiscal years."}}}}
    assert "Use fiscal years." in get_audience_context_line(state)
