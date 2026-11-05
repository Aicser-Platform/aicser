"""A model stuck repeating itself is caught while it writes and cut back to before the loop.

From a real answer that ran 16,674 characters to its token limit: "If you'd like, I can also recap the
X. If you want, I can also list the Y. …"
"""

from ee.modules.ai.utils.repetition import LoopGuard, cut_loop, is_looping

GOOD = (
    "Here are the current insights on your loan book (120 loans, 5 branches).\\n\\n"
    "## Portfolio health\\n- NPL rate is 15.2%: 16 loans carrying 773.6k of outstanding principal.\\n"
    "- Payments are falling: monthly payments dropped from 11.8k in April to 8.3k in September.\\n\\n"
    "| Branch | NPL rate | Outstanding |\\n|---|---|---|\\n| Branch 5 | 22.5% | 1.16M |\\n| Branch 3 | 21.1% | 0.93M |\\n\\n"
    "Branch 2 runs at 0.3% NPL at the same average pricing, so its underwriting is the benchmark to copy. "
    "Newer cohorts are still maturing, so expect the rate to rise before it falls. "
    "Start with the branches holding most of the problem and review their approval rules."
)
TOPICS = ["caveats", "confidence levels", "margin of error", "sample sizes", "outliers", "data anomalies",
          "corrections applied", "adjustments made", "restatements", "version history", "change log",
          "update schedule", "refresh frequency", "data latency", "source systems", "extraction process"] * 3
LOOP = " ".join(f"If you{chr(39)}d like, I can also recap the {a}. If you want, I can also list the {b}."
                for a, b in zip(TOPICS[::2], TOPICS[1::2]))


def test_a_normal_answer_with_a_table_is_not_a_loop():
    assert not is_looping(GOOD)
    assert cut_loop(GOOD) == (GOOD, False)


def test_the_loop_is_cut_back_to_the_real_answer():
    text, cut = cut_loop(GOOD + " " + LOOP)
    assert cut and text == GOOD


def test_streaming_stops_early_in_the_loop():
    full = GOOD + " " + LOOP
    guard = LoopGuard()
    stopped = next((n for n in range(50, len(full), 50) if guard.check(full[:n])), None)
    assert stopped is not None and stopped < len(GOOD) + len(LOOP) // 2


def test_other_languages_loop_the_same_way():
    fr = " ".join(f"Si vous voulez, je peux aussi résumer les {t}." for t in TOPICS)
    assert is_looping(fr)
