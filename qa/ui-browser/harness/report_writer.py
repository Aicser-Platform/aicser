"""Write markdown + JSON run reports for other developers."""

from __future__ import annotations

import json
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

from harness.catalog import Journey, Persona
from harness.rubric import RubricResult


def _stamp() -> str:
    return datetime.now(timezone.utc).strftime("%Y%m%dT%H%M%SZ")


def write_run_report(
    *,
    out_dir: Path,
    journey: Journey,
    persona: Persona,
    url: str,
    status: str,
    steps: list[dict[str, Any]],
    checks: dict[str, Any],
    rubric: RubricResult,
    agent_backend: str,
    notes: str = "",
) -> Path:
    out_dir.mkdir(parents=True, exist_ok=True)
    run_id = f"{journey.id}_{_stamp()}"
    payload: dict[str, Any] = {
        "run_id": run_id,
        "status": status,
        "agent_backend": agent_backend,
        "journey": journey.model_dump(),
        "persona": persona.model_dump(),
        "final_url": url,
        "steps": steps,
        "checks": checks,
        "rubric": rubric.to_dict(),
        "notes": notes,
        "dev_pointers": {
            "chat_shell": "client/ee/src/ee/app/(dashboard)/chat/page.tsx",
            "chat_panel": "client/ee/.../ChatPanel/ChatPanelMain.tsx",
            "nav": "client/src/layouts/Navigation/navConfig.ts",
            "sources": "client/ee/.../DataPanel/EnhancedDataPanel.tsx",
            "mode": "client/ee/.../ChatPanel/InlineModeSelector.tsx",
            "model": "client/ee/src/ee/components/ai/ModelSelector/ModelSelector.tsx",
            "findings_backlog": "qa/ui-browser/reports/04-UI-FINDINGS-BACKLOG.md",
        },
    }

    json_path = out_dir / f"{run_id}.json"
    json_path.write_text(json.dumps(payload, indent=2), encoding="utf-8")

    md_path = out_dir / f"{run_id}.md"
    lines = [
        f"# UI QA run: `{journey.id}`",
        "",
        f"- **Run id:** `{run_id}`",
        f"- **Status:** {status}",
        f"- **Persona:** {persona.name} (`{persona.id}`, literacy={persona.digital_literacy})",
        f"- **Agent:** {agent_backend}",
        f"- **Final URL:** {url}",
        f"- **Rubric overall:** {rubric.overall} / 5",
        "",
        "## Journey goal",
        "",
        journey.goal,
        "",
        "## Independent checks",
        "",
    ]
    for d in checks.get("details", []):
        mark = "PASS" if d["passed"] else "FAIL"
        lines.append(
            f"- **{mark}** `{d['kind']}` `{d['value']}` ({d['severity']}) — {d.get('why') or d.get('detail')}"
        )
    if checks.get("blockers"):
        lines += ["", "### Blockers", ""]
        for b in checks["blockers"]:
            lines.append(f"- {b}")

    lines += ["", "## Rubric", ""]
    for s in rubric.scores:
        owner = f" → `{s.owner_hint}`" if s.owner_hint else ""
        lines.append(f"- **{s.dimension}** {s.score}/5 — {s.evidence}{owner}")

    if rubric.blockers:
        lines += ["", "### Rubric blockers", ""]
        for b in rubric.blockers:
            lines.append(f"- {b}")

    lines += [
        "",
        "## Notes for developers",
        "",
        journey.notes_for_devs or "_None on journey file._",
        "",
        notes or "_No runner notes._",
        "",
        "## Where to fix (starting points)",
        "",
        "- Nav labels: `client/src/layouts/Navigation/navConfig.ts` + `client/src/messages/*/nav`",
        "- Chat chrome: `client/ee/.../ChatPanel/ChatPanelMain.tsx`",
        "- Sources panel: `client/ee/.../DataPanel/EnhancedDataPanel.tsx`",
        "- Mode/model pills: `InlineModeSelector.tsx`, `ModelSelector.tsx`",
        "- Product backlog context: `qa/ui-browser/reports/04-UI-FINDINGS-BACKLOG.md`",
        "",
        f"Machine-readable twin: `{json_path.name}`",
        "",
    ]
    md_path.write_text("\n".join(lines), encoding="utf-8")
    return md_path
