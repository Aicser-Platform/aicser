"""Tests for the RBAC permission gate added to skill_executor_node.py.

Root cause: skill_executor_node ran every skill (run_sql, create_chart,
create_dashboard, generate_docx/pptx/pdf/xlsx/csv, schedule_email,
create_alert, save_chart) with ZERO role-based permission check -- only the
user-agnostic action-risk-tier (action_policy_engine.py) and plan-entitlement
(skill_entitlements.py) gates applied, neither of which knows the calling
user's role. Verified live: the direct REST endpoint for the equivalent
action (e.g. dashboards router) correctly calls require_permission(uid,
"dashboard:create", ...) and blocks a project_viewer -- the same action via
AI chat did not. Each skill's permission_code (skills/registry.py) now
mirrors the matching REST permission code, checked here before any step in
the plan executes.
"""

from unittest.mock import AsyncMock, patch

import pytest

from ee.modules.ai.nodes.skill_executor_node import skill_executor_node
from ee.modules.ai.skills.registry import _REGISTRY


@pytest.mark.asyncio
async def test_denied_permission_blocks_skill_before_it_runs():
    async def fake_create_dashboard(ctx):
        raise AssertionError("create_dashboard must not run without dashboard:create permission")

    original = _REGISTRY["create_dashboard"].handler
    _REGISTRY["create_dashboard"].handler = fake_create_dashboard
    try:
        with patch(
            "ee.modules.authentication.rbac.rbac_service.RBACService.check_permission",
            new=AsyncMock(return_value=False),
        ):
            state = {
                "query": "[Agent Skill: create_dashboard]",
                "user_id": "viewer-user",
                "organization_id": "org-1",
                "project_id": "proj-1",
                "agent_plan": {"steps": [{"id": "s1", "type": "skill", "skill": "create_dashboard", "status": "pending"}]},
            }
            out = await skill_executor_node(state)
    finally:
        _REGISTRY["create_dashboard"].handler = original

    assert out["current_stage"] == "skill_permission_denied"
    result = out["skill_results"][0]
    assert result["success"] is False
    assert result["error_code"] == "PERMISSION_DENIED"
    assert result["required_permission"] == "dashboard:create"


@pytest.mark.asyncio
async def test_granted_permission_runs_skill_normally():
    async def fake_create_dashboard(ctx):
        return {"success": True, "message": "Dashboard created."}

    original = _REGISTRY["create_dashboard"].handler
    _REGISTRY["create_dashboard"].handler = fake_create_dashboard
    try:
        with patch(
            "ee.modules.authentication.rbac.rbac_service.RBACService.check_permission",
            new=AsyncMock(return_value=True),
        ):
            state = {
                "query": "[Agent Skill: create_dashboard]",
                "user_id": "editor-user",
                "organization_id": "org-1",
                "project_id": "proj-1",
                # create_dashboard also sits behind action_policy_engine's
                # orthogonal L2_CONFIRM tier -- pre-approved here so this
                # test isolates the RBAC gate specifically, not that
                # unrelated policy gate (which has its own test coverage).
                "actions_approved": True,
                "agent_plan": {"steps": [{"id": "s1", "type": "skill", "skill": "create_dashboard", "status": "pending"}]},
            }
            out = await skill_executor_node(state)
    finally:
        _REGISTRY["create_dashboard"].handler = original

    assert out["skill_results"][0]["success"] is True


@pytest.mark.asyncio
async def test_rbac_lookup_error_fails_closed_not_open():
    """Unlike the clarification judge (fails open), an RBAC check erroring
    must deny access, never silently grant it."""
    async def fake_create_dashboard(ctx):
        raise AssertionError("create_dashboard must not run when the RBAC check itself errors")

    original = _REGISTRY["create_dashboard"].handler
    _REGISTRY["create_dashboard"].handler = fake_create_dashboard
    try:
        with patch(
            "ee.modules.authentication.rbac.rbac_service.RBACService.check_permission",
            new=AsyncMock(side_effect=RuntimeError("db unavailable")),
        ):
            state = {
                "query": "[Agent Skill: create_dashboard]",
                "user_id": "u1",
                "organization_id": "org-1",
                "agent_plan": {"steps": [{"id": "s1", "type": "skill", "skill": "create_dashboard", "status": "pending"}]},
            }
            out = await skill_executor_node(state)
    finally:
        _REGISTRY["create_dashboard"].handler = original

    assert out["current_stage"] == "skill_permission_denied"


@pytest.mark.asyncio
async def test_multi_step_plan_blocked_entirely_if_any_skill_denied():
    """run_sql (granted) then create_dashboard (denied) -- run_sql must not
    execute either, since the whole plan is checked before any step runs."""
    sql_ran = {"value": False}

    async def fake_run_sql(ctx):
        sql_ran["value"] = True
        return {"success": True}

    async def fake_create_dashboard(ctx):
        raise AssertionError("must not run")

    async def fake_check_permission(*, user_id, permission_code, organization_id=None, project_id=None):
        return permission_code != "dashboard:create"

    original_sql = _REGISTRY["run_sql"].handler
    original_dash = _REGISTRY["create_dashboard"].handler
    _REGISTRY["run_sql"].handler = fake_run_sql
    _REGISTRY["create_dashboard"].handler = fake_create_dashboard
    try:
        with patch(
            "ee.modules.authentication.rbac.rbac_service.RBACService.check_permission",
            new=AsyncMock(side_effect=fake_check_permission),
        ):
            state = {
                "query": "run a query and build me a dashboard",
                "user_id": "u1",
                "organization_id": "org-1",
                "agent_plan": {
                    "steps": [
                        {"id": "s1", "type": "skill", "skill": "run_sql", "status": "pending"},
                        {"id": "s2", "type": "skill", "skill": "create_dashboard", "status": "pending"},
                    ]
                },
            }
            out = await skill_executor_node(state)
    finally:
        _REGISTRY["run_sql"].handler = original_sql
        _REGISTRY["create_dashboard"].handler = original_dash

    assert sql_ran["value"] is False
    assert out["current_stage"] == "skill_permission_denied"


@pytest.mark.asyncio
async def test_no_user_id_skips_rbac_gate_entirely():
    """No user_id in state (shouldn't normally happen post-auth, but the
    gate itself must not crash) -- falls through to existing behavior."""
    async def fake_run_sql(ctx):
        return {"success": True}

    original = _REGISTRY["run_sql"].handler
    _REGISTRY["run_sql"].handler = fake_run_sql
    try:
        state = {
            "query": "[Agent Skill: run_sql]",
            "organization_id": "org-1",
            "agent_plan": {"steps": [{"id": "s1", "type": "skill", "skill": "run_sql", "status": "pending"}]},
        }
        out = await skill_executor_node(state)
    finally:
        _REGISTRY["run_sql"].handler = original

    assert out["skill_results"][0]["success"] is True
