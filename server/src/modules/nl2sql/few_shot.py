"""Few-shot formatting for CE NL2SQL."""

from __future__ import annotations

import re
from typing import Any, Dict, List


def format_few_shot_for_prompt(examples: List[Dict[str, str]], max_examples: int = 3) -> str:
    if not examples:
        return ""
    lines = ["Similar past questions and SQL (use as style reference only):"]
    for ex in examples[:max_examples]:
        q = ex.get("query") or ex.get("nl_query") or ""
        sql = ex.get("sql") or ""
        if q and sql:
            lines.append(f"Q: {q}\nSQL: {sql}")
    return "\n".join(lines) + "\n"


def keyword_overlap_score(query_a: str, query_b: str) -> float:
    stop_words = {
        "what", "show", "give", "tell", "list", "find", "from", "with",
        "that", "this", "which", "where", "when", "many", "much", "does",
        "have", "been", "will", "would", "could", "should", "about", "into",
        "than", "then", "them", "they", "their", "there", "these", "those",
    }

    def _words(text: str) -> set:
        return {w for w in re.findall(r"[a-z]+", text.lower()) if len(w) > 2 and w not in stop_words}

    a, b = _words(query_a), _words(query_b)
    if not a or not b:
        return 0.0
    union = a | b
    return len(a & b) / len(union) if union else 0.0
