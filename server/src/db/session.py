from typing import AsyncGenerator

from sqlalchemy import create_engine
from sqlalchemy.ext.asyncio import AsyncSession, create_async_engine, async_sessionmaker
from sqlalchemy.orm import sessionmaker
from sqlalchemy.pool import QueuePool
import os

from src.core.config import settings
import asyncio

# Create async engine for async operations
# Explicitly specify asyncpg driver to prevent auto-detection of psycopg2
async_url = settings.SQLALCHEMY_DATABASE_URI
if "postgresql+asyncpg://" not in async_url:
    async_url = async_url.replace("postgresql://", "postgresql+asyncpg://")

# Configure SSL for Azure PostgreSQL
connect_args = {"server_settings": {"application_name": "chat2chart_async"}}

# Auto-detect Azure PostgreSQL and require SSL
if "database.azure.com" in async_url:
    connect_args["ssl"] = "require"

# SECURITY: echo must be False in production. When True, SQLAlchemy logs every statement and
# bound parameters, including connection_config (host, username, etc.) and schema (tables/columns).
# Use SQLALCHEMY_ECHO=1 only for local debugging; never in production or shared logs.
# pool_pre_ping: drop stale asyncpg connections (avoids "connection is closed" on first query after idle/proxy drop).
# pool_recycle: proactively recycle connections before server-side timeouts (Azure PG, pgbouncer, etc.).
_async_pool_recycle = int(os.getenv("DB_ASYNC_POOL_RECYCLE", "1800"))
async_engine = create_async_engine(
    async_url,
    future=True,
    echo=bool(os.getenv("SQLALCHEMY_ECHO", "false").lower() in ("1", "true")),
    poolclass=None,
    pool_pre_ping=True,
    pool_recycle=_async_pool_recycle,
    connect_args=connect_args,
)

# The original async_sessionmaker (without custom error suppression logic)
async_session = async_sessionmaker(
    bind=async_engine,
    class_=AsyncSession,
    expire_on_commit=False,
    autocommit=False,
    autoflush=False,
)

# Create sync engine for sync operations (like migrations) - lazy initialization
_sync_engine = None
_sync_session = None

def get_sync_engine():
    """Get sync engine with lazy initialization to prevent psycopg2 import during startup"""
    global _sync_engine
    if _sync_engine is None:
        # Use the new SYNC_DATABASE_URI property
        sync_url = settings.SYNC_DATABASE_URI
        _sync_engine = create_engine(
            sync_url,
            echo=bool(os.getenv("SQLALCHEMY_ECHO", "false").lower() in ("1", "true")),
            poolclass=QueuePool,
            pool_size=int(os.getenv("DB_POOL_SIZE", "5")),
            max_overflow=int(os.getenv("DB_POOL_MAX_OVERFLOW", "10")),
            pool_pre_ping=True,
        )
    return _sync_engine

def get_sync_session():
    """Get sync database session for migrations"""
    global _sync_session
    if _sync_session is None:
        _sync_session = sessionmaker(autocommit=False, autoflush=False, bind=get_sync_engine())
    return _sync_session()

async def get_async_session() -> AsyncGenerator[AsyncSession, None]:
    """Async generator dependency yielding an AsyncSession for FastAPI.

    Use this pattern so FastAPI receives an async generator (yield) and
    correctly manages the session lifecycle. Avoid decorating with
    @asynccontextmanager which returns a context manager object that
    FastAPI won't iterate as an async generator.
    """
    async with async_session() as session:
        try:
            import asyncio as _asyncio
            session._op_lock = _asyncio.Lock() # Ensure the lock is set
            yield session
        except Exception:
            await session.rollback()
            raise

# Removed duplicate function definition

# Global async database session instance - lazy initialization
_db_instance = None

def get_db():
    """Get the global database instance with lazy initialization"""
    global _db_instance
    if _db_instance is None:
        _db_instance = AsyncDatabaseSession()
    return _db_instance

class AsyncDatabaseSession:
    """Async database session wrapper for repository operations"""
    
    def __init__(self):
        self._engine = async_engine
        self._session_factory = async_session
    
    async def get_session(self):
        """Get a new async session"""
        return self._session_factory()
    
    async def execute(self, query):
        """Execute a query using a new session"""
        async with self._session_factory() as session:
            try:
                # attach per-session op lock if not present
                try:
                    if not getattr(session, '_op_lock', None):
                        import asyncio as _asyncio

                        session._op_lock = _asyncio.Lock()
                except Exception:
                    session._op_lock = None

                if getattr(session, '_op_lock', None):
                    async with session._op_lock:
                        result = await session.execute(query)
                        await session.commit()
                        return result
                else:
                    result = await session.execute(query)
                    await session.commit()
                    return result
            except Exception:
                await session.rollback()
                raise
    
    async def add(self, obj):
        """Add an object to the database"""
        async with self._session_factory() as session:
            try:
                try:
                    if not getattr(session, '_op_lock', None):
                        import asyncio as _asyncio

                        session._op_lock = _asyncio.Lock()
                except Exception:
                    session._op_lock = None

                if getattr(session, '_op_lock', None):
                    async with session._op_lock:
                        session.add(obj)
                        await session.commit()
                        await session.refresh(obj)
                        return obj
                else:
                    session.add(obj)
                    await session.commit()
                    await session.refresh(obj)
                    return obj
            except Exception:
                await session.rollback()
                raise
    
    async def delete(self, obj):
        """Delete an object from the database"""
        async with self._session_factory() as session:
            try:
                try:
                    if not getattr(session, '_op_lock', None):
                        import asyncio as _asyncio

                        session._op_lock = _asyncio.Lock()
                except Exception:
                    session._op_lock = None

                if getattr(session, '_op_lock', None):
                    async with session._op_lock:
                        await session.delete(obj)
                        await session.commit()
                        return True
                else:
                    await session.delete(obj)
                    await session.commit()
                    return True
            except Exception:
                await session.rollback()
                raise
    
    async def close(self):
        """Close the engine"""
        await self._engine.close()

# Export sync engine for migrations - lazy initialization
def get_database():
    """Get sync database engine for migrations"""
    return get_sync_engine()

# For backward compatibility
database = get_database

# Global async operation lock to serialize DB operations when needed (helps tests avoid asyncpg 'another operation in progress')
async_operation_lock = asyncio.Lock()
