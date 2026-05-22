"""
Data Retention Service
Plan-based cleanup for file data sources per organization.
"""

import logging
from datetime import datetime, timedelta
from typing import Optional

import sqlalchemy as sa
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.data.services.upload_datasource_storage_service import UploadDatasourceStorageService
from src.modules.pricing.plans import get_plan_limits

logger = logging.getLogger(__name__)


class DataRetentionService:
    """Clean up file-based data sources according to plan data_history_days."""

    def __init__(self, db: AsyncSession):
        self.db = db
        self.storage = UploadDatasourceStorageService()

    async def cleanup_expired_file_sources(self, organization_id: Optional[int] = None) -> int:
        """
        Delete/deactivate file data sources older than plan-based retention.

        Returns number of data sources affected.
        """
        try:
            # Get organizations (all or single)
            if organization_id is not None:
                org_query = sa.text(
                    "SELECT id, plan_type FROM organizations WHERE id = :org_id"
                )
                org_result = await self.db.execute(org_query, {"org_id": organization_id})
            else:
                org_query = sa.text("SELECT id, plan_type FROM organizations")
                org_result = await self.db.execute(org_query)

            org_rows = org_result.fetchall() or []
            total_affected = 0

            for org in org_rows:
                org_id = int(org.id)
                plan_type = org.plan_type or "free"
                limits = get_plan_limits(plan_type)
                days = limits.get("data_history_days")

                # Skip if unlimited or not configured
                if not days or days <= 0:
                    continue

                cutoff = datetime.utcnow() - timedelta(days=days)

                # Find expired file data sources for this organization.
                ds_query = sa.text(
                    """
                    SELECT id, file_path, project_id
                    FROM data_sources
                    WHERE type = 'file'
                      AND is_active = TRUE
                      AND created_at < :cutoff
                    """
                )
                ds_result = await self.db.execute(
                    ds_query,
                    {"cutoff": cutoff},
                )
                ds_rows = ds_result.fetchall() or []

                if not ds_rows:
                    continue

                logger.info(
                    f"🧹 Data retention: org={org_id}, plan={plan_type}, "
                    f"days={days}, expired_sources={len(ds_rows)}"
                )

                # Delete physical files (best-effort) and soft-delete data_sources
                for ds in ds_rows:
                    file_path = ds.file_path  # This is the object_key
                    ds_id = ds.id
                    project_id = str(ds.project_id) if ds.project_id else None

                    if file_path:
                        if not project_id:
                            logger.warning(
                                f"⚠️ Cannot delete file for data_source {ds_id}: project_id is missing"
                            )
                        else:
                            try:
                                await self.storage.delete_file(file_path, project_id)
                            except Exception as e:
                                logger.warning(
                                    f"⚠️ Failed to delete file for data_source {ds_id}: {e}"
                                )

                    # Soft-delete: mark inactive so it won't appear in UI/queries
                    update_q = sa.text(
                        """
                        UPDATE data_sources
                        SET is_active = FALSE,
                            updated_at = NOW()
                        WHERE id = :id
                        """
                    )
                    await self.db.execute(update_q, {"id": ds_id})
                    total_affected += 1

            await self.db.commit()
            logger.info(f"✅ Data retention cleanup completed. Total sources affected: {total_affected}")
            return total_affected

        except Exception as e:
            logger.error(f"❌ Data retention cleanup failed: {e}", exc_info=True)
            try:
                await self.db.rollback()
            except Exception:
                pass
            return 0





