"""
Frictionless Onboarding Optimizer
Minimal premium: one question per step, no redundancy, only valuable information.
"""

import logging
import json
from typing import Dict, Any, Optional
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from src.modules.onboarding.steps import ONBOARDING_STEPS, STEP_IDS, TOTAL_STEPS

logger = logging.getLogger(__name__)


class FrictionlessOptimizer:
    """
    Optimizes onboarding for minimal friction:
    - Skip optional steps
    - Smart field pre-filling
    - One-click actions
    - Progressive disclosure
    - Contextual help
    """
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def get_minimal_onboarding_flow(
        self,
        user_id: str,
    ) -> Dict[str, Any]:
        """
        Minimal premium flow: one question per step (name, role, goal, plan).
        No redundancy; only valuable information.
        """
        try:
            import uuid
            u_id = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
            result = await self.db.execute(
                text("SELECT email, first_name, last_name, onboarding_data FROM users WHERE user_id = :user_id"),
                {"user_id": u_id},
            )
            user = result.fetchone()
        except Exception:
            return {"minimal": True, "steps": STEP_IDS, "totalSteps": TOTAL_STEPS, "prefill": {}, "skip_steps": []}
        if not user:
            return {"minimal": True, "steps": STEP_IDS, "totalSteps": TOTAL_STEPS, "prefill": {}, "skip_steps": []}

        prefill: Dict[str, Any] = {}
        if getattr(user, "first_name", None):
            prefill["firstName"] = user.first_name
        if getattr(user, "last_name", None):
            prefill["lastName"] = user.last_name
        email = getattr(user, "email", None) or ""
        if "@" in email:
            domain = email.split("@", 1)[1]
            if domain not in ("gmail.com", "yahoo.com", "outlook.com", "hotmail.com"):
                prefill["company"] = self._extract_company_from_email(domain)
            if not prefill.get("firstName"):
                prefill["displayName"] = email.split("@")[0].replace(".", " ").title()

        skip_steps: list[str] = []
        try:
            from src.modules.onboarding.service import OnboardingService
            org_info = await OnboardingService(self.db).get_organization(user_id=str(user_id))
            if org_info.get("project_id"):
                skip_steps.append("workspace")
        except Exception:
            pass

        return {
            "minimal": True,
            "steps": STEP_IDS,
            "totalSteps": TOTAL_STEPS,
            "prefill": prefill,
            "skip_steps": skip_steps,
        }
    
    def _extract_company_from_email(self, domain: str) -> str:
        """Extract company name from email domain"""
        # Remove common TLDs and format
        company = domain.split(".")[0]
        return company.replace("-", " ").title()
    
    async def prefill_onboarding_data(
        self,
        user_id: str,
        onboarding_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Prefill onboarding data with smart defaults"""
        # Get user info
        import uuid
        u_id = uuid.uuid4()
        try:
            u_id = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        except Exception:
            pass

        result = await self.db.execute(
            text("""
                SELECT 
                    email,
                    first_name,
                    last_name
                FROM users
                WHERE user_id = :user_id
            """),
            {"user_id": u_id}
        )
        user = result.fetchone()
        
        if not user:
            return onboarding_data
        
        # Prefill personal info
        if "personal" not in onboarding_data:
            onboarding_data["personal"] = {}
        
        personal = onboarding_data["personal"]
        
        # Extract first/last name from email if not set
        if not personal.get("firstName") and user.first_name:
            personal["firstName"] = user.first_name
        elif not personal.get("firstName"):
            # Extract from email
            email_name = user.email.split("@")[0]
            personal["firstName"] = email_name.split(".")[0].title()
        
        if not personal.get("lastName") and user.last_name:
            personal["lastName"] = user.last_name
        elif not personal.get("lastName") and "." in user.email.split("@")[0]:
            email_name = user.email.split("@")[0]
            personal["lastName"] = email_name.split(".")[1].title() if len(email_name.split(".")) > 1 else ""
        
        # Detect company from email
        email_domain = user.email.split("@")[1] if "@" in user.email else ""
        if email_domain and email_domain not in ["gmail.com", "yahoo.com", "outlook.com", "hotmail.com"]:
            if not personal.get("company"):
                personal["company"] = self._extract_company_from_email(email_domain)
        
        # Set smart defaults for goals
        if "goals" not in onboarding_data:
            onboarding_data["goals"] = {
                "primaryGoal": "data_analysis",  # Most common
                "experienceLevel": "intermediate",  # Safe default
            }
        
        # Set smart defaults for plan
        if "plan" not in onboarding_data:
            onboarding_data["plan"] = {
                "selectedPlan": "team",
                "enableTeamTrial": True,
                "enableProTrial": False,
                "trialStarted": False,
            }
        
        return onboarding_data
    
    async def should_skip_step(
        self,
        user_id: str,
        step: str,
    ) -> bool:
        """Determine if a step should be skipped"""
        minimal_flow = await self.get_minimal_onboarding_flow(user_id)
        return step in minimal_flow.get("skip_steps", [])
    
    async def get_contextual_help(
        self,
        step: str,
        user_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """Get contextual help based on current step and user data"""
        # Each "content" string below is deliberately written to add something the
        # matching frontend question hint (en.json: q_*_hint) does NOT already say —
        # they used to nearly restate each other word-for-word (e.g. name's hint said
        # "used across chat and dashboards" and this content said almost the same
        # thing), which just doubled up the same sentence in two boxes on screen.
        # Keep that principle when editing either side: hint = what/why we're asking,
        # content = a distinct reassurance/detail, not a rephrase of the hint.
        help_content = {
            "name": {
                "title": "Why we need this",
                "content": "Just your display name — not a login credential, so nicknames are fine.",
                "tips": ["You can update this anytime in Settings → Profile"],
            },
            "company": {
                "title": "Your organization",
                "content": "One workspace per organization for now — invite teammates or add more orgs later if you manage multiple businesses.",
                "tips": ["Prefilled from your email when possible"],
            },
            "role": {
                "title": "Tailored for your job",
                "content": "This only shapes suggestions — it never limits which features or data you can access.",
                "tips": ["Pick the closest match — you can refine later"],
            },
            "primary_goal": {
                "title": "Help us help you",
                "content": "We'll prioritize features and sample content for your main goal.",
                "tips": ["You can explore everything regardless of your choice"],
            },
            "industry": {
                "title": "Industry context",
                "content": "Your data stays completely private regardless of industry — this only picks which starter templates you see first.",
                "tips": ["Pick the closest match — you can change this in Settings"],
            },
            "company_size": {
                "title": "Team scale",
                "content": "Bigger teams unlock governance and permission features tailored to scale.",
                "tips": ["Approximate is fine"],
            },
            "experience": {
                "title": "Skill level",
                "content": "Nothing is locked in — jump into advanced features anytime; this just sets a comfortable starting point.",
                "tips": ["Beginners get more guided prompts in chat"],
            },
            "workspace": {
                "title": "Your first project",
                "content": "Projects keep each team or initiative's data sources and chats separate — handy once you're managing more than one.",
                "tips": ["You can rename or create more projects later"],
            },
            # Legacy keys
            "welcome": {
                "title": "Why we need this",
                "content": "We'll use this to personalize your experience and set up your workspace.",
                "tips": ["You can always update this later in settings"],
            },
            "organization": {
                "title": "About Organizations",
                "content": "Organizations help you collaborate with your team and manage projects together.",
                "tips": ["You can create multiple organizations later"],
            },
            "goals": {
                "title": "Help us help you",
                "content": "Knowing your goals helps us recommend the right features and templates.",
                "tips": [
                    "You can change your preferences anytime",
                    "We'll customize your dashboard based on this",
                ],
            },
            "data_sources": {
                "title": "Connect Your Data",
                "content": "You can connect data sources now or later. We'll guide you through it.",
                "tips": [
                    "You can skip this and add data sources later",
                    "Supported: CSV files, PostgreSQL, ClickHouse, and more",
                ],
            },
            "plan_selection": {
                "title": "Choose Your Plan",
                # Kept short and distinct on purpose — the step body directly below already
                # states the exact default (Team trial, 14 days, no card) and what happens
                # after the trial ends, so this banner shouldn't repeat that (it previously
                # said "Start with Free" while the actual default toggle is Team trial —
                # keep this in sync with EnhancedOnboardingModal.tsx's enableTeamTrial default
                # if that default ever changes).
                "content": "Every plan can be changed anytime — no long-term commitment.",
                "tips": [
                    "Free plan includes 10 AI credits to get started",
                    "You can change plans anytime in Settings → Billing",
                ],
            },
        }
        
        return help_content.get(step, {
            "title": "Need help?",
            "content": "Contact our support team for assistance.",
            "tips": [],
        })
    
    async def track_friction_points(
        self,
        user_id: str,
        step: str,
        action: str,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """Track friction points in onboarding"""
        friction_events = [
            "step_abandoned",
            "step_retried",
            "help_clicked",
            "skip_clicked",
            "error_occurred",
        ]
        
        if action in friction_events:
            try:
                import uuid
                u_id = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
                await self.db.execute(
                    text("""
                        INSERT INTO onboarding_friction_logs (
                            user_id,
                            step,
                            action,
                            metadata,
                            created_at
                        ) VALUES (
                            :user_id,
                            :step,
                            :action,
                            CAST(:metadata AS jsonb),
                            NOW()
                        )
                    """),
                    {
                        "user_id": u_id,
                        "step": step,
                        "action": action,
                        "metadata": json.dumps(metadata or {}, default=str, ensure_ascii=False),
                    }
                )
                await self.db.commit()
            except Exception as e:
                # Non-fatal
                logger.warning(f"Failed to track friction point: {str(e)}")

