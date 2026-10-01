"""
Aicser UI browser QA harness.

Thin wrapper around browser-use/jev-ultrafast. Product code is never imported.
Verification of DONE is always local (URL, selectors, rubric) — never trust the agent alone.
"""

from harness.config import Settings, load_settings
from harness.rubric import RubricScore, score_run

__all__ = ["Settings", "load_settings", "RubricScore", "score_run"]
