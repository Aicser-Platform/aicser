"""Independent outcome checks — required because jev-ultrafast DONE is not proof."""

from __future__ import annotations

from dataclasses import dataclass
from typing import Any

from harness.catalog import Journey, JourneyCheck


@dataclass
class CheckResult:
    check: JourneyCheck
    passed: bool
    detail: str

    @property
    def blocker(self) -> bool:
        return self.check.severity == "blocker" and not self.passed


def evaluate_checks(
    journey: Journey,
    *,
    url: str,
    page_text: str,
    css_hits: dict[str, bool] | None = None,
) -> list[CheckResult]:
    css_hits = css_hits or {}
    text = page_text or ""
    text_l = text.lower()
    url_l = (url or "").lower()
    out: list[CheckResult] = []

    for c in journey.checks:
        kind = c.kind
        val = c.value
        if kind == "url_contains":
            ok = val.lower() in url_l
            out.append(CheckResult(c, ok, f"url={url!r}"))
        elif kind == "text_present":
            ok = val.lower() in text_l
            out.append(CheckResult(c, ok, "substring search in page text"))
        elif kind == "text_absent":
            ok = val.lower() not in text_l
            out.append(CheckResult(c, ok, "forbidden substring search"))
        elif kind == "css_present":
            ok = bool(css_hits.get(val))
            out.append(CheckResult(c, ok, f"css_hits[{val}]={css_hits.get(val)}"))
        elif kind == "note":
            out.append(CheckResult(c, True, "manual/human note only"))
        else:
            out.append(CheckResult(c, False, f"unknown check kind {kind!r}"))
    return out


def summary(results: list[CheckResult]) -> dict[str, Any]:
    return {
        "passed": sum(1 for r in results if r.passed),
        "failed": sum(1 for r in results if not r.passed),
        "blockers": [r.check.value for r in results if r.blocker],
        "details": [
            {
                "kind": r.check.kind,
                "value": r.check.value,
                "severity": r.check.severity,
                "passed": r.passed,
                "why": r.check.why,
                "detail": r.detail,
            }
            for r in results
        ],
    }
