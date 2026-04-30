"""Social feed domain SQLAlchemy models."""
from sqlalchemy import (
    Column, String, Integer, DateTime, Text, Boolean, ForeignKey,
    UniqueConstraint, Enum, Index,
)
from sqlalchemy.dialects.postgresql import ARRAY, JSONB, UUID
from sqlalchemy.sql import func, text

from src.core.edition import is_ee_enabled
from src.db.base import Base

def _org_fk():
    return [ForeignKey("organizations.id")] if is_ee_enabled() else []
def _project_fk():
    return [ForeignKey("projects.id")] if is_ee_enabled() else []


# ============================================================================
# SOCIAL FEED MODELS (SIMPLIFIED)
# ============================================================================


class FeedPost(Base):
    """
    Core feed posts referencing dashboard/chart assets.
    Table: feed_posts
    """
    __tablename__ = "feed_posts"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"), index=True)

    asset_type = Column(
        Enum("dashboard", "chart", "insight", name="asset_type_enum"),
        nullable=False,
    )
    asset_id = Column(UUID(as_uuid=True), nullable=False)

    organization_id = Column(UUID(as_uuid=True), *_org_fk(), nullable=True)
    project_id = Column(UUID(as_uuid=True), *_project_fk(), nullable=True)
    author_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)

    visibility = Column(
        Enum("private", "project", "organization", "public", name="feed_visibility_enum"),
        nullable=False,
        server_default=text("'private'"),
    )
    status = Column(
        Enum("draft", "pending", "approved", "rejected", name="publish_status_enum"),
        nullable=False,
        server_default=text("'draft'"),
    )

    title = Column(String(255), nullable=True)
    description = Column(Text, nullable=True)
    tags = Column(ARRAY(Text()), nullable=False, server_default=text("'{}'"))

    approved_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    approved_at = Column(DateTime(timezone=True), nullable=True)
    rejected_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    rejected_at = Column(DateTime(timezone=True), nullable=True)
    rejection_reason = Column(Text, nullable=True)

    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())
    published_at = Column(DateTime(timezone=True), nullable=True)
    last_activity_at = Column(DateTime(timezone=True), nullable=True)

    featured = Column(Boolean, nullable=False, server_default=text("false"))
    featured_until = Column(DateTime(timezone=True), nullable=True)
    public_access_level = Column(
        Enum("results_only", "full_access", name="publication_access_level_enum"),
        nullable=False,
        server_default=text("'results_only'"),
    )
    requires_login = Column(Boolean, nullable=False, server_default=text("true"))

    comment_count = Column(Integer, nullable=False, server_default=text("0"))
    reaction_count = Column(Integer, nullable=False, server_default=text("0"))
    save_count = Column(Integer, nullable=False, server_default=text("0"))
    view_count = Column(Integer, nullable=False, server_default=text("0"))
    share_count = Column(Integer, nullable=False, server_default=text("0"))

    __table_args__ = (
        UniqueConstraint("asset_type", "asset_id", name="uq_feed_posts_asset"),
        Index("idx_feed_posts_org_visibility", "organization_id", "visibility"),
        Index("idx_feed_posts_project_visibility", "project_id", "visibility"),
    )


