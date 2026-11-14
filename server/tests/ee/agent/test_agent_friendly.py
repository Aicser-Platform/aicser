"""Step text on the page: errors are explained by the agent itself; Aicser only tidies its own format."""

from src.modules.agent.friendly import friendly_summary


def test_old_summaries_read_plainly():
    assert friendly_summary("1 rows (result://24)") == "1 row"
    assert friendly_summary("16 rows (result://25)") == "16 rows"
    assert friendly_summary("run_python done: kind, text") == "Done"
    assert friendly_summary("7 tables") == "7 tables"
