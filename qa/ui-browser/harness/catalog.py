"""Load persona + journey YAML definitions."""

from __future__ import annotations

from pathlib import Path
from typing import Any

import yaml
from pydantic import BaseModel, Field

ROOT = Path(__file__).resolve().parents[1]


class Persona(BaseModel):
    id: str
    name: str
    role: str
    digital_literacy: str  # low | medium | high
    goals: list[str] = Field(default_factory=list)
    pains: list[str] = Field(default_factory=list)
    must_not_see: list[str] = Field(default_factory=list)
    success_looks_like: list[str] = Field(default_factory=list)


class JourneyCheck(BaseModel):
    kind: str  # url_contains | text_absent | text_present | css_present | note
    value: str
    severity: str = "major"  # blocker | major | minor
    why: str = ""


class Journey(BaseModel):
    id: str
    title: str
    persona: str
    start_path: str = "/chat"
    goal: str
    max_steps: int | None = None
    checks: list[JourneyCheck] = Field(default_factory=list)
    rubric_focus: list[str] = Field(default_factory=list)
    tags: list[str] = Field(default_factory=list)
    notes_for_devs: str = ""


def _load_yaml(path: Path) -> dict[str, Any]:
    with path.open(encoding="utf-8") as f:
        data = yaml.safe_load(f) or {}
    if not isinstance(data, dict):
        raise ValueError(f"Expected mapping in {path}")
    return data


def load_persona(persona_id: str) -> Persona:
    path = ROOT / "personas" / f"{persona_id}.yaml"
    return Persona(**_load_yaml(path))


def load_journey(journey_id: str) -> Journey:
    path = ROOT / "journeys" / f"{journey_id}.yaml"
    return Journey(**_load_yaml(path))


def list_journeys() -> list[str]:
    return sorted(p.stem for p in (ROOT / "journeys").glob("*.yaml"))


def list_personas() -> list[str]:
    return sorted(p.stem for p in (ROOT / "personas").glob("*.yaml"))
