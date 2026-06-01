"""
Onboarding API
FastAPI endpoints for user onboarding
"""

import logging
import json
from typing import Dict, Any, Optional
from uuid import UUID
from fastapi import APIRouter, HTTPException, Depends, Body, Request
from pydantic import BaseModel
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
                    WHERE user_id = :user_id
                """),
                {"user_id": uuid.UUID(str(user_id))},
            )
            user_data = result.fetchone()
        except Exception as col_err:
            logger.debug("Onboarding columns missing, using minimal schema: %s", col_err)
            # Minimal users schema: only id, username, email, is_active, ...
            row_result = await db.execute(text("SELECT id FROM users WHERE user_id = :user_id"), {"user_id": uuid.UUID(str(user_id))})
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
