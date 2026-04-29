"""
Minimal premium onboarding: one question per step, no redundancy, only valuable information.
Steps map to a single stored value; frontend should show one question per step.
"""

from typing import Dict, Any, List

# One question per step — no redundant or optional steps
ONBOARDING_STEPS: List[Dict[str, Any]] = [
    {"id": "welcome", "question": "Personalize your experience", "fields": ["firstName", "lastName", "company", "role"]},
    {"id": "organization", "question": "Set up your project", "fields": ["workspaceName"]},
    {"id": "plan", "question": "Choose your plan", "fields": ["selectedPlan"]},
]

STEP_IDS: List[str] = [s["id"] for s in ONBOARDING_STEPS]
TOTAL_STEPS: int = len(STEP_IDS)


def step_index(step_id: str) -> int:
    """Return 0-based index for step_id, or -1 if unknown."""
    try:
        return STEP_IDS.index(step_id)
    except ValueError:
        return -1
