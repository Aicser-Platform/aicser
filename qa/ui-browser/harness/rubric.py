"""UX rubric scoring for UI QA runs — shared language for FE developers."""

from __future__ import annotations

from dataclasses import dataclass, field
from typing import Any


# Dimensions map to reports/06-RUBRIC.md
DIMENSIONS = (
    "answer_first",
    "jargon_control",
    "progressive_disclosure",
    "orientation",
    "trust_clarity",
    "nav_jobs",
    "composer_clarity",
    "empty_error_states",
)


@dataclass
class RubricScore:
    dimension: str
    score: int  # 1–5
    evidence: str
    owner_hint: str = ""  # e.g. ChatPanelMain / navConfig / EnhancedDataPanel


@dataclass
class RubricResult:
    scores: list[RubricScore] = field(default_factory=list)
    overall: float = 0.0
    blockers: list[str] = field(default_factory=list)

    def to_dict(self) -> dict[str, Any]:
        return {
            "overall": self.overall,
            "blockers": self.blockers,
            "scores": [
                {
                    "dimension": s.dimension,
                    "score": s.score,
                    "evidence": s.evidence,
                    "owner_hint": s.owner_hint,
                }
                for s in self.scores
            ],
        }


def score_run(
    *,
    page_text: str,
    url: str,
    journey_id: str,
    focus: list[str] | None = None,
    agent_notes: str = "",
) -> RubricResult:
    """
    Heuristic first-pass scores from visible text + URL.
    Agents and humans refine these in the run report — never treat as absolute.
    """
    text_l = (page_text or "").lower()
    focus_set = set(focus or DIMENSIONS)
    scores: list[RubricScore] = []
    blockers: list[str] = []

    def add(dim: str, score: int, evidence: str, owner: str = "") -> None:
        if dim not in focus_set and focus:
            return
        scores.append(RubricScore(dim, score, evidence, owner))

    # answer_first — look for insight-ish language vs schema noise dominance
    technical_hits = sum(
        1
        for t in ("bigint", "varchar", "ets +", "croston", "moving_avg", "sql")
        if t in text_l
    )
    insight_hits = sum(
        1
        for t in ("insight", "forecast", "recommend", "what to do", "summary", "projected")
        if t in text_l
    )
    if technical_hits >= 3 and insight_hits == 0:
        add(
            "answer_first",
            2,
            "Technical/schema language present without clear insight/summary language.",
            "ChatPanelMain / insight_synthesizer (FE presentation)",
        )
        blockers.append("answer_first: no plain answer language detected")
    elif insight_hits > 0:
        add("answer_first", 4, "Answer-oriented language present.", "ChatPanelMain")
    else:
        add("answer_first", 3, "Inconclusive from text scrape.", "ChatPanelMain")

    # jargon_control
    jargon = [t for t in ("bigint", "ets +", "croston", "best available", "ai engine") if t in text_l]
    if jargon:
        add(
            "jargon_control",
            2,
            f"Visible jargon: {', '.join(jargon)}",
            "navConfig / ModelSelector / SchemaExplorerTree / InlineModeSelector",
        )
    else:
        add("jargon_control", 4, "No high-severity jargon tokens found in scrape.", "navConfig")

    # progressive_disclosure — Sources / model always implied if those strings dominate
    if "sources" in text_l and "bigint" in text_l:
        add(
            "progressive_disclosure",
            2,
            "Sources panel exposing SQL types in default view.",
            "EnhancedDataPanel / SchemaExplorerTree",
        )
    else:
        add("progressive_disclosure", 3, "No strong signal of always-on advanced schema.", "")

    # orientation
    if "/chat" in url or "ai analytics" in text_l:
        add("orientation", 3, f"Landed on chat surface ({url}).", "chat/page.tsx")
    else:
        add("orientation", 2, f"Unexpected URL after journey: {url}", "routing")

    # trust_clarity
    if "confidence" in text_l and ("0%" in page_text or "~0" in page_text):
        add(
            "trust_clarity",
            1,
            "Low/zero confidence shown without accompanying plain-language why/fix.",
            "forecast UI / ChartMessage",
        )
        blockers.append("trust_clarity: ~0% confidence without explanation")
    elif "confidence" in text_l:
        add("trust_clarity", 3, "Confidence mentioned; verify explanation in human review.", "")
    else:
        add("trust_clarity", 3, "No confidence widget observed.", "")

    # nav_jobs
    if "query editor" in text_l and "ai engine" in text_l:
        add(
            "nav_jobs",
            2,
            "Specialist nav labels visible (Query Editor, AI Engine).",
            "navConfig.ts / messages en.json nav.*",
        )
    else:
        add("nav_jobs", 3, "Nav jargon not both present in scrape.", "navConfig.ts")

    # composer_clarity
    if "forecast" in text_l and "best available" in text_l:
        add(
            "composer_clarity",
            2,
            "Mode + model pills both visible — heavy for non-tech personas.",
            "InlineModeSelector / ModelSelector / ChatPanelMain footer",
        )
    else:
        add("composer_clarity", 3, "Footer control density inconclusive.", "ChatPanelMain")

    # empty_error_states — agent notes may mention empty insights
    if "0 insight" in agent_notes.lower() or "no insight" in text_l:
        add(
            "empty_error_states",
            1,
            "Empty insights path observed.",
            "insight cards / response finalizer presentation",
        )
        blockers.append("empty_error_states: empty insights")
    else:
        add("empty_error_states", 3, "No empty-insight signal in scrape.", "")

    overall = round(sum(s.score for s in scores) / max(len(scores), 1), 2)
    return RubricResult(scores=scores, overall=overall, blockers=blockers)
