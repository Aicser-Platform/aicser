"""Import all SQLAlchemy models so Alembic autogenerate detects every table.

Import order matters: tables with no FK dependencies first, then tables that
reference them, so SQLAlchemy can resolve all ForeignKey targets at load time.

CE models are always imported. EE models are imported only when is_ee_enabled()
so that CE migrations only create CE tables.
"""
from src.core.edition import is_ee_enabled
from src.core.licensing.models import LicenseStateRecord
from src.core.system_settings.models import SystemSetting
from src.modules.authentication.models import PasswordResetToken
from src.modules.charts.models import Chart, QueryPattern
from src.modules.dashboards.models import Dashboard, DashboardChart
from src.modules.data.models import (
    ConnectorRuntimeJob,
    DataAssetProfile,
    DataCDCState,
    DataIngestionJob,
    DataLakeObject,
    DataLineageEdge,
    DataLineageNode,
    DataOnboardingSession,
    DataPipeline,
    DataSource,
    DataSourceAccessGrant,
    DataSourceRLSPolicy,
    DataSourceRLSRule,
    FileStorage,
    ProjectDataSource,
    SemanticLayerArtifact,
)
from src.modules.feed.models import (
    FeedAuthorFollow,
    FeedChatDraft,
    FeedCollection,
    FeedCollectionItem,
    FeedComment,
    FeedCommentReaction,
    FeedDigestSubscription,
    FeedEvent,
    FeedInteraction,
    FeedNotification,
    FeedPost,
    FeedShare,
    FeedSnapshot,
    FeedView,
)
from src.modules.knowledge.models import (
    DocumentChunk,
    KnowledgeDocument,
    SchemaColumnIndex,
    SchemaTableIndex,
)

# ── CE models (always imported) ───────────────────────────────────────────────
from src.modules.user.models import User

# ── EE models (only when enterprise) ─────────────────────────────────────────
# NOTE: Always import via src.modules.* shim paths (not ee.modules.* directly)
# so Python's module cache deduplicates across all import sites.
if is_ee_enabled():
    try:
        from src.modules.billing.models import (
            OrganizationSubscription,
            OrganizationUsage,
            PaymentHistory,
            SubscriptionPlan,
        )
    except ImportError:
        pass

    try:
        from src.modules.organizations.models import (
            Organization,
            OrganizationKpiDefinition,
        )
    except ImportError:
        pass

    try:
        from src.modules.project.models import Project
    except ImportError:
        pass

    try:
        from src.modules.authentication.rbac.models import (
            Permission,
            Role,
            RolePermission,
            UserRole,
        )
    except ImportError:
        pass

    try:
        from src.modules.invitations.models import OrganizationInvitation
    except ImportError:
        pass

    try:
        from src.modules.chats.models import Conversation, Message
    except ImportError:
        pass

    try:
        from src.modules.ai.models import LlmAuditLog, LlmRequestSummary
    except ImportError:
        pass

    try:
        from src.modules.catalog.models import CatalogAsset
    except ImportError:
        pass

    try:
        from src.modules.platform.models import PlatformLineageEvent, PlatformPolicyRule
    except ImportError:
        pass

    try:
        from src.modules.schedule_email.models import Scheduled_emails
    except ImportError:
        pass
