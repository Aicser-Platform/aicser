"""Helpers for immutable feed publication snapshots."""
from __future__ import annotations

import hashlib
import json
from typing import Any, Dict, Optional
from uuid import UUID

from fastapi import HTTPException, status
from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.feed.models import FeedPost, FeedSnapshot
from src.modules.feed.service_utils import _utcnow

MAX_SNAPSHOT_BYTES = 4 * 1024 * 1024  # 4 MB


def _payload_byte_size(payload: Dict[str, Any]) -> int:
    return len(json.dumps(payload, default=str).encode("utf-8"))


def _payload_hash(payload: Dict[str, Any]) -> str:
    raw = json.dumps(payload, sort_keys=True, default=str).encode("utf-8")
    return hashlib.sha256(raw).hexdigest()


def normalize_snapshot_payload(raw: Optional[Dict[str, Any]]) -> Dict[str, Any]:
    if not raw or not isinstance(raw, dict):
        return {}
    return raw


def validate_snapshot_payload(payload: Dict[str, Any]) -> None:
    if not payload:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="snapshot_payload is required for snapshot publications",
        )
    size = _payload_byte_size(payload)
    if size > MAX_SNAPSHOT_BYTES:
        raise HTTPException(
            status_code=status.HTTP_413_REQUEST_ENTITY_TOO_LARGE,
            detail=f"Snapshot payload exceeds {MAX_SNAPSHOT_BYTES // (1024 * 1024)}MB limit",
        )


def build_snapshot_payload_from_preview(
    asset_type: str,
    preview_metadata: Dict[str, Any],
    *,
    title: str,
    description: Optional[str] = None,
) -> Optional[Dict[str, Any]]:
    """Best-effort snapshot from legacy preview_metadata (insights/charts)."""
    chart_widget = preview_metadata.get("chartWidget")
    if chart_widget and isinstance(chart_widget, dict):
        return {
            "schemaVersion": 1,
            "assetType": asset_type,
            "narrative": {
                "title": title,
                "description": description or preview_metadata.get("summary") or "",
                "questionTitle": preview_metadata.get("questionTitle"),
                "answerExcerpt": preview_metadata.get("excerpt"),
            },
            "visuals": {
                "widgets": [
                    {
                        "id": "snapshot-primary",
                        "chartType": chart_widget.get("chartType"),
                        "chartOptions": chart_widget.get("chartOptions"),
                        "chartData": chart_widget.get("chartData"),
                        "chartQuery": chart_widget.get("chartQuery"),
                        "title": title,
                    }
                ],
                "layout": [{"i": "snapshot-primary", "x": 0, "y": 0, "w": 12, "h": 8}],
            },
            "provenance": {
                "sourcePath": preview_metadata.get("sourcePath") or "/feed",
                "conversationId": preview_metadata.get("conversationId"),
                "messageId": preview_metadata.get("messageId"),
                "dashboardId": preview_metadata.get("dashboardId"),
            },
        }

    layout_summary = preview_metadata.get("layoutSummary")
    if asset_type == "dashboard" and layout_summary:
        return {
            "schemaVersion": 1,
            "assetType": "dashboard",
            "narrative": {
                "title": title,
                "description": description or preview_metadata.get("excerpt") or "",
            },
            "visuals": {
                "widgets": preview_metadata.get("widgets") or [],
                "layout": layout_summary,
                "pages": preview_metadata.get("pages"),
                "filters": preview_metadata.get("filters"),
            },
            "provenance": {
                "sourcePath": "/dashboards",
                "dashboardId": preview_metadata.get("dashboardId"),
            },
        }
    return None


async def create_feed_snapshot(
    db: AsyncSession,
    *,
    post: FeedPost,
    payload: Dict[str, Any],
    created_by: UUID,
    thumbnail_url: Optional[str] = None,
) -> FeedSnapshot:
    validate_snapshot_payload(payload)
    next_version = await db.scalar(
        select(func.coalesce(func.max(FeedSnapshot.version), 0)).where(
            FeedSnapshot.post_id == post.id
        )
    )
    version = int(next_version or 0) + 1
    captured_at = _utcnow()
    payload = {**payload, "capturedAt": captured_at.isoformat()}
    snapshot = FeedSnapshot(
        post_id=post.id,
        version=version,
        payload=payload,
        payload_hash=_payload_hash(payload),
        byte_size=_payload_byte_size(payload),
        filter_state=(payload.get("visuals") or {}).get("filters"),
        captured_at=captured_at,
        created_by=created_by,
        thumbnail_url=thumbnail_url,
    )
    db.add(snapshot)
    await db.flush()
    post.render_mode = "snapshot"
    post.current_snapshot_id = snapshot.id
    post.snapshot_version = version
    return snapshot
