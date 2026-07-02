"""
PostgreSQL-based object storage service
Stores file binary data in PostgreSQL using BYTEA type
"""

import logging
import uuid
from typing import Optional
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.db.session import async_session
from src.modules.data.models import FileStorage

logger = logging.getLogger(__name__)


class PostgresStorageService:
    """PostgreSQL-based object storage service"""

    def generate_object_key(self, project_id: Optional[str], filename: str) -> str:
        """Generate object key: user_files/<project_id_or_ce>/<uuid>"""
        file_uuid = str(uuid.uuid4())
        namespace = project_id or "ce"
        return f"user_files/{namespace}/{file_uuid}"

    async def store_file(
        self,
        file_content: bytes,
        project_id: Optional[str],
        original_filename: str,
        content_type: str,
    ) -> str:
        """Store file in PostgreSQL and return object_key"""
        object_key = self.generate_object_key(project_id, original_filename)

        # Convert project_id to UUID (nullable on CE)
        from uuid import UUID
        project_id_uuid = None
        if project_id:
            if isinstance(project_id, str):
                try:
                    project_id_uuid = UUID(project_id)
                except ValueError:
                    logger.warning(f"Invalid project_id format: {project_id}, storing without project")
            else:
                project_id_uuid = project_id

        async with async_session() as session:
            try:
                existing = await session.execute(
                    select(FileStorage).where(FileStorage.object_key == object_key)
                )
                if existing.scalar_one_or_none():
                    object_key = self.generate_object_key(project_id, original_filename)

                file_storage = FileStorage(
                    object_key=object_key,
                    file_data=file_content,
                    file_size=len(file_content),
                    content_type=content_type,
                    original_filename=original_filename,
                    project_id=project_id_uuid,
                    is_active=True,
                )

                session.add(file_storage)
                await session.commit()
                await session.refresh(file_storage)

                logger.info(f"✅ Stored file in PostgreSQL: {object_key} ({len(file_content)} bytes)")
                return object_key

            except Exception as e:
                await session.rollback()
                logger.error(f"❌ Failed to store file in PostgreSQL: {str(e)}")
                raise

    async def get_file(self, object_key: str, project_id: Optional[str]) -> bytes:
        """Retrieve file from PostgreSQL. On CE (no project), look up by object_key only."""
        from uuid import UUID
        project_id_uuid = None
        if object_key.startswith("user_files/ce/"):
            project_id = None
        if project_id:
            if isinstance(project_id, str):
                try:
                    project_id_uuid = UUID(project_id)
                except ValueError:
                    logger.warning(f"Invalid project_id format: {project_id}, querying by object_key only")
            else:
                project_id_uuid = project_id

        async with async_session() as session:
            try:
                if project_id_uuid is not None:
                    stmt = select(FileStorage).where(
                        FileStorage.object_key == object_key,
                        FileStorage.project_id == project_id_uuid,
                        FileStorage.is_active == True,
                    )
                else:
                    stmt = select(FileStorage).where(
                        FileStorage.object_key == object_key,
                        FileStorage.is_active == True,
                    )

                result = await session.execute(stmt)
                file_storage = result.scalar_one_or_none()

                if not file_storage:
                    raise ValueError(f"File not found or access denied: {object_key}")

                logger.info(f"✅ Retrieved file from PostgreSQL: {object_key}")
                return file_storage.file_data

            except Exception as e:
                logger.error(f"❌ Failed to retrieve file from PostgreSQL: {str(e)}")
                raise

    async def delete_file(self, object_key: str, project_id: Optional[str]) -> bool:
        """Soft delete file (set is_active=False)"""
        from uuid import UUID
        project_id_uuid = None
        if object_key.startswith("user_files/ce/"):
            project_id = None
        if project_id:
            if isinstance(project_id, str):
                try:
                    project_id_uuid = UUID(project_id)
                except ValueError:
                    logger.warning(f"Invalid project_id format: {project_id}, matching by object_key only")
            else:
                project_id_uuid = project_id

        async with async_session() as session:
            try:
                if project_id_uuid is not None:
                    stmt = select(FileStorage).where(
                        FileStorage.object_key == object_key,
                        FileStorage.project_id == project_id_uuid,
                    )
                else:
                    stmt = select(FileStorage).where(FileStorage.object_key == object_key)

                result = await session.execute(stmt)
                file_storage = result.scalar_one_or_none()

                if not file_storage:
                    logger.warning(f"⚠️ File not found for deletion: {object_key}")
                    return False

                await session.execute(
                    update(FileStorage)
                    .where(FileStorage.object_key == object_key)
                    .values(is_active=False)
                )
                await session.commit()

                logger.info(f"✅ Soft deleted file: {object_key}")
                return True

            except Exception as e:
                await session.rollback()
                logger.error(f"❌ Failed to delete file: {str(e)}")
                raise
