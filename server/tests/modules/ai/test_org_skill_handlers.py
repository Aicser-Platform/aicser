"""Org custom skills delegate to builtin handlers; they never execute uploaded code."""

import pytest

from ee.modules.ai.skills.registry import org_skill_capability, run_skill, _REGISTRY
from ee.modules.ai.skills.skill_loader import parse_skill_md


def test_parse_skill_md_stores_capability_tag() -> None:
    meta, body = parse_skill_md(
        "---\nname: weekly_board_pack\ndescription: Board PPTX\n"
        "capability: generate_pptx\ncategory: export\n---\nUse last week's KPIs.\n"
    )
    assert meta["name"] == "weekly_board_pack"
    assert meta["capability"] == "generate_pptx"
    assert "capability:generate_pptx" in meta["tags"]
    assert "Use last week's KPIs." in body


def test_org_skill_capability_from_tag() -> None:
    assert org_skill_capability({"tags": ["capability:create_dashboard"]}) == "create_dashboard"


def test_org_skill_capability_from_name() -> None:
    assert org_skill_capability({"name": "finance-generate-xlsx"}) == "generate_xlsx"


def test_org_skill_capability_research_category() -> None:
    assert org_skill_capability({"name": "policy_qa", "category": "research"}) == "search_libraries"


def test_org_skill_capability_none_for_generic_custom() -> None:
    assert org_skill_capability({"name": "brand_voice", "category": "custom"}) is None


@pytest.mark.asyncio
async def test_run_org_skill_uses_cached_detail(monkeypatch) -> None:
    async def fake_detail(org_id, name):
        return {
            "name": name,
            "description": "Policy answers",
            "instructions": "Always cite the source document.",
            "category": "research",
            "tags": ["capability:search_libraries"],
        }

    async def fake_search(ctx):
        return {"success": True, "skill": "search_libraries", "message": "Cited the handbook."}

    original = _REGISTRY["search_libraries"].handler
    _REGISTRY["search_libraries"].handler = fake_search
    monkeypatch.setattr("ee.modules.ai.skills.registry.get_org_skill_detail", fake_detail)
    monkeypatch.setattr(
        "ee.modules.ai.services.action_policy_engine.evaluate_action",
        lambda *a, **k: (True, "", 0),
    )
    try:
        out = await run_skill(
            "policy_qa",
            {"organization_id": "org-1", "actions_approved": True, "org_policy": {}},
        )
    finally:
        _REGISTRY["search_libraries"].handler = original

    assert out["success"] is True
    assert out["source"] == "organization"
    assert out["delegated_capability"] == "search_libraries"
    assert out["skill"] == "policy_qa"
