import logging
from typing import Any, Dict, Generic, List, Optional, Type, TypeVar
from sqlalchemy import select, func, desc, asc
from sqlalchemy.orm import Query
from pydantic import BaseModel

from src.db.session import get_db

logger = logging.getLogger(__name__)

ModelType = TypeVar("ModelType")
CreateSchemaType = TypeVar("CreateSchemaType", bound=BaseModel)
UpdateSchemaType = TypeVar("UpdateSchemaType", bound=BaseModel)


class BaseRepository(Generic[ModelType, CreateSchemaType, UpdateSchemaType]):
    """
    Base repository for database operations with SQLAlchemy models.
    Provides CRUD operations with pagination, sorting and filtering.

    Args:
        ModelType: SQLAlchemy model
        CreateSchemaType: Pydantic create schema
        UpdateSchemaType: Pydantic update schema

    Example:
        class UserRepo(BaseRepository[User, UserCreate, UserUpdate]):
            pass
        user_repo = UserRepo(User)
        users = await user_repo.get_all(limit=10)
    """

    def __init__(self, model: Type[ModelType]):
        self.model = model
        self.db = get_db()

    def _build_base_query(self) -> Query:
        """Build base query for the model"""
        return select(self.model)

    def _apply_exact_filters(
        self, query: Query, filter_query: Optional[Dict[str, Any]]
    ) -> Query:
        """Apply exact match filters to query"""
        if not filter_query:
            return query

        for field, value in filter_query.items():
            if hasattr(self.model, field) and value is not None:
                if isinstance(value, list):
                    query = query.where(getattr(self.model, field).in_(value))
                else:
                    query = query.where(getattr(self.model, field) == value)

        return query

    def _apply_search_filters(self, query: Query, search_query: Optional[str]) -> Query:
        """Apply search filters to query"""
        if not search_query:
            return query

        # Simple search across string fields
        from sqlalchemy import or_
        search_conditions = []
        for column in self.model.__table__.columns:
            try:
                if column.type.python_type == str:
                    search_conditions.append(column.ilike(f"%{search_query}%"))
            except Exception:
                continue

        if search_conditions:
            from sqlalchemy import or_
            query = query.where(or_(*search_conditions))

        return query

    def _apply_sorting(
        self, query: Query, sort_by: Optional[str], sort_order: Optional[str]
    ) -> Query:
        """Apply sorting to query"""
        if not sort_by or not hasattr(self.model, sort_by):
            return query

        if sort_order == "desc":
            query = query.order_by(desc(getattr(self.model, sort_by)))
        else:
            query = query.order_by(asc(getattr(self.model, sort_by)))

        return query

    def _apply_pagination(
        self, query: Query, offset: Optional[int], limit: Optional[int]
    ) -> Query:
        """Apply pagination to query"""
        if offset is not None:
            query = query.offset(offset)
        if limit is not None:
            query = query.limit(limit)

        return query

    async def get(self, id: Any, db: Optional[Any] = None) -> Optional[ModelType]:
        """Get a single record by ID.

        Accepts an optional AsyncSession `db` when caller manages sessions externally.
        Supports both int and UUID types for ID.
        """
        try:
            # Handle UUID conversion if needed
            import uuid
            if isinstance(id, str):
                try:
                    id = uuid.UUID(id)
                except ValueError:
                    # If it's not a valid UUID, try as int
                    try:
                        id = int(id)
                    except ValueError:
                        pass  # Let SQLAlchemy handle the error
            
            query = self._build_base_query().where(self.model.id == id)
            # Retry on transient asyncpg "another operation in progress" errors
            import asyncio
            max_retries = 3
            for attempt in range(max_retries):
                try:
                    if db is not None:
                        result = await db.execute(query)
                        return result.scalar_one_or_none()
                    # serialize execution on the global async operation lock to avoid
                    # asyncpg errors when multiple coroutines try to drive the same
                    # connection pool concurrently in TestClient/in-process runs.
                    from src.db.session import async_operation_lock
                    async with async_operation_lock:
                        result = await self.db.execute(query)
                        return result.scalar_one_or_none()
                except Exception as e:
                    msg = str(e).lower()
                    if any(substr in msg for substr in ("another operation is in progress", "cannot perform operation", "attached to a different loop")) and attempt < max_retries - 1:
                        await asyncio.sleep(0.05 * (2 ** attempt))
                        continue
                    raise
        except Exception as e:
            raise e

    async def get_all(
        self,
        offset: Optional[int] = None,
        limit: Optional[int] = None,
        filter_query: Optional[Dict[str, Any]] = None,
        search_query: Optional[str] = None,
        sort_by: Optional[str] = None,
        sort_order: Optional[str] = "asc",
    ) -> List[ModelType]:
        """Get all records with optional filtering, searching, sorting and pagination"""
        try:
            query = self._build_base_query()
            query = self._apply_exact_filters(query, filter_query)
            query = self._apply_search_filters(query, search_query)
            query = self._apply_sorting(query, sort_by, sort_order)
            query = self._apply_pagination(query, offset, limit)

            result = await self._execute_and_fetch_all(query)
            return result
        except Exception as e:
            logger.error(f"Error fetching records: {str(e)}")
            raise

    async def create(self, obj_in: CreateSchemaType, db: Optional[Any] = None) -> ModelType:
        """Create a new record.

        Accepts an optional `db` AsyncSession for callers that manage sessions
        externally. If `db` is not provided, uses the repository's session
        provider (`self.db.get_session()`). Returns the created model instance.
        """
        try:
            from src.shared.utils import jsonable_encoder
            from datetime import datetime

            # Prefer pydantic model_dump when available to preserve native datetimes
            if hasattr(obj_in, 'model_dump'):
                obj_in_data = obj_in.model_dump()
            elif isinstance(obj_in, dict):
                obj_in_data = obj_in
            else:
                obj_in_data = jsonable_encoder(obj_in)

            # Normalize ISO datetime strings back to datetime objects for common fields
            for ts_field in ('created_at', 'updated_at', 'trial_ends_at'):
                if ts_field in obj_in_data and isinstance(obj_in_data[ts_field], str):
                    try:
                        obj_in_data[ts_field] = datetime.fromisoformat(obj_in_data[ts_field])
                    except Exception:
                        # if parsing fails, drop the field so DB server default applies
                        obj_in_data.pop(ts_field, None)

            db_obj = self.model(**obj_in_data)

            # If an external session is provided, use it (caller owns commit)
            if db is not None:
                db.add(db_obj)
                await db.flush()
                await db.refresh(db_obj)
                return db_obj

            # Otherwise use internal session manager
            # self.db.get_session() is an async method that returns an AsyncSession
            # We need to await it to get the session
            session = await self.db.get_session()
            async with session:
                try:
                    session.add(db_obj)
                    await session.flush()
                    await session.commit()  # Explicitly commit to ensure data is persisted
                    await session.refresh(db_obj)
                    return db_obj
                except Exception:
                    await session.rollback()
                    raise
        except Exception as e:
            raise e

    async def update(
        self,
        id: int,
        obj_in: UpdateSchemaType,
        db: Optional[Any] = None,
    ) -> Optional[ModelType]:
        """Update an existing record, optionally reusing an external session."""
        try:
            if hasattr(obj_in, "model_dump"):
                update_data = obj_in.model_dump(exclude_unset=True)
            elif hasattr(obj_in, "dict"):
                update_data = obj_in.dict(exclude_unset=True)
            elif isinstance(obj_in, dict):
                update_data = {k: v for k, v in obj_in.items() if v is not None}
            else:
                update_data = {}

            async def _apply_updates(session):
                db_obj = await session.get(self.model, id)
                if not db_obj:
                    return None
                for field, value in update_data.items():
                    if hasattr(db_obj, field):
                        setattr(db_obj, field, value)
                await session.commit()
                await session.refresh(db_obj)
                return db_obj

            if db is not None:
                return await _apply_updates(db)

            # Fix: get_session is an async method, await it properly
            session = await self.db.get_session()
            async with session:
                return await _apply_updates(session)
        except Exception as e:
            raise e

    async def delete(self, id: int) -> bool:
        """Delete a record by ID"""
        try:
            db_obj = await self.get(id)
            if not db_obj:
                return False

            # Use the new async database session
            async with self.db.get_session() as session:
                await session.delete(db_obj)
                await session.commit()
            return True
        except Exception as e:
            raise e

    async def count(
        self,
        filter_query: Optional[Dict[str, Any]] = None,
        search_query: Optional[str] = None,
    ) -> int:
        """Get total count of records with optional filtering"""
        try:
            query = select(func.count(func.distinct(self.model.id))).select_from(
                self.model
            )
            query = self._apply_search_filters(query, search_query)
            query = self._apply_exact_filters(query, filter_query)

            result = await self.db.execute(query)
            count = result.scalar()

            logger.debug(f"Count for {self.model.__name__}: {count}")
            return count

        except Exception as e:
            logger.error(f"Count error for {self.model.__name__}: {e}")
            raise

    async def get_pagination_info(
        self,
        page: int = 1,
        page_size: int = 10,
        filter_query: Optional[Dict[str, Any]] = None,
        search_query: Optional[str] = None,
    ) -> Dict[str, Any]:
        """Get pagination information"""
        try:
            total_count = await self.count(filter_query, search_query)
            total_pages = (total_count + page_size - 1) // page_size
            offset = (page - 1) * page_size

            return {
                "total_count": total_count,
                "total_pages": total_pages,
                "current_page": page,
                "page_size": page_size,
                "offset": offset,
            }
        except Exception:
            raise

    async def _execute_and_fetch_all(self, query):
        result = await self.db.execute(query)
        return result.scalars().all()

    async def exists(self, id: int) -> bool:
        """Check if a record exists by ID"""
        try:
            query = (
                select(func.count()).select_from(self.model).where(self.model.id == id)
            )
            result = await self.db.execute(query)
            return result.scalar() > 0
        except Exception as e:
            logger.error(f"Exists check error for {self.model.__name__}: {e}")
            raise

    async def get_by_field(self, field: str, value: Any) -> Optional[ModelType]:
        """Get a record by a specific field value"""
        try:
            if not hasattr(self.model, field):
                raise ValueError(
                    f"Field '{field}' does not exist in model {self.model.__name__}"
                )

            query = self._build_base_query().where(getattr(self.model, field) == value)
            result = await self.db.execute(query)
            return result.scalar_one_or_none()
        except Exception as e:
            raise e

    async def bulk_create(self, objects: List[CreateSchemaType]) -> List[ModelType]:
        """Create multiple records in bulk"""
        try:
            from src.shared.utils import jsonable_encoder

            db_objects = []

            for obj_in in objects:
                obj_in_data = jsonable_encoder(obj_in)
                db_obj = self.model(**obj_in_data)
                db_objects.append(db_obj)

            # Use the new async database session for bulk operations
            async with self.db.get_session() as session:
                session.add_all(db_objects)
                await session.commit()

                # Refresh all objects to get their IDs
                for obj in db_objects:
                    await session.refresh(obj)

                return db_objects
        except Exception as e:
            raise e

    async def bulk_update(self, updates: List[Dict[str, Any]]) -> bool:
        """Update multiple records in bulk"""
        try:
            # Use the new async database session for bulk operations
            async with self.db.get_session() as session:
                for update_data in updates:
                    record_id = update_data.pop("id", None)
                    if record_id is None:
                        continue

                    record = await session.get(self.model, record_id)
                    if record:
                        for field, value in update_data.items():
                            if hasattr(record, field):
                                setattr(record, field, value)

                await session.commit()
                return True
        except Exception as e:
            raise e

    async def bulk_delete(self, ids: List[int]) -> bool:
        """Delete multiple records by IDs"""
        try:
            # Use the new async database session for bulk operations
            async with self.db.get_session() as session:
                for record_id in ids:
                    record = await session.get(self.model, record_id)
                    if record:
                        await session.delete(record)

                await session.commit()
                return True
        except Exception as e:
            raise e
