"""A rejected AI key reads as a setup problem for an admin, not an outage to retry."""

from ee.modules.ai.utils.fail_fast import build_service_down_response, escalate_to_critical_failure
from ee.modules.ai.utils.user_friendly_errors import make_error_user_friendly

ADMIN = "The AI service isn't configured correctly right now. Please contact your administrator."


def test_rejected_key_wins_over_open_circuit_breaker():
    # What the LLM service raises once the breaker has opened on 401s.
    msg = make_error_user_friendly(
        "AuthenticationError: openrouter rejected the API key (401); LLM circuit breaker is open"
    )
    assert msg == ADMIN
    # A plain outage still says to try again.
    assert "try again" in make_error_user_friendly("LLM circuit breaker is open — try again shortly").lower()


def test_escalation_keeps_the_admin_message():
    state = {"data_source_name": "loans"}
    escalate_to_critical_failure(state, f"NL2SQL: LLM service unrecoverable error: {ADMIN}")
    assert state["error_code"] == "LLM_NOT_CONFIGURED"
    assert state["message"] == ADMIN
    assert "administrator" in build_service_down_response(state)
    assert "try again" not in build_service_down_response(state).lower()


def test_outage_escalation_is_unchanged():
    state = {}
    escalate_to_critical_failure(state, "NL2SQL: timeout")
    assert state["error_code"] == "LLM_SERVICE_UNAVAILABLE"


def test_google_invalid_key_reads_as_a_setup_problem():
    # Google rejects a bad key with 400 INVALID_ARGUMENT, not 401 — this used to fall through to
    # "I wasn't able to translate your question" and look like the user's fault.
    from ee.modules.ai.utils.fail_fast import is_llm_error_unrecoverable

    raw = '{"error": {"code": 400, "message": "API key not valid. Please pass a valid API key.", "reason": "API_KEY_INVALID"}}'
    assert make_error_user_friendly(raw) == ADMIN
    # nl2sql passes the already-translated text to the classifier, so both forms must stop Layer 2.
    assert is_llm_error_unrecoverable(raw)
    assert is_llm_error_unrecoverable(ADMIN)
    # A slow call is still worth a retry.
    assert not is_llm_error_unrecoverable("The AI service took too long. Please try again in a moment.")
