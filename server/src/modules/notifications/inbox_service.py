"""
Assemble the header Activity inbox for AISER:

- **Team**: pending org invitations
- **Alert**: alert rule firings (threshold / SQL monitors)
- **AI**: failed or low-quality LLM steps for this user (llm_audit_log)
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

    items: list[NotificationItem] = []
    seen_request: set[str] = set()
    for r in rows:
        rid = str(r.get("request_id") or "").strip()
        if rid and rid in seen_request:
            continue
        if rid:
            seen_request.add(rid)
        if len(items) >= AI_AUDIT_LIMIT:
            break

        node = (r.get("node_name") or "").strip() or "analysis"
        model = (r.get("model") or "").strip()
        err = _truncate(r.get("error_message") or r.get("error_code") or "", 200)
        if not err:
            if r.get("success") is False or str(r.get("outcome") or "").lower() == "error":
                err = "AI step failed — retry with a simpler question or check your data source."
            else:
                err = "No usable chart or insight from this step — adjust context or try again."

        title = f"AI Engine · {node}"
        if model:
            title = f"{title} ({model})"

        success = r.get("success")
        outcome = str(r.get("outcome") or "").lower()
        severity = "critical" if success is False or outcome == "error" else "warning"

        items.append(
            NotificationItem(
                id=f"ai-{r.get('id')}",
                kind="ai",
                title=title,
                message=err,
                severity=severity,
                created_at=_iso(r.get("created_at")),
                href="/chat",
                actions=[
                    NotificationAction(label="Retry in chat", href="/chat"),
                    NotificationAction(label="Check data", href="/data"),
                ],
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
) -> list[NotificationItem]:
    """
    Assemble inbox rows. Only `push_notifications` is user-controlled (Settings + General tab);
    when off, the feed is empty. When on, all categories (team, monitors, AI, tips) are included.
    """
    if not prefs.get("push_notifications", True):
        return []

    chunks: list[NotificationItem] = []
    chunks.extend(await invitation_notifications(db, email))
    if org_id:
        chunks.extend(await engagement_notifications(db, org_id, user_id, dismissed_tips))
        chunks.extend(await data_alert_notifications(db, org_id))
        chunks.extend(await ai_pipeline_notifications(db, org_id, user_id))

    chunks.sort(
        key=lambda it: (notification_priority(it), -ts_sort_value(it.created_at)),
    )
    return chunks[:MAX_INBOX_ITEMS]
