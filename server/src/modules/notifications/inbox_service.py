"""
Assemble the header Activity inbox for AISER:

- **Team**: pending org invitations
- **Alert**: alert rule firings (threshold / SQL monitors)
- **AI**: failed or low-quality LLM steps for this user (llm_audit_log)
- **Feed**: mentions/comments/reactions/shares/follows/approvals on the user's Feed
  activity (feed_notifications table) — previously tracked only by the Feed page's
  own bell icon, invisible from the header inbox everything else surfaces through.
- **Activity** (adoption): contextual setup nudges from real usage (data sources, chat, monitors,
  dashboards) — dismiss keys stored in user_settings alongside other preferences.
"""

from __future__ import annotations

import logging
from datetime import datetime
from typing import Any, Optional

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.alerts.alert_rules_service import AlertRulesService
from src.modules.invitations.service import InvitationService
from src.modules.notifications.inbox_state import notification_priority, ts_sort_value
from src.modules.notifications.schemas import NotificationAction, NotificationItem

logger = logging.getLogger(__name__)

MAX_INBOX_ITEMS = 32
MAX_ACTIVITY_TIPS = 4
ALERT_EVENT_LIMIT = 10
AI_AUDIT_LIMIT = 8
FEED_NOTIFICATION_LIMIT = 10


def _iso(dt: Any) -> Optional[str]:
    if dt is None:
        return None
    if isinstance(dt, datetime):
        return dt.isoformat()
    return str(dt)


def _truncate(text: Optional[str], n: int = 220) -> str:
    if not text:
        return ""
    t = str(text).strip()
    return t if len(t) <= n else t[: n - 1] + "…"


def _classify_ai_error(error_code: Optional[str], error_message: Optional[str]) -> str:
    """Maps a raw LLM/provider failure to a short, actionable message with zero
    technical detail — no exception class names, internal hostnames, raw HTML
    error pages, or Python object reprs. The activity inbox is user-facing,
    not a server log; error_message here can be up to 2000 chars of whatever
    the provider's SDK raised (litellm.NotFoundError with an HTML body,
    "Cannot connect to host ollama:11434", etc.) and none of that belongs in
    front of an end user. Classification is allowlist-based against litellm's
    stable exception-name contract and our own known error_code values, so
    anything unrecognized falls back to a generic message instead of ever
    forwarding the raw string — this can't leak a new/unclassified error
    shape the way a truncate-and-display approach would."""
    text = f"{error_code or ''} {error_message or ''}".lower()

    if "circuitbreaker" in text or "circuit breaker" in text:
        return "The AI service is temporarily overloaded — please try again in a few minutes."
    if any(k in text for k in ("authenticationerror", "invalid subscription key", "invalid api key", "unauthorized")):
        return "The AI service's credentials need attention — ask an admin to check the AI provider settings."
    if "notfounderror" in text or ("deployment" in text and "not found" in text):
        return "The AI service isn't fully configured — ask an admin to check the AI provider settings."
    if any(k in text for k in ("apiconnectionerror", "cannot connect", "connection refused", "connection error")):
        return "Couldn't reach the AI service — please try again shortly."
    if error_code == "rate_limit" or "rate limit" in text or " 429" in text:
        return "The AI service is busy right now — please try again in a moment."
    if error_code == "timeout" or "timeout" in text or "timed out" in text:
        return "That request took too long — try a simpler question or a narrower time range."
    return "AI step failed — retry with a simpler question or check your data source."


async def invitation_notifications(db: AsyncSession, email: str) -> list[NotificationItem]:
    if not email or not str(email).strip():
        return []
    try:
        raw = await InvitationService.list_pending_invitations_for_email(db, email)
    except Exception as e:
        logger.warning("inbox invitations failed: %s", e)
        return []
    items: list[NotificationItem] = []
    for row in raw:
        org = row.get("organization_name") or "Organization"
        role = row.get("role_display_name") or "member"
        items.append(
            NotificationItem(
                id=f"invitation-{row['id']}",
                kind="invitation",
                title=f"Team · Invite to {org}",
                message=_truncate(f"You're invited as {role}. Open Team settings to accept."),
                severity="info",
                created_at=_iso(row.get("invited_at")),
                href="/settings?tab=team",
                actions=[
                    NotificationAction(label="Open Team", href="/settings?tab=team"),
                ],
            )
        )
    return items


