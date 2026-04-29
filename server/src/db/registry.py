"""Import all SQLAlchemy models so Alembic autogenerate detects every table.

Import order matters: tables with no FK dependencies first, then tables that
reference them, so SQLAlchemy can resolve all ForeignKey targets at load time.

CE models are always imported. EE models are imported only when is_ee_enabled()
so that CE migrations only create CE tables.
"""
from src.core.edition import is_ee_enabled

# ── CE models (always imported) ───────────────────────────────────────────────
from src.modules.user.models import User
from src.modules.data.models import DataSource, ProjectDataSource, FileStorage, ConnectorRuntimeJob
from src.modules.dashboards.models import Dashboard, DashboardChart
from src.modules.charts.models import Chart, QueryPattern
from src.modules.knowledge.models import (
    KnowledgeDocument, DocumentChunk, SchemaTableIndex, SchemaColumnIndex
)
from src.modules.feed.models import (
    FeedPost, FeedComment, FeedCommentReaction, FeedInteraction,
    FeedAuthorFollow, FeedEvent, FeedView, FeedCollection,
    FeedCollectionItem, FeedNotification, FeedShare
)

# ── EE models (only when enterprise) ─────────────────────────────────────────
if is_ee_enabled():
    try:
        from ee.modules.billing.models import (
            SubscriptionPlan, OrganizationSubscription, OrganizationUsage, PaymentHistory
        )
    except ImportError:
        pass

    try:
        from ee.modules.organizations.models import Organization, OrganizationKpiDefinition
    except ImportError:
        pass

    try:
        from ee.modules.project.models import Project
    except ImportError:
        pass

    try:
        from ee.modules.authentication.rbac.models import Role, Permission, RolePermission, UserRole
    except ImportError:
        pass

    try:
        from ee.modules.invitations.models import OrganizationInvitation
    except ImportError:
        pass

    try:
        from ee.modules.chats.models import Conversation, Message
    except ImportError:
        pass

    try:
        from ee.modules.ai.models import LlmAuditLog, LlmRequestSummary
    except ImportError:
        pass

    try:
        from ee.modules.catalog.models import CatalogAsset
    except ImportError:
        pass

    try:
        from ee.modules.platform.models import PlatformLineageEvent, PlatformPolicyRule
    except ImportError:
        pass

    try:
        from ee.modules.schedule_email.models import Scheduled_emails
    except ImportError:
        pass
