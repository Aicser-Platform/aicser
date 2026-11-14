"""
Onboarding API
FastAPI endpoints for user onboarding
"""

import logging
import json
from typing import Dict, Any, Literal, Optional
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends, Body, Request
from pydantic import BaseModel, Field
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer, current_user_payload
from src.db.session import get_async_session
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import uuid

from src.modules.onboarding.service import OnboardingService
from src.modules.onboarding.frictionless_optimizer import FrictionlessOptimizer
from src.modules.onboarding.enhanced_onboarding import EnhancedOnboardingService
from src.modules.onboarding.steps import (
    TOTAL_STEPS,
    ONBOARDING_STEPS,
    STEP_IDS,
    first_incomplete_step_index,
    normalize_completed_steps,
    REQUIRED_STEP_IDS,
)

logger = logging.getLogger(__name__)

router = APIRouter()


@router.get("/steps")
async def get_onboarding_steps():
    """
    Minimal premium onboarding: one question per step, no redundancy.
    Returns step ids and question text; frontend shows one question per step.
    """
    return {
        "steps": ONBOARDING_STEPS,
        "stepIds": STEP_IDS,
        "totalSteps": TOTAL_STEPS,
    }


class OnboardingCompletionRequest(BaseModel):
    userId: Optional[str] = None
    onboardingData: Dict[str, Any]
    completedAt: str


class OnboardingCompletionResponse(BaseModel):
    success: bool
    message: Optional[str] = None
    userId: str
    completedAt: str
    personalized: bool = True
    organization_id: Optional[str] = None
    project_id: Optional[str] = None
    requires_checkout: bool = False
    checkout_plan: Optional[str] = None
    # granted | already_used | has_paid_plan | not_available; None when no trial was requested
    trial_outcome: Optional[str] = None


