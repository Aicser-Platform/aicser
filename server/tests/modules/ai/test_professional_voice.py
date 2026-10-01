"""Every written answer shares one house voice (no emoji by default, the model judges exceptions)."""

from ee.modules.ai.utils.markdown_response_instructions import LLM_CHAT_MARKDOWN_FORMAT, PROFESSIONAL_VOICE


def test_voice_leaves_exceptions_to_the_model():
    assert "No emoji" in PROFESSIONAL_VOICE
    assert "writes that way themselves" in PROFESSIONAL_VOICE  # mirrors the user, not a blanket filter


def test_chat_and_search_prompts_carry_the_voice():
    from ee.modules.ai.constants import CONVERSATIONAL_SYSTEM_PROMPT, CONVERSATIONAL_SYSTEM_PROMPT_WITH_SCHEMA
    from ee.modules.ai.nodes.supervisor.conversational import SUPERVISOR_CONVERSATIONAL_PROMPT

    assert PROFESSIONAL_VOICE in LLM_CHAT_MARKDOWN_FORMAT
    for prompt in (CONVERSATIONAL_SYSTEM_PROMPT, CONVERSATIONAL_SYSTEM_PROMPT_WITH_SCHEMA, SUPERVISOR_CONVERSATIONAL_PROMPT):
        assert PROFESSIONAL_VOICE in prompt


def test_narration_report_and_deck_writers_carry_the_voice():
    import inspect

    from ee.modules.ai.nodes import executive_report_synthesis_node, insight_synthesizer_node
    from ee.modules.ai.services import deck_planner, export_artifacts_service

    for module in (insight_synthesizer_node, executive_report_synthesis_node, deck_planner, export_artifacts_service):
        assert "+ PROFESSIONAL_VOICE" in inspect.getsource(module), module.__name__
