"""Decide quality bar: grounded figures, complete options, honest band."""

import asyncio

from ee.modules.decision_os.brief_review import band_confidence_cap, check_brief, review_brief
from ee.modules.decision_os.decision_synthesizer import segment_evidence_block

ROWS = [{"period": f"2024-{m:02d}-01", "branch": f"Branch {b}", "value": 1000.0 * b + m}
        for m in range(1, 13) for b in range(1, 4)]
AM = {"diagnostic": {"top_contributors": [{"factor": "branch=Branch 3", "magnitude": 12}]},
      "prescriptive": {"recommendations": ["Grow Branch 3"]}}


def _brief(**over):
    b = {
        "executive_decision": "Expand Branch 3, which averages 3006.5 per month.",
        "options": [{"label": "Pilot", "recommended": False}, {"label": "Phased", "recommended": True},
                    {"label": "Full", "recommended": False}],
        "assumptions": [{"assumption": "Top branch = Branch 3"}],
        "evidence_strength": "strong",
    }
    b.update(over)
    return b


def test_grounded_complete_brief_has_no_critique():
    facts = segment_evidence_block(ROWS)
    assert "Branch 3" in facts
    out = check_brief(_brief(), AM, ROWS, facts)
    assert out["critique"] == []


def test_invented_figures_and_bad_options_are_critiqued():
    brief = _brief(executive_decision="Expand to 987654.3 per month for a 45123.9 gain and 77777.7 more.",
                   options=[{"label": "Only", "recommended": False}])
    out = check_brief(brief, AM, ROWS, "")
    assert any("not in the evidence" in c for c in out["critique"])
    assert any("3 distinct options" in c for c in out["critique"])


def test_review_bands_without_decision_layer():
    run = lambda b, **k: asyncio.run(review_brief(query="Should we expand?", brief=b, analytics_metadata=AM,
                                                  rows=ROWS, facts=segment_evidence_block(ROWS), **k))
    assert run(_brief())["band"] == "act"
    assert run(_brief(evidence_strength="partial"))["band"] == "surface"
    weak = run(_brief(evidence_strength="weak"))
    assert weak["band"] == "escalate" and weak["summary"].startswith("Treat this as a draft")
    assert run(_brief(), frame={"needs_user_input": True})["band"] == "surface"


def test_band_caps_confidence():
    assert band_confidence_cap("escalate") < 0.5 <= band_confidence_cap("surface") < 0.8 <= band_confidence_cap("act")


def test_analyst_derived_figures_count_as_grounded():
    rows = [{"period": f"2024-{m:02d}-01", "value": v} for m, v in
            zip(range(1, 13), [480, 470, 500, 490, 510, 425, 440, 753, 700, 600, 520, 450])]
    # H2 average, a month's % above the mean, H2-vs-H1 change — all derived, none literal in rows.
    brief = _brief(executive_decision="Size to the H2 average of 577.2 (+20.5% vs H1); August ran 42.6% above the mean.")
    out = check_brief(brief, {}, rows, "")
    assert out["critique"] == [], out
