"""
Enhanced Onboarding Service
Frictionless onboarding with smart defaults, quick start, and value demonstration
"""

import logging
from typing import Dict, Any, Optional, List
from datetime import datetime, timedelta
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy import text

from src.modules.pricing.plans import get_plan_config

logger = logging.getLogger(__name__)


class EnhancedOnboardingService:
    """
    Enhanced onboarding with frictionless experience:
    - Smart defaults
    - Quick start templates
    - Value demonstration
    - Progressive disclosure
    """
    
    def __init__(self, db: AsyncSession):
        self.db = db
    
    async def create_quick_start_setup(
        self,
        user_id: str,
        organization_id: Optional[int],  # No longer used
        project_id: Optional[int],  # No longer used
        plan_type: str = "free",
    ) -> Dict[str, Any]:
        """
        Create quick start setup for immediate value:
        - Welcome message with next steps
        - Organization/project creation removed
        """
        try:
            quick_start = {
                "sample_dashboard_created": False,
                "sample_data_source_created": False,
                "welcome_tour_completed": False,
            }
            
            # Skip dashboard creation - organization context removed
            # Users can create dashboards after onboarding if needed
            
            # Create welcome message with personalized next steps
            welcome_message = await self._create_welcome_message(
                user_id=user_id,
                plan_type=plan_type,
            )
            quick_start["welcome_message"] = welcome_message
            
            return quick_start
            
        except Exception as e:
            logger.error(f"Failed to create quick start setup: {str(e)}")
            return {"success": False, "error": str(e)}
    
    async def _create_sample_dashboard(
        self,
        organization_id: Optional[int],  # No longer used
        project_id: Optional[int],  # No longer used
        user_id: str,
    ) -> Dict[str, Any]:
        """Create a sample dashboard to demonstrate value - DISABLED (organization context removed)"""
        # Dashboard creation removed - organization/project context removed
        # Users can create dashboards after onboarding if needed
        return {"success": False, "error": "Dashboard creation disabled - organization context removed"}
    
    async def _create_welcome_message(
        self,
        user_id: str,
        plan_type: str,
    ) -> Dict[str, Any]:
        """Create personalized welcome message with next steps"""
        plan_config = get_plan_config(plan_type)
        
        # Personalized next steps based on plan
        if plan_type == "free":
            next_steps = [
                {
                    "title": "Connect Your First Data Source",
                    "description": "Upload a CSV file or connect to a database to get started",
                    "action": "connect_data_source",
                    "priority": 1,
                },
                {
                    "title": "Try AI Chat",
                    "description": "Ask questions about your data using natural language",
                    "action": "open_chat",
                    "priority": 2,
                },
                {
                    "title": "Create Your First Chart",
                    "description": "Use the AI to generate visualizations from your data",
                    "action": "create_chart",
                    "priority": 3,
                },
                {
                    "title": "Upgrade to Pro",
                    "description": f"Get {plan_config['ai_credits_limit']} AI credits and unlimited projects",
                    "action": "upgrade_plan",
                    "priority": 4,
                },
            ]
        elif plan_type == "pro":
            next_steps = [
                {
                    "title": "Connect Multiple Data Sources",
                    "description": "Link all your data sources for comprehensive analysis",
                    "action": "connect_data_source",
                    "priority": 1,
                },
                {
                    "title": "Build Your First Dashboard",
                    "description": "Create a dashboard with multiple charts and insights",
                    "action": "create_dashboard",
                    "priority": 2,
                },
                {
                    "title": "Explore Advanced Features",
                    "description": "Try theme customization, API access, and more",
                    "action": "explore_features",
                    "priority": 3,
                },
            ]
        else:  # Team/Enterprise
            next_steps = [
                {
                    "title": "Invite Team Members",
                    "description": "Collaborate with your team on dashboards and analysis",
                    "action": "invite_team",
                    "priority": 1,
                },
                {
                    "title": "Set Up Data Sources",
                    "description": "Connect all your data sources for team access",
                    "action": "connect_data_source",
                    "priority": 2,
                },
                {
                    "title": "Create Team Dashboards",
                    "description": "Build shared dashboards for your organization",
                    "action": "create_dashboard",
                    "priority": 3,
                },
            ]
        
        return {
            "title": "Welcome to Aicser! 🚀",
            "message": f"You're all set with the {plan_config['name']} plan. Here's how to get started:",
            "next_steps": next_steps,
            "plan_type": plan_type,
            "credits_available": plan_config["ai_credits_limit"],
        }
    
    async def get_smart_defaults(
        self,
        onboarding_data: Dict[str, Any],
    ) -> Dict[str, Any]:
        """
        Generate smart defaults based on onboarding data:
        - Industry-specific templates
        - Role-based recommendations
        - Use case optimizations
        """
        personal = onboarding_data.get("personal", {})
        goals = onboarding_data.get("goals", {})
        
        industry = personal.get("industry", "general")
        role = personal.get("role", "")
        primary_goal = goals.get("primaryGoal", "")
        experience_level = goals.get("experienceLevel", "beginner")
        
        defaults = {
            "dashboard_template": self._get_dashboard_template(industry, primary_goal),
            "recommended_data_sources": self._get_recommended_data_sources(industry),
            "feature_highlights": self._get_feature_highlights(experience_level, role),
            "quick_tips": self._get_quick_tips(experience_level),
        }
        
        return defaults
    
    def _get_dashboard_template(
        self,
        industry: str,
        primary_goal: str,
    ) -> str:
        """Get recommended dashboard template based on industry and goal"""
        templates = {
            "sales_analytics": "sales_performance",
            "marketing_analytics": "marketing_campaigns",
            "financial_reporting": "financial_overview",
            "operational_monitoring": "operations_dashboard",
            "customer_analytics": "customer_insights",
        }
        
        return templates.get(primary_goal, "general_analytics")
    
    def _get_recommended_data_sources(
        self,
        industry: str,
    ) -> List[str]:
        """Get recommended data source types for industry"""
        recommendations = {
            "technology": ["PostgreSQL", "CSV", "API"],
            "finance": ["PostgreSQL", "ClickHouse", "CSV"],
            "retail": ["PostgreSQL", "CSV", "API"],
            "healthcare": ["PostgreSQL", "CSV"],
            "manufacturing": ["PostgreSQL", "ClickHouse"],
        }
        
        return recommendations.get(industry, ["PostgreSQL", "CSV"])
    
    def _get_feature_highlights(
        self,
        experience_level: str,
        role: str,
    ) -> List[str]:
        """Get feature highlights based on experience and role"""
        if experience_level == "beginner":
            return [
                "AI Chat - Ask questions in plain English",
                "Auto-generated Charts - No coding required",
                "Guided Tutorials - Step-by-step help",
            ]
        elif experience_level == "intermediate":
            return [
                "SQL Editor - Write custom queries",
                "Dashboard Builder - Create custom dashboards",
                "Data Source Connections - Connect multiple sources",
            ]
        else:  # advanced/expert
            return [
                "API Access - Integrate with your tools",
                "Custom Themes - Brand your dashboards",
                "Advanced Analytics - Deep insights",
            ]
    
    def _get_quick_tips(
        self,
        experience_level: str,
    ) -> List[str]:
        """Get quick tips based on experience level"""
        if experience_level == "beginner":
            return [
                "Start with simple questions like 'Show me sales by month'",
                "Use the AI Chat to explore your data naturally",
                "Try the sample dashboard to see what's possible",
            ]
        elif experience_level == "intermediate":
            return [
                "Use SQL Editor for complex queries",
                "Create dashboards to share insights with your team",
                "Connect multiple data sources for comprehensive analysis",
            ]
        else:
            return [
                "Use API access to integrate Aiser into your workflow",
                "Customize themes to match your brand",
                "Set up automated reports and alerts",
            ]
    
    async def track_onboarding_analytics(
        self,
        user_id: str,
        event: str,
        metadata: Optional[Dict[str, Any]] = None,
    ):
        """Track onboarding analytics for success metrics"""
        try:
            import json
            metadata_json = json.dumps(metadata or {}, default=str)
            await self.db.execute(
                text("""
                    INSERT INTO onboarding_analytics (
                        user_id,
                        event,
                        metadata,
                        created_at
                    ) VALUES (
                        :user_id,
                        :event,
                        CAST(:metadata_json::text AS jsonb),
                        NOW()
                    )
                """),
                {
                    "user_id": user_id,
                    "event": event,
                    "metadata_json": metadata_json,
                }
            )
            await self.db.commit()
        except Exception as e:
            # Non-fatal - analytics shouldn't break onboarding
            logger.warning(f"Failed to track onboarding analytics: {str(e)}")
    
    async def should_show_tour(
        self,
        user_id: str,
    ) -> bool:
        """Determine if user should see guided tour"""
        result = await self.db.execute(
            text("""
                SELECT 
                    onboarding_completed_at,
                    onboarding_data
                FROM users
                WHERE id = :user_id
            """),
            {"user_id": user_id}
        )
        user = result.fetchone()
        
        if not user:
            return False
        
        # Show tour if onboarding just completed (within last hour)
        if user.onboarding_completed_at:
            time_since_completion = datetime.utcnow() - user.onboarding_completed_at
            if time_since_completion < timedelta(hours=1):
                return True
        
        return False


