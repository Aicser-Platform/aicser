"""Central API router — CE routes always loaded; EE routes lazy-loaded."""
from __future__ import annotations

import logging
from typing import Union

from fastapi import APIRouter, Depends, HTTPException, status

from src.core.edition import is_ee_enabled
from src.core.config import settings

# ── CE imports (always loaded) ────────────────────────────────────────────────
from src.modules.authentication.router import router as auth_api_router
from src.modules.charts.router import router as visual_charts_router
from src.modules.charts.router import standalone_chart_router
from src.modules.data.router import router as data_router
from src.modules.dashboards.router import router as dashboards_router
from src.modules.dashboards.charts.router import router as charts_router
from src.modules.feed.router import router as feed_router
from src.modules.knowledge.router import router as knowledge_router
from src.modules.notifications.router import router as notifications_router
from src.modules.onboarding.router import router as onboarding_router
from src.modules.pricing.router import router as pricing_router
from src.modules.queries.router import router as queries_router
from src.modules.translations.router import router as translations_router
from src.modules.user.router import router as user_router
from src.modules.debug.router import router as debug_router
from src.modules.authentication.deps.auth_bearer import JWTCookieBearer

logger = logging.getLogger(__name__)

api_router = APIRouter()


@api_router.get("/")
async def root():
    return {
        "name": settings.APP_NAME,
        "version": settings.APP_VERSION,
        "contact": settings.APP_CONTACT,
    }


# ── CE routes (always registered) ────────────────────────────────────────────
api_router.include_router(auth_api_router, prefix="", tags=["auth"])
api_router.include_router(user_router, prefix="/api/users", tags=["users"])
api_router.include_router(notifications_router, prefix="/api/notifications", tags=["notifications"])
api_router.include_router(visual_charts_router, prefix="/charts", tags=["charts"])
api_router.include_router(data_router, prefix="/data", tags=["data"])
api_router.include_router(onboarding_router, prefix="/api/onboarding", tags=["onboarding"])
api_router.include_router(queries_router, prefix="/api/queries", tags=["queries"])
api_router.include_router(feed_router, prefix="/api/feed", tags=["feed"])
api_router.include_router(charts_router, prefix="/api/dashboards/{dashboard_id}/charts", tags=["charts"])
api_router.include_router(dashboards_router, prefix="/api/dashboards", tags=["dashboards"])
api_router.include_router(standalone_chart_router, prefix="/api/chart", tags=["charts"])
api_router.include_router(knowledge_router, prefix="/knowledge", tags=["knowledge"])
api_router.include_router(debug_router, prefix="/debug", tags=["debug"])
api_router.include_router(pricing_router)
api_router.include_router(translations_router, prefix="/api")


@api_router.get("/api/data/sources/{data_source_id}")
async def get_data_source_proxy(
    data_source_id: str,
    current_token: Union[str, dict] = Depends(JWTCookieBearer()),
):
    """Compatibility proxy for /data/sources/{id} with /api prefix."""
    from src.modules.data.router import get_data_source
    try:
        return await get_data_source(data_source_id, current_token)
    except Exception as e:
        raise HTTPException(status_code=status.HTTP_500_INTERNAL_SERVER_ERROR, detail=str(e))


# ── EE routes (lazy-loaded, only when AISER_EDITION=enterprise) ───────────────
if is_ee_enabled():
    try:
        from ee.modules.chats.router import router as chat_module_router
        from ee.modules.chats.conversations.router import router as conversation_router
        from ee.modules.chats.assets.router import router as assets_router
        api_router.include_router(chat_module_router, prefix="/chats", tags=["chats"])
        api_router.include_router(conversation_router, prefix="/conversations", tags=["conversations"])
        api_router.include_router(assets_router, prefix="/assets", tags=["assets"])
    except Exception as _err:
        logger.warning("Chats router not loaded: %s", _err)

    try:
        from ee.modules.ai.router import router as ai_router
        from ee.modules.ai.api_streaming import router as ai_streaming_router
        api_router.include_router(ai_streaming_router, prefix="/ai", tags=["ai-streaming"])
        api_router.include_router(ai_router, prefix="/ai", tags=["ai"])
    except Exception as _err:
        logger.warning("AI router not loaded: %s", _err)

    try:
        from ee.modules.alerts.router import router as alerts_router
        api_router.include_router(alerts_router, prefix="/api/alerts", tags=["alerts"])
    except Exception as _err:
        logger.warning("Alerts router not loaded: %s", _err)

    try:
        from ee.modules.decision_os.router import router as decision_os_router
        api_router.include_router(decision_os_router, prefix="/api/decision-os", tags=["decision-os"])
    except Exception as _err:
        logger.warning("DecisionOS router not loaded: %s", _err)

    try:
        from ee.modules.authentication.router import router as ee_auth_router
        api_router.include_router(ee_auth_router, prefix="", tags=["auth"])
    except Exception as _err:
        logger.warning("EE auth token exchange not loaded: %s", _err)

    try:
        from ee.modules.authentication.rbac.router import router as rbac_router
        api_router.include_router(rbac_router, prefix="/api/rbac", tags=["RBAC"])
    except Exception as _err:
        logger.warning("RBAC router not loaded: %s", _err)

    try:
        from ee.modules.organizations.router import router as organizations_router
        api_router.include_router(organizations_router, prefix="/api/organizations", tags=["organizations"])
    except Exception as _err:
        logger.warning("Organizations router not loaded: %s", _err)

    try:
        from ee.modules.invitations.router import router as invitations_router
        api_router.include_router(invitations_router, prefix="/api/invitations", tags=["invitations"])
    except Exception as _err:
        logger.warning("Invitations router not loaded: %s", _err)

    try:
        from ee.modules.project.router import router as project_router
        api_router.include_router(project_router, prefix="/api/projects", tags=["projects"])
    except Exception as _err:
        logger.warning("Projects router not loaded: %s", _err)

    try:
        from ee.modules.platform.router import router as platform_intelligence_router
        api_router.include_router(platform_intelligence_router, prefix="/api", tags=["platform-intelligence"])
    except Exception as _err:
        logger.warning("Platform intelligence router not loaded: %s", _err)

    try:
        from ee.modules.schedule_email.router import router as schedule_email_router
        api_router.include_router(schedule_email_router, prefix="/api/schedule-email", tags=["schedule-email"])
    except Exception as _err:
        logger.warning("Schedule email router not loaded: %s", _err)

    try:
        from src.modules.embed.router import router as embed_router
        api_router.include_router(embed_router, prefix="/api/embed", tags=["embed"])
    except Exception as _err:
        logger.warning("Embed router not loaded: %s", _err)

    try:
        from ee.modules.embed.assistant_router import router as embed_assistant_router
        api_router.include_router(embed_assistant_router, prefix="/api/embed/assistants", tags=["embed-assistants"])
    except Exception as _err:
        logger.warning("Embed assistants router not loaded: %s", _err)

    try:
        from ee.modules.knowledge.library_router import router as knowledge_library_router
        api_router.include_router(knowledge_library_router, prefix="/knowledge/libraries", tags=["knowledge-libraries"])
    except Exception as _err:
        logger.warning("Knowledge libraries router not loaded: %s", _err)

    try:
        from ee.modules.telegram.router import router as telegram_router
        api_router.include_router(telegram_router, prefix="/api/v1")
    except Exception as _err:
        logger.warning("Telegram router not loaded: %s", _err)
