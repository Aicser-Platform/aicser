"""Decision synthesizer helpers — driver formatting and fallback brief quality."""

from ee.modules.decision_os.decision_synthesizer import (
    fallback_brief,
    top_contributors,
    build_tactical_prompt,
)


def test_top_contributors_uses_factor_and_magnitude():
    am = {
        "diagnostic": {
            "top_contributors": [
                {"factor": "branch=Branch 5", "magnitude": 12, "direction": "positive"}
            ]
        }
    }
    out = top_contributors(am)
    assert out == ["branch=Branch 5: 12 (positive)"]


def test_top_contributors_falls_back_to_dimension_slicing():
    am = {
        "diagnostic": {
            "dimension_slicing": [
                {
                    "anomalous_segment": "Branch 5",
                    "deviation_pct": 41,
                    "dimension": "branch",
                }
            ]
        }
    }
    out = top_contributors(am)
    assert len(out) == 1
    assert "Branch 5" in out[0]
    assert "41" in out[0]


def test_fallback_brief_cites_drivers_not_stock_phrase():
    am = {
        "diagnostic": {
            "top_contributors": [{"factor": "region=West", "magnitude": 0.42}],
            "summary": "West region leads the gap.",
        },
        "prescriptive": {
            "recommendations": [{"action": "Reallocate inventory to West", "expected_impact": "+8% fill"}]
        },
    }
    brief = fallback_brief("What should we do about regional gaps?", am)
    assert "region=West" in brief["executive_decision"]
    assert brief["options"]
    assert any(o.get("recommended") for o in brief["options"])
    assert brief.get("_fallback") is True


def test_tactical_prompt_includes_engine_facts_and_domain_option_guidance():
    am = {
        "diagnostic": {"top_contributors": [{"factor": "SKU-9", "magnitude": 3}]},
        "prescriptive": {"recommendations": [{"action": "Cut SKU-9 promo spend"}]},
    }
    prompt = build_tactical_prompt("Decide on promo spend", am, [{"sku": "SKU-9", "spend": 100}], "Sales")
    assert "STRUCTURED ENGINE FACTS" in prompt
    assert "SKU-9" in prompt
    assert "avoid stock Conservative/Base/Aggressive" in prompt