async def data_alert_notifications(db: AsyncSession, org_id: str) -> list[NotificationItem]:
    if not org_id:
        return []
    try:
        svc = AlertRulesService(db)
        events = await svc.list_events(org_id, limit=ALERT_EVENT_LIMIT)
    except Exception as e:
        logger.debug("inbox alerts skipped: %s", e)
        return []
    items: list[NotificationItem] = []
    for ev in events:
        st = (ev.get("status") or "").lower()
        if st not in ("firing", "acknowledged"):
            continue
        msg = (ev.get("message") or "").strip() or "Threshold or rule condition matched."
        event_id = str(ev.get("id") or "")
        actions: list[NotificationAction] = [
            NotificationAction(label="View events", href="/alerts?tab=events"),
        ]
        if st == "firing" and event_id:
            actions.append(
                NotificationAction(
                    label="Acknowledge",
                    inline="ack_alert",
                    target_id=event_id,
                )
            )
        items.append(
            NotificationItem(
                id=f"alert-{event_id}" if event_id else f"alert-unknown-{len(items)}",
                kind="alert",
                title=f"Monitor · {ev.get('rule_name') or 'Rule'}",
                message=_truncate(msg),
                severity="critical" if st == "firing" else "warning",
                created_at=_iso(ev.get("triggered_at")),
                href="/alerts?tab=events",
                actions=actions,
            )
        )
    return items


async def ai_pipeline_notifications(db: AsyncSession, org_id: str, user_id: str) -> list[NotificationItem]:
    """
    Recent LLM audit rows for this user in this org where the step failed or finished without valid output.
    Scoped to user_id to keep the inbox personal and low-noise.
    One row per request_id (latest failure) to avoid stacking duplicate nodes from the same chat turn.
    """
    if not org_id or not user_id:
        return []
    try:
        result = await db.execute(
            sa.text(
                """
                SELECT id::text AS id, request_id, node_name, model, error_code, error_message,
                       success, outcome, valid_output, is_final, created_at
                FROM llm_audit_log
                WHERE organization_id = :org_id
                  AND user_id = :user_id
                  AND (
                    success IS FALSE
                    OR LOWER(COALESCE(outcome, '')) = 'error'
                    OR (COALESCE(is_final, FALSE) = TRUE AND COALESCE(valid_output, FALSE) = FALSE)
                  )
                ORDER BY created_at DESC
                LIMIT :limit
                """
            ),
            {"org_id": org_id, "user_id": user_id, "limit": AI_AUDIT_LIMIT * 3},
        )
        rows = result.mappings().all()
    except Exception as e:
        logger.debug("inbox llm_audit_log skipped (table or query): %s", e)
        return []

    # Two passes: classify each row first, then collapse adjacent rows that
    # produced the SAME classified message (e.g. the circuit breaker tripping
    # across several chat turns in a row) into one entry with a count —
    # without this, a single recurring provider outage floods the inbox with
    # near-duplicate rows differing only by timestamp, which reads as noise,
    # not signal. Grouping is on the classified message, not raw error_code/
    # error_message, so two different raw errors that both mean "can't reach
    # the AI service" still collapse together.
    classified: list[dict[str, Any]] = []
    seen_request: set[str] = set()
    for r in rows:
        rid = str(r.get("request_id") or "").strip()
        if rid and rid in seen_request:
            continue
        if rid:
            seen_request.add(rid)
        if len(classified) >= AI_AUDIT_LIMIT * 3:
            break

        if r.get("error_message") or r.get("error_code"):
            err = _classify_ai_error(r.get("error_code"), r.get("error_message"))
        elif r.get("success") is False or str(r.get("outcome") or "").lower() == "error":
            err = "AI step failed — retry with a simpler question or check your data source."
        else:
            err = "No usable chart or insight from this step — adjust context or try again."

        success = r.get("success")
        outcome = str(r.get("outcome") or "").lower()
        severity = "critical" if success is False or outcome == "error" else "warning"
        classified.append(
            {"id": r.get("id"), "message": err, "severity": severity, "created_at": r.get("created_at")}
        )

    items: list[NotificationItem] = []
    i = 0
    while i < len(classified) and len(items) < AI_AUDIT_LIMIT:
        group = [classified[i]]
        j = i + 1
        while j < len(classified) and classified[j]["message"] == classified[i]["message"]:
            group.append(classified[j])
            j += 1
        i = j

        latest = group[0]
        count = len(group)
        # Neither node_name (an internal LangGraph node id — "nl2sql",
        # "diagnostic_dimension_selector", "supervisor", ...) nor model (which
        # LLM/provider the org has configured, self-hosted Ollama included)
        # belongs in front of an end user — both are implementation/infra
        # detail, not something a title needs to convey. "AI Engine" alone,
        # consistent with the "Explore · Ask the AI Engine" tip below, is
        # exactly as actionable without exposing either.
        title = "AI Engine" if count == 1 else f"AI Engine · {count} recent failures"

        items.append(
            NotificationItem(
                id=f"ai-{latest['id']}",
                kind="ai",
                title=title,
                message=latest["message"],
                severity=latest["severity"],
                created_at=_iso(latest["created_at"]),
                href="/chat",
                actions=[
                    NotificationAction(label="Retry in chat", href="/chat"),
                    NotificationAction(label="Check data", href="/data"),
                ],
            )
        )
    return items


