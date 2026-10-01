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
    assert out == ["Branch 5: 12.0 (positive)"]


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
    assert "West" in brief["executive_decision"] and "region=" not in brief["executive_decision"]
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


def test_top_contributors_humanises_period_keys():
    am = {"diagnostic": {"top_contributors": [{"factor": "period=2024-08", "magnitude": 74.16912}]}}
    assert top_contributors(am) == ["2024-08: 74.2"]


def test_tactical_brief_parses_completion_content_with_low_effort():
    import asyncio
    from ee.modules.decision_os.decision_synthesizer import DecisionSynthesizer

    calls = {}

    class _Svc:
        async def generate_completion(self, **kw):
            calls.update(kw)
            return {"success": True, "content": '{"executive_decision": "Expand at Branch 5", "decision_confidence": "high"}'}

    brief = asyncio.run(DecisionSynthesizer().synthesize_tactical(
        query="Should we expand?", analytics_metadata={}, query_result=[],
        data_source_name="bank", litellm_service=_Svc(),
    ))
    assert brief["executive_decision"] == "Expand at Branch 5"
    assert brief["confidence_score"] is not None
    assert calls.get("reasoning_effort") == "low"


def test_tactical_brief_streams_with_decide_budget():
    import asyncio
    from ee.modules.decision_os import decision_synthesizer as ds

    calls = {}

    class _Svc:
        async def generate_completion_with_stream_callback(self, stream_callback, **kw):
            calls.update(kw)
            return {"success": True, "content": '{"executive_decision": "Hold expansion"}'}

    brief = asyncio.run(ds.DecisionSynthesizer().synthesize_tactical(
        query="q", analytics_metadata={}, query_result=[], data_source_name="d", litellm_service=_Svc(),
    ))
    assert brief["executive_decision"] == "Hold expansion"
    assert calls["timeout"] == ds._TACTICAL_TIMEOUT and calls["timeout"] > ds._SYNTH_TIMEOUT
    assert calls["reasoning_effort"] == "low"


def test_segment_evidence_ranks_segments_and_warns_about_totals():
    from ee.modules.decision_os.decision_synthesizer import segment_evidence_block

    rows = [{"period": f"2024-{m:02d}-01", "focus_dimension": f"B{b}", "value": 100 * b + m}
            for m in range(1, 7) for b in (1, 2)]
    block = segment_evidence_block(rows, labels={"focus_dimension": "Branch", "value": "Principal"})
    assert block.splitlines()[1].lstrip().startswith("1. B2:")
    assert "Branch" in block and "focus_dimension" not in block
    assert "total across all Branch values" in block


def test_prompt_uses_classified_framework_and_revision_critique():
    from ee.modules.decision_os.decision_synthesizer import build_tactical_prompt

    p = build_tactical_prompt("Should we cut costs?", {}, [], "d", decision_type="reduce_cost",
                              critique=["Mark exactly one option as recommended."])
    assert "DECISION TYPE: reduce_cost" in p and "depth of the cut" in p
    assert "REVISION" in p and "Mark exactly one option" in p
    assert '"assumptions"' in p and '"information_gaps"' in p
