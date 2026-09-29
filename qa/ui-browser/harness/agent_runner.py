"""Optional jev-ultrafast runner. Dry-run works without the vendor package."""

from __future__ import annotations

import logging
from typing import Any

from harness.catalog import Journey, Persona
from harness.config import Settings

logger = logging.getLogger(__name__)


def build_agent_goal(persona: Persona, journey: Journey, settings: Settings) -> str:
    """Natural-language goal for Jev Ultrafast — one goal, no site-specific scripts."""
    must_not = "; ".join(persona.must_not_see) or "unnecessary technical jargon"
    success = "; ".join(persona.success_looks_like) or "a clear answer"
    login = ""
    if settings.aiser_qa_email and settings.aiser_qa_password:
        login = (
            f"If a login form is visible, sign in with email {settings.aiser_qa_email} "
            f"and the provided password. "
        )
    return (
        f"You are evaluating Aicser for persona '{persona.name}' ({persona.role}), "
        f"digital literacy: {persona.digital_literacy}. "
        f"{login}"
        f"Task: {journey.goal} "
        f"Prefer plain-language UI. Avoid needing: {must_not}. "
        f"Stop when: {success}. "
        f"Do not change settings, billing, or delete data. "
        f"If blocked by permissions or missing data, stop and mark DONE with that reason."
    )


def run_agent(
    *,
    settings: Settings,
    persona: Persona,
    journey: Journey,
    dry_run: bool = False,
) -> dict[str, Any]:
    """
    Returns {status, url, page_text, steps, backend, notes}.
    dry_run: synthesise a stub result so reports/CI scaffolding work without Chrome/keys.
    """
    start_url = settings.aiser_base_url.rstrip("/") + journey.start_path
    goal = build_agent_goal(persona, journey, settings)

    if dry_run:
        return {
            "status": "dry_run",
            "url": start_url,
            "page_text": (
                "Aicser AI Analytics AI Engine Query Editor Dashboard Studio Data & Model "
                "Sources BIGINT Best available Forecast Prompt Library History"
            ),
            "steps": [{"status": "dry_run", "goal_preview": goal[:240]}],
            "backend": "dry_run",
            "notes": "Dry run only — install vendor/jev-ultrafast and keys for live agent.",
        }

    try:
        from jev_ultrafast import Agent  # type: ignore
    except ImportError as exc:
        raise RuntimeError(
            "jev-ultrafast is not installed. From qa/ui-browser run: make vendor-jev && "
            "uv sync --extra agent  (see README)."
        ) from exc

    steps: list[dict[str, Any]] = []
    final_url = start_url
    page_text = ""
    status = "unknown"

    # Library API per upstream README (subject to change — pin vendor ref).
    with Agent(start_url, goal) as agent:
        for state in agent.run():
            steps.append(
                {
                    "elapsed_ms": state.get("elapsed_ms"),
                    "status": state.get("status"),
                    "operation": state.get("operation"),
                }
            )
            status = str(state.get("status") or status)
            if state.get("url"):
                final_url = str(state["url"])
            if state.get("page_text"):
                page_text = str(state["page_text"])
            if len(steps) >= (journey.max_steps or settings.qa_max_steps):
                status = "max_steps"
                break

    return {
        "status": status,
        "url": final_url,
        "page_text": page_text,
        "steps": steps,
        "backend": "jev-ultrafast",
        "notes": "",
        "goal": goal,
    }