@router.post("/complete", response_model=OnboardingCompletionResponse)
async def complete_onboarding(
    request: OnboardingCompletionRequest,
    current_user=Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Complete user onboarding process with enhanced provisioning"""
    try:
        user_id = current_user.get("id") if current_user else request.userId

        if not user_id:
            raise HTTPException(status_code=400, detail="User ID is required")

        logger.info(f"User {user_id} completed onboarding")

        # Use onboarding service for enhanced provisioning
        onboarding_service = OnboardingService(db)
        result = await onboarding_service.complete_onboarding(
            user_id=str(user_id),
            onboarding_data=request.onboardingData,
        )

        if not result.get("success"):
            raise HTTPException(status_code=500, detail="Failed to complete onboarding")

        logger.info(
            f"Onboarding completed for user {user_id}. "
            f"Organization: {result.get('organization_id')}, "
            f"Project: {result.get('project_id')}, "
            f"Plan: {result.get('plan_type')}"
        )

        return OnboardingCompletionResponse(
            success=True,
            message="Onboarding completed successfully",
            userId=str(user_id),
            completedAt=request.completedAt,
            personalized=True,
            organization_id=result.get("organization_id"),
            project_id=result.get("project_id"),
            requires_checkout=result.get("requires_checkout", False),
            checkout_plan=result.get("checkout_plan"),
            trial_outcome=result.get("trial_outcome"),
        )

    except HTTPException:
        raise
    except Exception as e:
        await db.rollback()
        logger.error(f"Failed to complete onboarding: {str(e)}")
        raise HTTPException(status_code=500, detail=f"Failed to complete onboarding: {str(e)}")


@router.post("/progress")
async def save_onboarding_progress(
    request: Dict[str, Any] = Body(...),
    current_user=Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """Save onboarding progress for a specific step with friction tracking"""
    try:
        user_id = current_user.get("id") if current_user else None

        if not user_id:
            raise HTTPException(status_code=400, detail="User ID is required")

        step = request.get("step")
        data = request.get("data", {})
        
        if not step:
            raise HTTPException(status_code=400, detail="Step is required")

        onboarding_service = OnboardingService(db)
        success = await onboarding_service.save_onboarding_progress(
            user_id=str(user_id),
            step=step,
            data=data,
        )

        if not success:
            raise HTTPException(status_code=500, detail="Failed to save progress")
        
        # Track step completion
        optimizer = FrictionlessOptimizer(db)
        await optimizer.track_friction_points(
            user_id=str(user_id),
            step=step,
            action="step_completed",
        )

        # Progress saved — completion is explicit via POST /complete (frontend Get Started).
        return {"success": True, "step": step}

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to save onboarding progress: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to save progress")


def _default_onboarding_flow():
    """Return default flow when unauthenticated so modal opens without 401."""
    return {"minimal": True, "steps": STEP_IDS, "totalSteps": TOTAL_STEPS, "prefill": {}, "skip_steps": []}


@router.get("/flow")
async def get_onboarding_flow(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
):
    """Get optimized onboarding flow. Optional auth: when not logged in return default flow so 'Getting Started' works."""
    try:
        payload = await current_user_payload(request)
        user_id = (payload.get("id") or payload.get("user_id") or payload.get("sub")) if payload else None

        if not user_id:
            return _default_onboarding_flow()

        optimizer = FrictionlessOptimizer(db)
        flow = await optimizer.get_minimal_onboarding_flow(user_id=str(user_id))
        return flow

    except HTTPException:
        raise
    except Exception as e:
        logger.warning(f"get_onboarding_flow failed, returning default: {e}")
        return _default_onboarding_flow()


@router.get("/help/{step}")
async def get_contextual_help(
    step: str,
    db: AsyncSession = Depends(get_async_session),
):
    """Get contextual help for a specific onboarding step (works without auth)"""
    try:
        user_data = {}
        
        # Try to get user if authenticated, but don't require it
        try:
            current_user = await JWTCookieBearer()(request=None)
            user_id = current_user.get("id") if current_user else None
            
            if user_id:
                # Get user data if authenticated; use dict params
                result = await db.execute(
                    text("SELECT onboarding_data FROM users WHERE user_id = :user_id"),
                    {"user_id": uuid.UUID(str(user_id))}
                )
                user = result.fetchone()
                if user and user.onboarding_data:
                    try:
                        user_data = json.loads(user.onboarding_data) if isinstance(user.onboarding_data, str) else user.onboarding_data
                    except (json.JSONDecodeError, TypeError):
                        user_data = {}
        except Exception:
            # Not authenticated or error - that's okay, we'll return default help
            pass

        # Get help content (works even without user data)
        optimizer = FrictionlessOptimizer(db)
        help_content = await optimizer.get_contextual_help(
            step=step,
            user_data=user_data,
        )
        
        return help_content

    except Exception as e:
        logger.error(f"Failed to get contextual help: {str(e)}")
        # Return default help content instead of error
        optimizer = FrictionlessOptimizer(db)
        return await optimizer.get_contextual_help(step=step, user_data={})


def _default_onboarding_status(user_id: str):
    """Return default status when users table lacks onboarding columns (pre-migration)."""
    return {
        "completed": False,
        "userId": user_id,
        "onboardingData": {},
        "onboardingProgress": {},
        "completedSteps": [],
        "userProfile": {"firstName": None, "lastName": None},
        "currentStep": 0,
        "totalSteps": TOTAL_STEPS,
        "startedAt": None,
        "completedAt": None,
    }


def _unauthenticated_onboarding_status():
    """Return status when not authenticated — 200 with completed: false to avoid 401 log noise."""
    return {
        "completed": False,
        "userId": None,
        "onboardingData": {},
        "onboardingProgress": {},
        "completedSteps": [],
        "userProfile": {"firstName": None, "lastName": None},
        "currentStep": 0,
        "totalSteps": TOTAL_STEPS,
        "startedAt": None,
        "completedAt": None,
    }


def _journey_user(current_user: Dict[str, Any]) -> str:
    return str(current_user.get("id") or current_user.get("user_id") or current_user.get("sub") or "")


# Each step is answered from what the person really did, so progress can't drift from reality. "me"
# is every id this person has: some tables hold users.id, others the sign-in id in users.user_id.
_ME = "(SELECT id FROM users WHERE id::text = :u OR user_id::text = :u UNION SELECT user_id FROM users WHERE id::text = :u OR user_id::text = :u)"
_JOURNEY_CHECKS: Dict[str, str] = {
    "connect": "SELECT EXISTS(SELECT 1 FROM data_sources WHERE user_id IN " + _ME + ")",
    "ask": "SELECT EXISTS(SELECT 1 FROM llm_request_summary WHERE user_id::text IN (SELECT id::text FROM " + _ME + " AS me(id)))",
    "save": "SELECT EXISTS(SELECT 1 FROM charts WHERE user_id IN " + _ME + " AND is_deleted IS NOT TRUE)",
    "dashboard": "SELECT EXISTS(SELECT 1 FROM dashboards WHERE created_by IN " + _ME + " AND is_deleted IS NOT TRUE)",
    "publish": "SELECT EXISTS(SELECT 1 FROM feed_posts WHERE author_id IN " + _ME + " AND status = 'approved')",
    "invite": "SELECT EXISTS(SELECT 1 FROM organization_invitations WHERE invited_by IN " + _ME + ")",
    # The team moment: someone else answered or reacted to what this person published.
    "discuss": """SELECT EXISTS(SELECT 1 FROM feed_posts p WHERE p.author_id IN """ + _ME + """ AND (
        EXISTS(SELECT 1 FROM feed_comments c WHERE c.post_id = p.id AND c.user_id NOT IN """ + _ME + """)
        OR EXISTS(SELECT 1 FROM feed_interactions i WHERE i.post_id = p.id AND i.user_id NOT IN """ + _ME + """)))""",
    "alert": "SELECT EXISTS(SELECT 1 FROM alert_rules WHERE created_by::text IN (SELECT id::text FROM " + _ME + " AS me(id)))",
}


async def _journey_steps(db: AsyncSession, user_id: str) -> Dict[str, Optional[bool]]:
    """Step -> done. None means this edition can't do the step, so the guide leaves it out."""
    steps: Dict[str, Optional[bool]] = {}
    for step, sql in _JOURNEY_CHECKS.items():
        try:
            steps[step] = bool((await db.execute(text(sql), {"u": user_id})).scalar())
        except Exception as exc:  # noqa: BLE001 - Community has no alert_rules or invitations table
            logger.debug("Journey check %s skipped: %s", step, exc)
            await db.rollback()
            steps[step] = None
    return steps


async def _ready_for_tour(db: AsyncSession, user_id: str) -> bool:
    """A tour can only run in a workspace, so it waits for the person to have one."""
    try:
        return bool((await db.execute(text(
            "SELECT EXISTS(SELECT 1 FROM user_roles WHERE user_id IN " + _ME
            + " AND organization_id IS NOT NULL AND is_active AND NOT is_deleted)"), {"u": user_id})).scalar())
    except Exception as exc:  # noqa: BLE001 - Community has no organizations
        logger.debug("Tour readiness check skipped: %s", exc)
        await db.rollback()
        return True


async def _one_person_plan(db: AsyncSession, user_id: str) -> bool:
    """A plan for one person can't invite anyone, so the steps that need a teammate don't apply yet."""
    try:
        org = (await db.execute(text(
            "SELECT organization_id FROM user_roles WHERE user_id IN " + _ME
            + " AND organization_id IS NOT NULL AND is_active AND NOT is_deleted LIMIT 1"), {"u": user_id})).scalar()
        if not org:
            return False
        from src.modules.pricing.feature_gate import get_organization_plan
        from src.modules.pricing.plans import PLAN_CONFIGS

        plan = await get_organization_plan(str(org), db)
        return (PLAN_CONFIGS.get(plan) or {}).get("max_users") == 1
    except Exception as exc:  # noqa: BLE001 - Community has no organizations or plans
        logger.debug("Plan check for the journey skipped: %s", exc)
        await db.rollback()
        return False


async def _guide_state(db: AsyncSession, user_id: str) -> Dict[str, Any]:
    row = await db.execute(text(
        "SELECT onboarding_progress FROM users WHERE id::text = :u OR user_id::text = :u LIMIT 1"), {"u": user_id})
    progress = row.scalar()
    if isinstance(progress, str):
        try:
            progress = json.loads(progress)
        except ValueError:
            progress = {}
    return (progress or {}).get("guides") or {}


@router.get("/journey")
async def get_journey(
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """What this person has done, and where they are in each guided tour."""
    user_id = _journey_user(current_user)
    steps = await _journey_steps(db, user_id)
    if await _one_person_plan(db, user_id):
        steps.update({step: None for step in ("invite", "discuss") if not steps.get(step)})
    return {"steps": steps, "guides": await _guide_state(db, user_id), "ready": await _ready_for_tour(db, user_id)}


class GuideProgress(BaseModel):
    # Only names the guide uses: this is written onto the account, so it mustn't grow without end.
    guide: str = Field(pattern=r"^(connect|first_value|save|dashboard|publish|invite|team|alert|checklist"
                               r"|skip_(connect|ask|save|dashboard|publish|invite|discuss|alert))$")
    status: Literal["active", "done", "dismissed"]
    step: int = Field(default=0, ge=0, le=20)


@router.post("/journey")
async def save_journey(
    body: GuideProgress,
    current_user: Dict[str, Any] = Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
) -> Dict[str, Any]:
    """Remember a tour on the account, so it doesn't restart on another browser."""
    await db.execute(text("""
        UPDATE users SET onboarding_progress = jsonb_set(
            jsonb_set(COALESCE(onboarding_progress::jsonb, '{}'::jsonb), '{guides}',
                      COALESCE(onboarding_progress::jsonb -> 'guides', '{}'::jsonb), true),
            ARRAY['guides', :guide], CAST(:state AS jsonb), true)
        WHERE id::text = :u OR user_id::text = :u
    """), {"guide": body.guide, "state": json.dumps({"status": body.status, "step": body.step}),
           "u": _journey_user(current_user)})
    await db.commit()
    return {"saved": True}


@router.get("/status")
async def get_onboarding_status(
    request: Request,
    db: AsyncSession = Depends(get_async_session),
):
    """Get user's onboarding status. Returns 200 with completed: false when unauthenticated (no 401)."""
    try:
        # Optional auth: avoid 401 when cookie/token missing so client logs stay clean
        payload = await current_user_payload(request)
        user_id = (payload.get("id") or payload.get("user_id") or payload.get("sub")) if payload else None

        if not user_id:
            return _unauthenticated_onboarding_status()

        # Try full schema first (onboarding_data, first_name, etc.); use dict params to avoid "List argument" error
        try:
            result = await db.execute(
                text("""
                    SELECT
                        onboarding_completed_at,
                        onboarding_data,
                        onboarding_progress,
                        onboarding_started_at,
                        first_name,
                        last_name
                    FROM users
                    WHERE user_id = :user_id OR id = :user_id
                """),
                {"user_id": uuid.UUID(str(user_id))},
            )
            user_data = result.fetchone()
        except Exception as col_err:
            logger.debug("Onboarding columns missing, using minimal schema: %s", col_err)
            # Minimal users schema: only id, username, email, is_active, ...
            row_result = await db.execute(text("SELECT id FROM users WHERE user_id = :user_id OR id = :user_id"), {"user_id": uuid.UUID(str(user_id))})
            if not row_result.fetchone():
                raise HTTPException(status_code=404, detail="User not found")
            return _default_onboarding_status(user_id)

        if not user_data:
            raise HTTPException(status_code=404, detail="User not found")

        completed = getattr(user_data, "onboarding_completed_at", None) is not None
        onboarding_data = {}
        if getattr(user_data, "onboarding_data", None):
            raw = user_data.onboarding_data
            try:
                onboarding_data = json.loads(raw) if isinstance(raw, str) else (raw or {})
            except (TypeError, ValueError):
                pass
        onboarding_progress = {}
        if getattr(user_data, "onboarding_progress", None):
            raw = user_data.onboarding_progress
            try:
                onboarding_progress = json.loads(raw) if isinstance(raw, str) else (raw or {})
            except (TypeError, ValueError):
                pass
        completed_steps = list(onboarding_progress.keys()) if isinstance(onboarding_progress, dict) else []
        normalized_done = normalize_completed_steps(completed_steps)
        started_at = getattr(user_data, "onboarding_started_at", None)
        completed_at = getattr(user_data, "onboarding_completed_at", None)

        # Fetch real org/project DB info to enrich status payload
        onboarding_service = OnboardingService(db)
        org_info = await onboarding_service.get_organization(user_id=str(user_id))

        skip_steps: list[str] = []
        if org_info.get("project_id"):
            skip_steps.append("workspace")

        if not completed and set(REQUIRED_STEP_IDS).issubset(normalized_done):
            # Legacy users who finished provisioning steps but never hit /complete
            completed = completed_at is not None

        return {
            "completed": completed,
            "userId": str(user_id),
            "onboardingData": onboarding_data,
            "onboardingProgress": onboarding_progress,
            "completedSteps": completed_steps,
            "userProfile": {
                "firstName": getattr(user_data, "first_name", None),
                "lastName": getattr(user_data, "last_name", None),
            },
            "currentStep": first_incomplete_step_index(completed_steps, skip_steps),
            "totalSteps": TOTAL_STEPS,
            "skipSteps": skip_steps,
            "startedAt": started_at.isoformat() if started_at else None,
            "completedAt": completed_at.isoformat() if completed_at else None,
            # Real DB references for the onboarding modal pre-fill
            "organizationId": org_info.get("organization_id"),
            "organizationName": org_info.get("organization_name"),
            "projectId": org_info.get("project_id"),
            "projectName": org_info.get("project_name"),
        }

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get onboarding status: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to get onboarding status")


@router.get("/org-info")
async def get_org_info(
    current_user=Depends(JWTCookieBearer()),
    db: AsyncSession = Depends(get_async_session),
):
    """
    Return the current user's organization and default project from the DB.

    Used by the onboarding modal to pre-fill the Company Name and Project Name
    fields with real database values instead of deriving them from user strings.

    Response:
        {
            "organization_id": str | null,
            "organization_name": str | null,
            "project_id": str | null,
            "project_name": str | null,
        }
    """
    try:
        user_id = current_user.get("id") if current_user else None
        if not user_id:
            raise HTTPException(status_code=400, detail="User ID is required")

        onboarding_service = OnboardingService(db)
        info = await onboarding_service.get_organization(user_id=str(user_id))
        return info

    except HTTPException:
        raise
    except Exception as e:
        logger.error(f"Failed to get org info: {str(e)}")
        raise HTTPException(status_code=500, detail="Failed to get org info")
