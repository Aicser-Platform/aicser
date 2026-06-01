"""
Onboarding Service
Handles user onboarding, progress tracking, organization/project provisioning.

Flow on sign-in/onboarding:
  1. User fills Welcome step  → saves first/last name + company to users table.
  2. User fills Org step      → renames (or creates) the Organization row.
  3. User completes onboarding → ensures Organization + Project rows exist with
                                 correct names; assigns org_owner role if new.
"""

import logging
from typing import Dict, Any, Optional
from datetime import datetime
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text
import uuid

from src.modules.pricing.plans import get_plan_config
from src.modules.onboarding.enhanced_onboarding import EnhancedOnboardingService
from src.modules.onboarding.frictionless_optimizer import FrictionlessOptimizer
from src.modules.onboarding.steps import STEP_IDS, TOTAL_STEPS

logger = logging.getLogger(__name__)


class OnboardingService:
    """Service for handling user onboarding"""
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def save_onboarding_progress(
        self,
        user_id: str,
        step: str,
        data: Dict[str, Any],
    ) -> bool:
        """Save onboarding progress for a step"""
        try:
            # Convert user_id to UUID for text() query strictness
            u_id = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
            
            # Get existing onboarding data - IMPORTANT: use user_id column for Supabase ID
            result = await self.db.execute(
                text("""
                    SELECT onboarding_data, onboarding_progress
                    FROM users
                    WHERE user_id = :user_id
                """),
                {"user_id": u_id}
            )
            user = result.fetchone()
            
            existing_data = {}
            existing_progress = {}
            
            if user:
                import json
                # Handle both string and dict formats from database
                if user.onboarding_data:
                    if isinstance(user.onboarding_data, str):
                        existing_data = json.loads(user.onboarding_data)
                    else:
                        existing_data = user.onboarding_data
                if user.onboarding_progress:
                    if isinstance(user.onboarding_progress, str):
                        existing_progress = json.loads(user.onboarding_progress)
                    else:
                        existing_progress = user.onboarding_progress
            
            # Update data and progress
            # CRITICAL: Ensure data is a dict, not a list
            # PostgreSQL JSONB requires top-level to be an object (dict), not an array (list)
            # Also ensure ALL nested lists contain only dicts
            
            def ensure_jsonb_compatible(obj, depth=0):
                """Recursively ensure all data is JSONB-compatible (dicts, not lists at top level, lists contain only dicts)"""
                if depth > 10:  # Prevent infinite recursion
                    return str(obj)
                
                if isinstance(obj, dict):
                    return {k: ensure_jsonb_compatible(v, depth + 1) for k, v in obj.items()}
                elif isinstance(obj, list):
                    if len(obj) == 0:
                        return []
                    # CRITICAL: All list items must be dicts for JSONB
                    cleaned_list = []
                    for item in obj:
                        cleaned_item = ensure_jsonb_compatible(item, depth + 1)
                        if isinstance(cleaned_item, dict):
                            cleaned_list.append(cleaned_item)
                        elif isinstance(cleaned_item, list):
                            # Nested list - wrap in dict
                            cleaned_list.append({"items": cleaned_item})
                        else:
                            # Primitive - wrap in dict
                            cleaned_list.append({"value": cleaned_item})
                    return cleaned_list
                else:
                    # Primitives are fine
                    return obj
            
            # Ensure data is properly structured
            if isinstance(data, list):
                # Top-level list - wrap in dict
                existing_data[step] = {"items": ensure_jsonb_compatible(data)}
                logger.info(f"⚠️ Wrapped top-level list data for step '{step}' in dict for JSONB compatibility")
            else:
                # Dict or primitive - ensure nested structures are compatible
                existing_data[step] = ensure_jsonb_compatible(data)
            
            existing_progress[step] = {
                "completed": True,
                "completed_at": datetime.utcnow().isoformat(),
            }

            # Extract profile fields when step is welcome/name so profile stays in sync
            first_name_val = None
            last_name_val = None
            company_val = None
            job_role_val = None
            industry_val = None
            company_size_val = None
            data_experience_val = None
            primary_use_case_val = None
            data_frequency_val = None
            goals_json_val = None
            if step in ("name", "welcome") and isinstance(data, dict):
                d: Dict[str, Any] = data
                personal = d.get("personal", d) if isinstance(d.get("personal"), dict) else d
                first_name_val = personal.get("firstName") or personal.get("first_name")
                last_name_val = personal.get("lastName") or personal.get("last_name")
                if not first_name_val and isinstance(d.get("displayName"), str):
                    parts = d["displayName"].strip().split(None, 1)
                    first_name_val = parts[0] if parts else None
                    last_name_val = parts[1] if len(parts) > 1 else None
                if not first_name_val and isinstance(d.get("name"), str):
                    first_name_val = d["name"].strip()
            elif step == "company" and isinstance(data, dict):
                company_val = data.get("organization") or data.get("company")
            elif step == "role" and isinstance(data, dict):
                raw_role = data.get("role") or data.get("job_role")
                job_role_val = raw_role if isinstance(raw_role, str) else None
            elif step == "primary_goal" and isinstance(data, dict):
                primary_use_case_val = data.get("primaryGoal") or data.get("primary_goal")
                goal_val = primary_use_case_val
                if goal_val:
                    import json as _json_goal
                    goals_json_val = _json_goal.dumps([str(goal_val)])
            elif step == "industry" and isinstance(data, dict):
                industry_val = data.get("industry")
            elif step == "company_size" and isinstance(data, dict):
                company_size_val = data.get("companySize") or data.get("company_size")
            elif step == "experience" and isinstance(data, dict):
                data_experience_val = data.get("experienceLevel") or data.get("dataExperience")
            elif step in ("workspace", "organization") and isinstance(data, dict):
                pass  # workspace name stored in onboarding_data only until complete

            # Save to database
            import json

            if isinstance(existing_data, list):
                existing_data = {"items": existing_data}
            if isinstance(existing_progress, list):
                existing_progress = {"items": existing_progress}

            existing_data_json = json.dumps(existing_data, default=str, ensure_ascii=False)
            existing_progress_json = json.dumps(existing_progress, default=str, ensure_ascii=False)
            try:
                json.loads(existing_data_json)
                json.loads(existing_progress_json)
            except json.JSONDecodeError as e:
                logger.error(f"❌ Failed to serialize onboarding data to valid JSON: {e}")
                raise ValueError(f"Invalid JSON structure: {e}")

            # Coerce scalar params to avoid "List argument must consist only of dictionaries"
            def _coerce_str(v):
                if isinstance(v, list):
                    v = v[0] if v else None
                if isinstance(v, dict):
                    return None
                return str(v) if v is not None else None

            fn = _coerce_str(first_name_val)
            ln = _coerce_str(last_name_val)
            # onboarding_started_at set on first save (COALESCE keeps existing); use dict params
            await self.db.execute(
                text("""
                    UPDATE users
                    SET
                        onboarding_data       = CAST(:onboarding_data AS jsonb),
                        onboarding_progress   = CAST(:onboarding_progress AS jsonb),
                        onboarding_started_at = COALESCE(onboarding_started_at, NOW()),
                        first_name            = COALESCE(:first_name, first_name),
                        last_name             = COALESCE(:last_name, last_name),
                        company               = COALESCE(:company, company),
                        job_role              = COALESCE(:job_role, job_role),
                        industry              = COALESCE(:industry, industry),
                        company_size          = COALESCE(:company_size, company_size),
                        data_experience       = COALESCE(:data_experience, data_experience),
                        primary_use_case      = COALESCE(:primary_use_case, primary_use_case),
                        data_frequency        = COALESCE(:data_frequency, data_frequency),
                        goals                 = COALESCE(CAST(:goals_json AS jsonb), goals),
                        updated_at            = NOW()
                    WHERE user_id = :user_id
                """),
                {
                    "onboarding_data": existing_data_json,
                    "onboarding_progress": existing_progress_json,
                    "user_id": u_id,
                    "first_name": fn,
                    "last_name": ln,
                    "company": _coerce_str(company_val),
                    "job_role": _coerce_str(job_role_val),
                    "industry": _coerce_str(industry_val),
                    "company_size": _coerce_str(company_size_val),
                    "data_experience": _coerce_str(data_experience_val),
                    "primary_use_case": _coerce_str(primary_use_case_val),
                    "data_frequency": _coerce_str(data_frequency_val),
                    "goals_json": goals_json_val,
                },
            )
            
            await self.db.commit()
            return True
            
        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to save onboarding progress: {str(e)}")
            return False
    
    async def complete_onboarding(
        self,
        user_id: str,
        onboarding_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Complete onboarding: update user profile, provision org + project.

        Idempotent: if org/project already exist, this just updates their names.

        Returns:
            {
                "success": bool,
                "organization_id": str (UUID),
                "project_id": str (UUID),
                "plan_type": str,
                "quick_start": Dict,
                "welcome_message": Dict,
            }
        """
        try:
            import json

            # ── 0. Fetch existing state from DB to ensure merge ─────────────
            u_id = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
            existing_result = await self.db.execute(
                text("SELECT onboarding_data, onboarding_progress FROM users WHERE user_id = :user_id"),
                {"user_id": u_id}
            )
            existing_user = existing_result.fetchone()
            
            db_onboarding_data = {}
            if existing_user and existing_user.onboarding_data:
                db_onboarding_data = json.loads(existing_user.onboarding_data) if isinstance(existing_user.onboarding_data, str) else existing_user.onboarding_data

            # Use frictionless optimizer to prefill missing data
            optimizer = FrictionlessOptimizer(self.db)
            onboarding_data = await optimizer.prefill_onboarding_data(
                user_id=user_id,
                onboarding_data=onboarding_data,
            )

            # ── 1. Map fields robustly from either structured payload or existing DB keys ──
            # Structured payload (preferred)
            od: Dict[str, Any] = onboarding_data
            personal = od.get("personal", {}) if isinstance(od.get("personal"), dict) else {}
            workspace = od.get("workspace", {}) if isinstance(od.get("workspace"), dict) else {}
            goals_section = od.get("goals", {}) if isinstance(od.get("goals"), dict) else {}
            plan_selection = od.get("plan", {}) if isinstance(od.get("plan"), dict) else {}
            
            # Fallback to incremental step keys if structured payload is empty
            db_od: Dict[str, Any] = db_onboarding_data
            welcome = db_od.get("welcome", {}) if isinstance(db_od.get("welcome"), dict) else {}
            name_inc = db_od.get("name", {}) if isinstance(db_od.get("name"), dict) else {}
            company_inc = db_od.get("company", {}) if isinstance(db_od.get("company"), dict) else {}
            role_inc = db_od.get("role", {}) if isinstance(db_od.get("role"), dict) else {}
            goal_inc = db_od.get("primary_goal", {}) if isinstance(db_od.get("primary_goal"), dict) else {}
            industry_inc = db_od.get("industry", {}) if isinstance(db_od.get("industry"), dict) else {}
            company_size_inc = db_od.get("company_size", {}) if isinstance(db_od.get("company_size"), dict) else {}
            experience_inc = db_od.get("experience", {}) if isinstance(db_od.get("experience"), dict) else {}
            org_inc = db_od.get("organization", {}) if isinstance(db_od.get("organization"), dict) else {}
            workspace_inc = db_od.get("workspace", {}) if isinstance(db_od.get("workspace"), dict) else {}

            first_name = (
                personal.get("firstName")
                or name_inc.get("firstName")
                or welcome.get("firstName")
                or welcome.get("first_name")
            )
            last_name = (
                personal.get("lastName")
                or name_inc.get("lastName")
                or welcome.get("lastName")
                or welcome.get("last_name")
            )
            role = (
                personal.get("role")
                or role_inc.get("role")
                or welcome.get("role")
            )
            industry = (
                personal.get("industry")
                or industry_inc.get("industry")
                or welcome.get("industry")
            )
            company_size = (
                personal.get("companySize")
                or company_size_inc.get("companySize")
                or company_size_inc.get("company_size")
                or welcome.get("companySize")
                or welcome.get("company_size")
            )

            experience_level = (
                goals_section.get("experienceLevel")
                or experience_inc.get("experienceLevel")
                or experience_inc.get("dataExperience")
                or welcome.get("dataExperience")
            )
            primary_goal = (
                goals_section.get("primaryGoal")
                or goal_inc.get("primaryGoal")
                or welcome.get("primaryUseCase")
            )
            data_frequency = goals_section.get("dataFrequency") or welcome.get("dataFrequency")

            goals_raw = goals_section.get("goals", []) or welcome.get("goals", [])

            org_name = (
                personal.get("company")
                or company_inc.get("company")
                or company_inc.get("organization")
                or welcome.get("company")
                or welcome.get("organization")
                or workspace.get("name")
                or workspace_inc.get("name")
                or org_inc.get("workspaceName")
                or f"{first_name or 'User'}'s Organization"
            )

            project_name = (
                workspace.get("name")
                or workspace_inc.get("name")
                or org_inc.get("workspaceName")
                or org_inc.get("workspaceName")
                or f"{first_name or 'User'}'s Project"
            )

            selected_plan = plan_selection.get("selectedPlan", "free")

            await optimizer.track_friction_points(
                user_id=user_id,
                step="complete",
                action="onboarding_completed",
            )

            # ── 1. Ensure JSONB-compatible onboarding payload ──────────────
            if isinstance(onboarding_data, list):
                onboarding_data = {"items": onboarding_data}

            def clean_for_json(obj, depth=0):
                if depth > 10:
                    return str(obj)
                if isinstance(obj, dict):
                    return {k: clean_for_json(v, depth + 1) for k, v in obj.items()}
                elif isinstance(obj, list):
                    if not obj:
                        return []
                    cleaned = []
                    for item in obj:
                        ci = clean_for_json(item, depth + 1)
                        if isinstance(ci, dict):
                            cleaned.append(ci)
                        elif isinstance(ci, list):
                            cleaned.append({"items": ci})
                        else:
                            cleaned.append({"value": ci})
                    return cleaned
                elif isinstance(obj, (str, int, float, bool, type(None))):
                    return obj
                elif hasattr(obj, "__dict__"):
                    return clean_for_json(obj.__dict__, depth + 1)
                return str(obj)

            onboarding_data_json = json.dumps(
                clean_for_json(onboarding_data), default=str, ensure_ascii=False
            )
            try:
                json.loads(onboarding_data_json)
            except json.JSONDecodeError as e:
                logger.error(f"Failed to serialize onboarding_data: {e}")
                onboarding_data_json = json.dumps({"error": "serialization_failed"})

            # ── 2. Update users row (structured columns + JSONB blob) ────────
            import json as _json_mod
            # Normalise goals to a plain list of strings for the dedicated column
            goals_strings: list = []
            for g in (goals_raw if isinstance(goals_raw, list) else []):
                if isinstance(g, str):
                    goals_strings.append(g)
                elif isinstance(g, dict):
                    goals_strings.append(g.get("value") or g.get("label") or str(g))

            await self.db.execute(
                text("""
                    UPDATE users
                    SET
                        first_name    = COALESCE(:first_name, first_name),
                        last_name     = COALESCE(:last_name, last_name),
                        company       = COALESCE(:company, company),
                        job_role      = COALESCE(:job_role, job_role),
                        industry      = COALESCE(:industry, industry),
                        company_size  = COALESCE(:company_size, company_size),
                        data_experience   = COALESCE(:data_experience, data_experience),
                        primary_use_case  = COALESCE(:primary_use_case, primary_use_case),
                        data_frequency    = COALESCE(:data_frequency, data_frequency),
                        goals             = COALESCE(CAST(:goals_json AS jsonb), goals),
                        onboarding_data         = CAST(:onboarding_data_json AS jsonb),
                        onboarding_completed_at = NOW(),
                        onboarding_started_at   = COALESCE(onboarding_started_at, NOW()),
                        updated_at = NOW()
                    WHERE user_id = :user_id
                """),
                {
                    "first_name": first_name,
                    "last_name": last_name,
                    "onboarding_data_json": onboarding_data_json,
                    "user_id": u_id,
                    "company": org_name,
                    "job_role": role,
                    "industry": industry,
                    "company_size": company_size,
                    "data_experience": experience_level,
                    "primary_use_case": primary_goal,
                    "data_frequency": data_frequency,
                    "goals_json": _json_mod.dumps(goals_strings) if goals_strings else None,
                },
            )


            # ── 3. Provision / rename Organization ────────────────────────
            org_result = await self.provision_default_organization(
                user_id=user_id,
                org_name=org_name,
            )
            organization_id = org_result["organization_id"]

            # ── 4. Provision / rename Project ─────────────────────────────
            project_result = await self.provision_default_project(
                organization_id=organization_id,
                user_id=user_id,
                project_name=project_name,
            )
            project_id = project_result["project_id"]

            # ── 5. Quick-start welcome message ────────────────────────────
            enhanced_service = EnhancedOnboardingService(self.db)
            quick_start = await enhanced_service.create_quick_start_setup(
                user_id=user_id,
                organization_id=organization_id,
                project_id=project_id,
                plan_type=selected_plan,
            )

            # Create sample_duckdb data sources for opted-in domains (same as Data Source Wizard)
            sample_domains_raw = onboarding_data.get("sampleDomainsOptIn") or []
            domain_labels = {
                "banking": "Banking",
                "education": "Education",
                "insurance": "Insurance",
                "ecommerce": "E-commerce",
                "retail_supply_chain": "Retail & Supply Chain",
                "telecom": "Telecom",
                "healthcare": "Healthcare",
                "saas": "SaaS",
                "ngo_impact": "NGO & Impact",
                "govt_public_services": "Government & Public Services",
                "energy": "Energy",
            }
            if isinstance(sample_domains_raw, list) and len(sample_domains_raw) > 0:
                from src.modules.project.service import ProjectService
                from src.modules.data.services.data_sources_crud import DataSourcesCRUD, DataSourceCreate
                try:
                    projects, _ = await ProjectService.get_user_projects(user_id)
                    if projects:
                        project_id = str(projects[0].id)
                        crud = DataSourcesCRUD()
                        for item in sample_domains_raw:
                            domain = item.get("value") if isinstance(item, dict) else (item if isinstance(item, str) else None)
                            if not domain or not domain.replace("_", "").replace("-", "").isalnum():
                                continue
                            domain = str(domain).strip().lower()
                            name = f"Sample: {domain_labels.get(domain, domain.replace('_', ' ').title())}"
                            create_data = DataSourceCreate(
                                name=name,
                                type="sample_duckdb",
                                format="sample_duckdb",
                                description="Sample data added from onboarding",
                                connection_config={"domain": domain},
                                project_id=project_id,
                                is_active=True,
                            )
                            await crud.create_data_source(
                                data_source_data=create_data,
                                user_id=user_id,
                                session=self.db,
                            )
                            logger.info("Created sample_duckdb source for domain %s (onboarding)", domain)
                except Exception as e:
                    logger.warning("Could not create onboarding sample data sources: %s", e)
            
            # Track onboarding completion analytics
            await enhanced_service.track_onboarding_analytics(
                user_id=user_id,
                event="onboarding_completed",
                metadata={
                    "plan_type": selected_plan,
                    "organization_id": str(organization_id) if organization_id else None,
                    "project_id": str(project_id) if project_id else None,
                },
            )

            await self.db.commit()

            # ── 6. Provision trial subscription if requested ─────────────
            enable_pro_trial = bool(plan_selection.get("enableProTrial", False))
            enable_team_trial = plan_selection.get("enableTeamTrial")
            if enable_team_trial is None and selected_plan == "team":
                enable_team_trial = True
            else:
                enable_team_trial = bool(enable_team_trial)
            trial_plan = None
            if enable_pro_trial:
                trial_plan = "pro"
            elif enable_team_trial:
                trial_plan = "team"

            requires_checkout = False
            checkout_plan = None
            if trial_plan:
                await self.provision_trial_subscription(
                    organization_id=organization_id,
                    plan_slug=trial_plan,
                )
                await self.db.commit()
                selected_plan = trial_plan
            elif selected_plan in ("pro", "team"):
                # User picked a paid plan without a trial — signal frontend to go to Stripe
                requires_checkout = True
                checkout_plan = selected_plan

            return {
                "success": True,
                "organization_id": str(organization_id) if organization_id else None,
                "project_id": str(project_id) if project_id else None,
                "plan_type": selected_plan,
                "quick_start": quick_start,
                "welcome_message": quick_start.get("welcome_message", {}),
                "requires_checkout": requires_checkout,
                "checkout_plan": checkout_plan,
            }

        except Exception as e:
            await self.db.rollback()
            logger.error(f"Failed to complete onboarding: {str(e)}")
            raise
    
    async def provision_default_organization(
        self,
        user_id: str,
        org_name: str,
    ) -> Dict[str, Any]:
        """
        Fetch-or-create the user's organization, then update its name.

        Logic:
          1. Look up user_roles to find an existing org the user owns or belongs to.
          2. If found  → UPDATE organizations SET name = $org_name.
          3. If not    → INSERT INTO organizations, then assign user as org_owner
                         in user_roles.

        Always returns the real `organization_id` (UUID string).
        """
        from src.core.deployment_mode import is_self_host_deployment
        from src.modules.organizations.deployment_org import (
            ensure_deployment_organization,
            ensure_self_host_user_membership,
        )

        if is_self_host_deployment():
            org = await ensure_deployment_organization()
            await ensure_self_host_user_membership(user_id)
            return {
                "organization_id": org.id,
                "organization_name": org.name,
            }

        # Convert user_id to UUID
        u_id = uuid.UUID(user_id) if isinstance(user_id, str) else user_id

        # ── Check whether user already has an organization ─────────────
        existing = await self.db.execute(
            text("""
                SELECT ur.organization_id
                FROM   user_roles ur
                WHERE  ur.user_id = :user_id
                  AND  ur.organization_id IS NOT NULL
                ORDER BY ur.created_at ASC
                LIMIT  1
            """),
            {"user_id": u_id},
        )
        row = existing.fetchone()

        if row and row.organization_id:
            organization_id = row.organization_id
            # Update the name (rename only – no new row)
            await self.db.execute(
                text("""
                    UPDATE organizations
                    SET    name       = :org_name,
                           updated_at = NOW()
                    WHERE  id = :organization_id
                """),
                {"org_name": org_name, "organization_id": organization_id},
            )
            logger.info(f"Updated organization {organization_id} name to '{org_name}'")
        else:
            # Create a brand-new organization
            result = await self.db.execute(
                text("""
                    INSERT INTO organizations (name)
                    VALUES (:org_name)
                    RETURNING id
                """),
                {"org_name": org_name},
            )
            org_row = result.fetchone()
            organization_id = org_row.id
            logger.info(f"Created organization {organization_id} '{org_name}' for user {user_id}")

            # Assign org_owner role (best-effort; if the role row doesn't exist we skip)
            try:
                role_row = await self.db.execute(
                    text("""
                        SELECT id FROM roles
                        WHERE  name  = 'org_owner'
                          AND  scope = 'organization'
                        LIMIT 1
                    """),
                )
                role = role_row.fetchone()
                if role:
                    await self.db.execute(
                        text("""
                            INSERT INTO user_roles
                                (user_id, role_id, organization_id)
                            VALUES (:user_id, :role_id, :organization_id)
                            ON CONFLICT DO NOTHING
                        """),
                        {"user_id": u_id, "role_id": role.id, "organization_id": organization_id},
                    )
            except Exception as role_err:
                logger.warning(f"Could not assign org_owner role (non-fatal): {role_err}")

        return {
            "organization_id": organization_id,
            "organization_name": org_name,
        }

    async def provision_default_project(
        self,
        organization_id: Any,
        user_id: str,
        project_name: str,
    ) -> Dict[str, Any]:
        """
        Fetch-or-create the default project for an organization, then update its name.

        Logic:
          1. Look up the first project belonging to `organization_id`.
          2. If found  → UPDATE projects SET name = $project_name.
          3. If not    → INSERT INTO projects.

        Always returns the real `project_id` (UUID string).
        """
        if not organization_id:
            logger.warning("provision_default_project called without organization_id")
            return {"project_id": None, "project_name": project_name}

        # Convert user_id to UUID
        u_id = uuid.UUID(user_id) if isinstance(user_id, str) else user_id

        existing = await self.db.execute(
            text("""
                SELECT id FROM projects
                WHERE  organization_id = :organization_id
                ORDER BY created_at ASC
                LIMIT  1
            """),
            {"organization_id": organization_id},
        )
        row = existing.fetchone()

        if row:
            project_id = row.id
            await self.db.execute(
                text("""
                    UPDATE projects
                    SET    name       = :project_name,
                           updated_at = NOW()
                    WHERE  id = :project_id
                """),
                {"project_name": project_name, "project_id": project_id},
            )
            logger.info(f"Updated project {project_id} name to '{project_name}'")
        else:
            result = await self.db.execute(
                text("""
                    INSERT INTO projects (organization_id, name)
                    VALUES (:organization_id, :project_name)
                    RETURNING id
                """),
                {"organization_id": organization_id, "project_name": project_name},
            )
            proj_row = result.fetchone()
            project_id = proj_row.id
            logger.info(f"Created project {project_id} '{project_name}' for org {organization_id}")

        # Ensure user has project_owner on this project (required for EE project APIs)
        try:
            role_row = await self.db.execute(
                text("""
                    SELECT id FROM roles
                    WHERE  name  = 'project_owner'
                      AND  scope = 'project'
                    LIMIT 1
                """),
            )
            owner_role = role_row.fetchone()
            if owner_role:
                existing_project_role = await self.db.execute(
                    text("""
                        SELECT id FROM user_roles
                        WHERE  user_id = :user_id
                          AND  project_id = :project_id
                          AND  is_active = true
                        LIMIT 1
                    """),
                    {"user_id": u_id, "project_id": project_id},
                )
                if not existing_project_role.fetchone():
                    await self.db.execute(
                        text("""
                            INSERT INTO user_roles
                                (user_id, role_id, organization_id, project_id)
                            VALUES (:user_id, :role_id, :organization_id, :project_id)
                            ON CONFLICT DO NOTHING
                        """),
                        {
                            "user_id": u_id,
                            "role_id": owner_role.id,
                            "organization_id": organization_id,
                            "project_id": project_id,
                        },
                    )
                    logger.info(
                        "Assigned project_owner on project %s for user %s",
                        project_id,
                        user_id,
                    )
        except Exception as role_err:
            logger.warning(f"Could not assign project_owner role (non-fatal): {role_err}")

        return {
            "project_id": project_id,
            "project_name": project_name,
        }

    async def get_organization(self, user_id: str) -> Dict[str, Any]:
        """
        Return the organization and default project for the user.
        Used by the frontend to pre-fill the onboarding Company/Project fields.

        Returns:
            {
                "organization_id": str | None,
                "organization_name": str | None,
                "project_id": str | None,
                "project_name": str | None,
            }
        """
        try:
            u_id = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
            
            # 1. Find org via user_roles
            org_row = await self.db.execute(
                text("""
                    SELECT o.id, o.name
                    FROM   user_roles ur
                    JOIN   organizations o ON o.id = ur.organization_id
                    WHERE  ur.user_id = :user_id
                      AND  ur.organization_id IS NOT NULL
                      AND  ur.is_active = true
                    ORDER BY o.created_at ASC
                    LIMIT 1
                """),
                {"user_id": u_id},
            )
            org = org_row.fetchone()

            if not org:
                # Fall back to users.company if the org row doesn't exist yet
                user_row = await self.db.execute(
                    text("SELECT company FROM users WHERE user_id = :user_id"),
                    {"user_id": u_id},
                )
                user = user_row.fetchone()
                return {
                    "organization_id": None,
                    "organization_name": getattr(user, "company", None) if user else None,
                    "project_id": None,
                    "project_name": None,
                }

            # 2. Find default project
            proj_row = await self.db.execute(
                text("""
                    SELECT id, name
                    FROM   projects
                    WHERE  organization_id = :organization_id
                    AND    is_active = true
                    ORDER BY created_at ASC
                    LIMIT  1
                """),
                {"organization_id": org.id},
            )
            proj = proj_row.fetchone()

            return {
                "organization_id": str(org.id),
                "organization_name": org.name,
                "project_id": str(proj.id) if proj else None,
                "project_name": proj.name if proj else None,
            }
        except Exception as e:
            logger.error(f"Error in get_org_info: {str(e)}")
            return {
                "organization_id": None,
                "organization_name": None,
                "project_id": None,
                "project_name": None,
            }
    
    def _generate_slug(self, name: str, user_id: str) -> str:
        """Generate unique slug from name"""
        import re
        slug = re.sub(r'[^a-z0-9]+', '-', name.lower()).strip('-')
        # Add short user ID to ensure uniqueness
        short_id = str(user_id)[:8]
        return f"{slug}-{short_id}"

    async def provision_trial_subscription(
        self,
        organization_id: Any,
        plan_slug: str,
    ) -> None:
        """
        Upsert an in-app trialing subscription for the given org.
        No Stripe involved — status='trialing', provider='internal', 14 days from now.
        Called from complete_onboarding() when the user enables a trial toggle.
        """
        from datetime import timedelta

        trial_ends = datetime.utcnow() + timedelta(days=14)

        plan_row = await self.db.execute(
            text("SELECT id FROM subscription_plans WHERE slug = :slug LIMIT 1"),
            {"slug": plan_slug},
        )
        plan = plan_row.fetchone()
        if not plan:
            logger.warning(f"provision_trial_subscription: plan '{plan_slug}' not found — skipping")
            return

        await self.db.execute(
            text("""
                INSERT INTO organization_subscriptions
                    (organization_id, plan_id, status, trial_ends_at, trial_expiring_soon, provider)
                VALUES
                    (:org_id, :plan_id, 'trialing', :trial_ends, false, 'internal')
                ON CONFLICT (organization_id) DO UPDATE
                    SET plan_id              = EXCLUDED.plan_id,
                        status               = 'trialing',
                        trial_ends_at        = EXCLUDED.trial_ends_at,
                        trial_expiring_soon  = false,
                        provider             = 'internal',
                        provider_subscription_id = NULL,
                        provider_customer_id     = NULL
            """),
            {"org_id": organization_id, "plan_id": plan.id, "trial_ends": trial_ends},
        )
        logger.info(
            "Provisioned %s trial for org %s until %s",
            plan_slug, organization_id, trial_ends.isoformat(),
        )

    @staticmethod
    async def mark_completed(user_id: str, db: AsyncSession) -> None:
        """
        Mark onboarding as completed for a user without running the full provisioning flow.
        Used when an invited member accepts an invitation — they join an existing org so no
        org/project/plan setup is needed.
        """
        u_id = uuid.UUID(user_id) if isinstance(user_id, str) else user_id
        await db.execute(
            text("""
                UPDATE users
                SET onboarding_completed_at = NOW(),
                    updated_at              = NOW()
                WHERE user_id = :user_id
            """),
            {"user_id": u_id},
        )
        logger.info("Marked onboarding completed for invited user %s", user_id)

