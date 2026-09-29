from __future__ import annotations

import argparse
import logging
import sys

from harness.agent_runner import run_agent
from harness.catalog import list_journeys, list_personas, load_journey, load_persona
from harness.config import load_settings
from harness.report_writer import write_run_report
from harness.rubric import score_run
from harness.verify import evaluate_checks, summary

logging.basicConfig(level=logging.INFO, format="%(levelname)s %(message)s")
logger = logging.getLogger("aicser-qa")


def cmd_list(_: argparse.Namespace) -> int:
    print("Personas:", ", ".join(list_personas()) or "(none)")
    print("Journeys:", ", ".join(list_journeys()) or "(none)")
    return 0


def cmd_run(args: argparse.Namespace) -> int:
    settings = load_settings()
    journey = load_journey(args.journey)
    persona = load_persona(args.persona or journey.persona)

    result = run_agent(
        settings=settings,
        persona=persona,
        journey=journey,
        dry_run=args.dry_run,
    )

    checks = evaluate_checks(
        journey,
        url=result["url"],
        page_text=result.get("page_text") or "",
    )
    check_summary = summary(checks)
    rubric = score_run(
        page_text=result.get("page_text") or "",
        url=result["url"],
        journey_id=journey.id,
        focus=journey.rubric_focus or None,
        agent_notes=result.get("notes") or "",
    )

    report = write_run_report(
        out_dir=settings.report_dir(),
        journey=journey,
        persona=persona,
        url=result["url"],
        status=result["status"],
        steps=result.get("steps") or [],
        checks=check_summary,
        rubric=rubric,
        agent_backend=result.get("backend") or "unknown",
        notes=result.get("notes") or "",
    )
    logger.info("Wrote %s", report)

    if args.dry_run:
        return 0
    if check_summary["blockers"] or rubric.blockers:
        return 2
    if result["status"] not in ("DONE", "done", "success"):
        return 1
    return 0 if check_summary["failed"] == 0 else 1


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(prog="aicser-qa", description="Aicser UI browser QA (isolated)")
    sub = parser.add_subparsers(dest="cmd", required=True)

    p_list = sub.add_parser("list", help="List personas and journeys")
    p_list.set_defaults(func=cmd_list)

    p_run = sub.add_parser("run", help="Run one journey")
    p_run.add_argument("--journey", required=True, help="Journey id (filename stem)")
    p_run.add_argument("--persona", default=None, help="Override persona id")
    p_run.add_argument(
        "--dry-run",
        action="store_true",
        help="No Chrome/keys — emit a sample report for pipeline wiring",
    )
    p_run.set_defaults(func=cmd_run)

    args = parser.parse_args(argv)
    return int(args.func(args))


if __name__ == "__main__":
    sys.exit(main())
