"""
Minimal premium onboarding: one question per step.
Frontend shows a single question per screen; profile fields collected before workspace/plan.
"""

from typing import Dict, Any, List

ONBOARDING_STEPS: List[Dict[str, Any]] = [
    {"id": "name", "question": "What should we call you?", "fields": ["displayName"]},
    {"id": "company", "question": "Where do you work?", "fields": ["company"]},
    {"id": "role", "question": "What's your role?", "fields": ["role"]},
    {"id": "primary_goal", "question": "What's your main goal?", "fields": ["primaryGoal"]},
    {"id": "industry", "question": "What industry are you in?", "fields": ["industry"]},
    {"id": "company_size", "question": "What size is your company?", "fields": ["companySize"]},
    {"id": "experience", "question": "What's your data experience?", "fields": ["experienceLevel"]},
    {"id": "workspace", "question": "Name your project", "fields": ["workspaceName"]},
    {"id": "plan_selection", "question": "Choose your plan", "fields": ["selectedPlan"]},
]

STEP_IDS: List[str] = [s["id"] for s in ONBOARDING_STEPS]
TOTAL_STEPS: int = len(STEP_IDS)

# Steps required before org/project provisioning (plan is soft-defaulted on complete).
REQUIRED_STEP_IDS: List[str] = [
    "name",
    "company",
    "role",
    "primary_goal",
    "industry",
    "company_size",
    "experience",
    "workspace",
]


def step_index(step_id: str) -> int:
    """Return 0-based index for step_id, or -1 if unknown."""
    try:
        return STEP_IDS.index(step_id)
    except ValueError:
        return -1


def normalize_completed_steps(completed: List[str]) -> set:
    """Map legacy step ids to the current flow."""
    normalized = set(completed or [])
    if "welcome" in normalized:
        normalized.update({"name", "company", "role", "industry", "company_size", "experience"})
    if "organization" in normalized:
        normalized.add("workspace")
    if "plan" in normalized:
        normalized.add("plan_selection")
    return normalized


def first_incomplete_step_index(
    completed_steps: List[str],
    skip_steps: List[str] | None = None,
) -> int:
    skip = set(skip_steps or [])
    done = normalize_completed_steps(completed_steps)
    visible = [sid for sid in STEP_IDS if sid not in skip]
    for i, sid in enumerate(visible):
        if sid not in done:
            return i
    return max(0, len(visible) - 1)