class FeedComment(Base):
    """
    Comments on feed posts (threaded via parent_id).
    Table: feed_comments
    """
    __tablename__ = "feed_comments"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"), index=True)
    post_id = Column(UUID(as_uuid=True), ForeignKey("feed_posts.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    parent_id = Column(UUID(as_uuid=True), ForeignKey("feed_comments.id"), nullable=True)
    content = Column(Text, nullable=False)
    mentions = Column(ARRAY(UUID(as_uuid=True)), nullable=True)
    is_deleted = Column(Boolean, nullable=False, server_default=text("false"))
    deleted_at = Column(DateTime(timezone=True), nullable=True)
    deleted_by = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    moderation_status = Column(String(32), nullable=False, server_default=text("'active'"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    edited_at = Column(DateTime(timezone=True), nullable=True)


class FeedCommentReaction(Base):
    """
    Reactions on individual comments.
    Table: feed_comment_reactions
    """
    __tablename__ = "feed_comment_reactions"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"), index=True)
    comment_id = Column(UUID(as_uuid=True), ForeignKey("feed_comments.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    reaction = Column(
        Enum("like", "love", "insightful", "applause", "funny", "celebrate", name="comment_reaction_type_enum"),
        nullable=False,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("comment_id", "user_id", name="uq_feed_comment_reaction_user"),
        Index("idx_feed_comment_reactions_comment", "comment_id"),
    )


class FeedInteraction(Base):
    """
    Likes/reactions/saves on feed posts.
    Table: feed_interactions
    """
    __tablename__ = "feed_interactions"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"), index=True)
    post_id = Column(UUID(as_uuid=True), ForeignKey("feed_posts.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    type = Column(
        Enum("like", "love", "insightful", "applause", "funny", "celebrate", "save", name="interaction_type_enum"),
        nullable=False,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("post_id", "user_id", "type", name="uq_feed_interactions_user_type"),
    )


class FeedAuthorFollow(Base):
    """
    Follow relationships between feed users.
    Table: feed_author_follows
    """
    __tablename__ = "feed_author_follows"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"), index=True)
    follower_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    following_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("follower_id", "following_id", name="uq_feed_author_follow"),
        Index("idx_feed_author_follows_follower", "follower_id"),
        Index("idx_feed_author_follows_following", "following_id"),
    )


class FeedEvent(Base):
    """
    Feed event stream (publish/comment/reaction/approval).
    Table: feed_events
    """
    __tablename__ = "feed_events"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"), index=True)
    organization_id = Column(UUID(as_uuid=True), *_org_fk(), nullable=True)
    project_id = Column(UUID(as_uuid=True), *_project_fk(), nullable=True)
    post_id = Column(UUID(as_uuid=True), ForeignKey("feed_posts.id"), nullable=False)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    target_user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    type = Column(
        Enum(
            "publish",
            "comment",
            "reaction",
            "approval",
            "share",
            "save",
            "mention",
            "created",
            "updated",
            "approved",
            "rejected",
            "approval_requested",
            name="event_type_enum",
        ),
        nullable=False,
    )
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    is_read = Column(Boolean, nullable=False, server_default=text("false"))
    event_metadata = Column("metadata", JSONB, nullable=True)


class FeedView(Base):
    """
    View tracking for feed posts.
    Table: feed_views
    """
    __tablename__ = "feed_views"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"), index=True)
    post_id = Column(UUID(as_uuid=True), ForeignKey("feed_posts.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    viewed_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    session_id = Column(String(255), nullable=True)
    duration_seconds = Column(Integer, nullable=True)
    ip_address = Column(String(64), nullable=True)
    user_agent = Column(Text, nullable=True)
    referrer = Column(Text, nullable=True)


class FeedCollection(Base):
    """
    Collections for saved feed posts.
    Table: feed_collections
    """
    __tablename__ = "feed_collections"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"), index=True)
    owner_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    organization_id = Column(UUID(as_uuid=True), *_org_fk(), nullable=True)
    project_id = Column(UUID(as_uuid=True), *_project_fk(), nullable=True)
    name = Column(String(255), nullable=False)
    description = Column(Text, nullable=True)
    is_public = Column(Boolean, nullable=False, server_default=text("false"))
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
    updated_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now(), onupdate=func.now())


class FeedCollectionItem(Base):
    """
    Collection items for feed posts.
    Table: feed_collection_items
    """
    __tablename__ = "feed_collection_items"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"), index=True)
    collection_id = Column(UUID(as_uuid=True), ForeignKey("feed_collections.id", ondelete="CASCADE"), nullable=False)
    post_id = Column(UUID(as_uuid=True), ForeignKey("feed_posts.id", ondelete="CASCADE"), nullable=False)
    note = Column(Text, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())

    __table_args__ = (
        UniqueConstraint("collection_id", "post_id", name="uq_feed_collection_item"),
    )


class FeedNotification(Base):
    """
    Notifications for feed activity (mentions/comments/reactions/shares/approvals).
    Table: feed_notifications
    """
    __tablename__ = "feed_notifications"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"), index=True)
    recipient_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=False)
    actor_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    post_id = Column(UUID(as_uuid=True), ForeignKey("feed_posts.id"), nullable=True)
    comment_id = Column(UUID(as_uuid=True), ForeignKey("feed_comments.id"), nullable=True)
    type = Column(
        Enum("mention", "comment", "reaction", "share", "approval", name="notification_type_enum"),
        nullable=False,
    )
    notification_metadata = Column("metadata", JSONB, nullable=True)
    is_read = Column(Boolean, nullable=False, server_default=text("false"))
    read_at = Column(DateTime(timezone=True), nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())


class FeedShare(Base):
    """
    Share log for feed posts.
    Table: feed_shares
    """
    __tablename__ = "feed_shares"

    id = Column(UUID(as_uuid=True), primary_key=True, server_default=text("gen_random_uuid()"), index=True)
    post_id = Column(UUID(as_uuid=True), ForeignKey("feed_posts.id"), nullable=False)
    user_id = Column(UUID(as_uuid=True), ForeignKey("users.id"), nullable=True)
    channel = Column(String(64), nullable=True)
    share_metadata = Column("metadata", JSONB, nullable=True)
    created_at = Column(DateTime(timezone=True), nullable=False, server_default=func.now())
