"""Gate B checks added from a real run: no needless question, the draft really made, a well-formed answer."""

import types

from src.modules.agent.evals.run_agent_eval import check, load_tasks


def _run(answer="Branch 2: 1 of 24 loans.", outputs=None):
    return types.SimpleNamespace(status="completed", error=None, result={"answer": answer}, usage={"turns": 5},
                                 outputs=outputs or [])


def _step(tool):
    return types.SimpleNamespace(kind="tool", status="ok", tool_name=tool)


def test_regression_tasks_are_in_the_set():
    ids = {t["id"] for t in load_tasks()}
    assert {"follow-up-recommendations", "recipe-multi-table"} <= ids
    follow_up = load_tasks(["follow-up-recommendations"])[0]
    assert follow_up["history"] and follow_up["expect_no_question"]


def test_asking_what_the_conversation_already_said_fails():
    task = {"expect_no_question": True, "expect_tools_any": [["run_query"]]}
    assert check(task, _run(), [_step("run_query")], ["question"]) == [
        "asked what the request meant although the conversation said it"]
    assert check(task, _run(), [_step("run_query")], []) == []


def test_the_expected_draft_must_exist_and_the_answer_must_be_well_formed():
    task = {"expect_output": "recipe"}
    assert check(task, _run(), [], []) == ["created no recipe"]
    assert check(task, _run(outputs=[{"kind": "recipe"}]), [], []) == []
    broken = "| A | B |\n|---|---|\n| 1 | 2 | 3 |"
    assert any(p.startswith("answer shape:") for p in check({}, _run(broken), [], []))