_CREDIT_WARNING_THRESHOLD = 0.8
_CREDIT_CRITICAL_THRESHOLD = 0.95


async def credit_usage_notifications(db: AsyncSession, org_id: str) -> list[NotificationItem]:
    """Early warning before an org hits its hard AI-credit cap. The existing
    check_ai_credit_limit (ee/modules/pricing/usage_tracker.py) only ever
    blocks AT 100% — a customer currently finds out they're capped by hitting
    a wall mid-workflow, with no advance notice. Computed fresh on every
    inbox load rather than a stored "already warned" flag, so it's always
    accurate and needs no extra state/cleanup."""
    if not org_id:
        return []
    try:
        from datetime import datetime, timezone
        from sqlalchemy import select, and_
        from ee.modules.pricing.usage_tracker import _get_effective_plan_limits
        from src.modules.billing.models import OrganizationUsage

        _plan_slug, limits = await _get_effective_plan_limits(org_id, db)
        credit_limit = limits.get("ai_credits_limit", 0)
        if not credit_limit or credit_limit == -1:
            return []  # unlimited plan — nothing to warn about

        period_start = datetime.now(timezone.utc).replace(day=1, hour=0, minute=0, second=0, microsecond=0)
        stmt = select(OrganizationUsage).where(
            and_(
                OrganizationUsage.organization_id == org_id,
                OrganizationUsage.metric == "ai_credits",
                OrganizationUsage.period_start == period_start,
            )
        )
        result = await db.execute(stmt)
        usage = result.scalar_one_or_none()
        current_used = usage.used if usage else 0
        if credit_limit <= 0:
            return []
        ratio = current_used / credit_limit
        if ratio < _CREDIT_WARNING_THRESHOLD:
            return []

        pct = int(ratio * 100)
        severity = "critical" if ratio >= _CREDIT_CRITICAL_THRESHOLD else "warning"
        title = "AI Credits · Nearly exhausted" if severity == "critical" else "AI Credits · Approaching limit"
        message = (
            f"Your organization has used {current_used} of {credit_limit} AI credits this month ({pct}%). "
            + ("AI requests will be blocked once the limit is reached." if severity == "critical"
               else "Consider upgrading before you hit the limit.")
        )
        return [
            NotificationItem(
                id=f"credit-usage-{org_id}-{period_start.date().isoformat()}",
                kind="alert",
                title=title,
                message=message,
                severity=severity,
                created_at=None,
                href="/settings?tab=billing-subscription",
                actions=[NotificationAction(label="View plan", href="/settings?tab=billing-subscription")],
            )
        ]
    except Exception as e:
        logger.debug("inbox credit-usage warning skipped: %s", e)
        return []


_FEED_NOTIFICATION_COPY = {
    "mention": lambda actor: f"{actor} mentioned you in a post",
    "comment": lambda actor: f"{actor} commented on your post",
    "reaction": lambda actor: f"{actor} reacted to your post",
    "share": lambda actor: f"{actor} shared your post",
    "follow": lambda actor: f"{actor} started following you",
    "publish": lambda actor: "Your post was published",
}


def _feed_approval_copy(actor: str, metadata: Optional[dict]) -> tuple[str, str]:
    """Approval is the one feed-notification type whose meaning depends on
    metadata.status (pending/approved/rejected), not just its type string —
    see service_actions.py's three _create_notification(type="approval", ...)
    call sites (submit-for-review, approve, reject)."""
    status = str((metadata or {}).get("status") or "").lower()
    if status == "approved":
        return "Feed · Approved", "Your post was approved and published."
    if status == "rejected":
        reason = (metadata or {}).get("reason")
        return "Feed · Changes requested", f"Your post needs changes: {reason}" if reason else "Your post was not approved."
    return "Feed · Approval needed", f"{actor} submitted a post for your approval"


async def feed_notifications(db: AsyncSession, user_payload: Optional[dict]) -> list[NotificationItem]:
    """Mentions/comments/reactions/shares/follows/approvals on the user's Feed
    activity — surfaces the same feed_notifications rows the Feed page's own
    bell already shows, so collaboration doesn't require a separate place to
    check for it."""
    if not user_payload:
        return []
    try:
        from src.modules.feed.service import FeedService

        result = await FeedService(db).get_notifications(
            user_payload=user_payload, limit=FEED_NOTIFICATION_LIMIT, offset=0, unread_only=True
        )
    except Exception as e:
        logger.debug("inbox feed notifications skipped: %s", e)
        return []

    items: list[NotificationItem] = []
    for n in result.items:
        actor_name = (n.actor.name if n.actor else None) or "Someone"
        href = f"/feed/{n.postId}" if n.postId else "/feed"
        if n.type == "approval":
            title, message = _feed_approval_copy(actor_name, n.metadata)
        else:
            copy_fn = _FEED_NOTIFICATION_COPY.get(n.type)
            title = f"Feed · {n.type.capitalize()}"
            message = copy_fn(actor_name) if copy_fn else f"{actor_name} interacted with your post"
        items.append(
            NotificationItem(
                id=f"feed-{n.id}",
                kind="feed",
                title=title,
                message=_truncate(message),
                severity="info",
                created_at=n.createdAt,
                href=href,
                actions=[NotificationAction(label="Open in Feed", href=href)],
            )
        )
    return items


async def _scalar_count(db: AsyncSession, sql: str, params: dict) -> int:
    try:
        r = await db.execute(sa.text(sql), params)
        row = r.fetchone()
        if row is None:
            return 0
        v = row[0]
        return int(v) if v is not None else 0
    except Exception as e:
        logger.debug("inbox count query skipped: %s", e)
        return 0


async def engagement_notifications(
    db: AsyncSession,
    org_id: str,
    user_id: str,
    dismissed: set[str],
) -> list[NotificationItem]:
    """
    Contextual adoption items (no mock data): nudges when org/user metrics suggest a next best step.
    Dismiss keys persist in user_settings (activity_inbox_dismissed_tips).
    """
    oid, uid = str(org_id), str(user_id)
    items: list[NotificationItem] = []

    n_ds = await _scalar_count(
        db,
        """
        SELECT COUNT(*)::int FROM data_sources ds
        INNER JOIN projects p ON p.id = ds.project_id
        WHERE CAST(p.organization_id AS text) = :org_id
          AND COALESCE(ds.is_active, true) = true
        """,
        {"org_id": oid},
    )

    if "connect_data" not in dismissed and n_ds == 0:
        items.append(
            NotificationItem(
                id="activity-connect_data",
                kind="activity",
                title="Get started · Connect your data",
                message=(
                    "Add a database, warehouse, or file—so AICSER can run "
                    "NL analytics and charts on your real metrics."
                ),
                severity="info",
                created_at=None,
                href="/data?openDataSource=1",
                dismiss_key="connect_data",
                actions=[NotificationAction(label="Add data source", href="/data?openDataSource=1")],
            )
        )

    n_conv = await _scalar_count(
        db,
        """
        SELECT COUNT(*)::int FROM conversation c
        WHERE CAST(c.user_id AS text) = :user_id
          AND COALESCE(c.is_deleted, false) = false
        """,
        {"user_id": uid},
    )

    if "try_chat" not in dismissed and n_ds > 0 and n_conv == 0:
        items.append(
            NotificationItem(
                id="activity-try_chat",
                kind="activity",
                title="Explore · Ask the AI Engine",
                message=(
                    "Try a question in natural language—similar to Copilot for data—to get charts, "
                    "SQL, and explanations grounded in your connected sources."
                ),
                severity="info",
                created_at=None,
                href="/chat",
                dismiss_key="try_chat",
                actions=[NotificationAction(label="Open AI Engine", href="/chat")],
            )
        )

    n_rules = await _scalar_count(
        db,
        "SELECT COUNT(*)::int FROM alert_rules WHERE org_id = :org_id",
        {"org_id": oid},
    )

    if "data_monitors" not in dismissed and n_ds > 0 and n_rules == 0:
        items.append(
            NotificationItem(
                id="activity-data_monitors",
                kind="activity",
                title="Monitor · Watch key metrics",
                message=(
                    "Create a data monitor to be notified when a metric crosses a threshold—comparable "
                    "to data alerts in Power BI or subscriptions in Tableau."
                ),
                severity="info",
                created_at=None,
                href="/alerts",
                dismiss_key="data_monitors",
                actions=[NotificationAction(label="Set up monitors", href="/alerts")],
            )
        )

    n_dash = await _scalar_count(
        db,
        """
        SELECT COUNT(*)::int FROM dashboards d
        INNER JOIN projects p ON p.id = d.project_id
        WHERE CAST(p.organization_id AS text) = :org_id
        """,
        {"org_id": oid},
    )

    if "publish_dashboard" not in dismissed and n_ds > 0 and n_dash == 0:
        items.append(
            NotificationItem(
                id="activity-publish_dashboard",
                kind="activity",
                title="Share · Publish a dashboard",
                message=(
                    "Save insights to Dashboard Studio so teammates can explore live views—like "
                    "publishing a workbook for your org."
                ),
                severity="info",
                created_at=None,
                href="/dashboards",
                dismiss_key="publish_dashboard",
                actions=[NotificationAction(label="Open dashboards", href="/dashboards")],
            )
        )

    return items[:MAX_ACTIVITY_TIPS]


async def build_inbox(
    db: AsyncSession,
    *,
    org_id: Optional[str],
    user_id: str,
    email: str,
    dismissed_tips: set[str],
    prefs: dict[str, bool],
    user_payload: Optional[dict] = None,
) -> list[NotificationItem]:
    """
    Assemble inbox rows. Only `push_notifications` is user-controlled (Settings + General tab);
    when off, the feed is empty. When on, all categories (team, monitors, AI, feed, tips) are included.
    """
    if not prefs.get("push_notifications", True):
        return []

    chunks: list[NotificationItem] = []
    chunks.extend(await invitation_notifications(db, email))
    chunks.extend(await feed_notifications(db, user_payload))
    if org_id:
        chunks.extend(await engagement_notifications(db, org_id, user_id, dismissed_tips))
        chunks.extend(await data_alert_notifications(db, org_id))
        chunks.extend(await ai_pipeline_notifications(db, org_id, user_id))
        chunks.extend(await credit_usage_notifications(db, org_id))

    # Only engagement (adoption tip) items carried a dismiss_key - alerts,
    # invitations, AI, and feed rows had no way to be dismissed at all, only
    # an implicit "read" once activity_inbox_last_viewed_at moved past their
    # created_at. Every item already has a stable, unique `id` (see each
    # builder above), so it doubles as a dismiss key for free - this makes
    # "Dismiss" available on every row, backed by the same
    # activity_inbox_dismissed_tips store already used for tips, without a
    # new table. Dismissing an alert only hides it from this list; it does
    # NOT acknowledge the underlying alert rule (see the separate
    # "Acknowledge" inline action) - same as archiving an email doesn't
    # resolve what it was about.
    for c in chunks:
        if not c.dismiss_key:
            c.dismiss_key = c.id
    chunks = [c for c in chunks if c.dismiss_key not in dismissed_tips]

    chunks.sort(
        key=lambda it: (notification_priority(it), -ts_sort_value(it.created_at)),
    )
    return chunks[:MAX_INBOX_ITEMS]
