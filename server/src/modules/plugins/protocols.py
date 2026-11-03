"""Connector protocols for Aicser Plug-ins."""

from __future__ import annotations

from typing import Any, Dict, Optional, Protocol, Tuple, runtime_checkable

from pydantic import BaseModel


@runtime_checkable
class URLConnector(Protocol):
    """Protocol for SQLAlchemy URL-based warehouse and database connectors."""

    def build_url(self, config: Dict[str, Any]) -> str:
        """Construct a SQLAlchemy connection URL from decrypted config."""
        ...

    def engine_kwargs(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Optional custom arguments passed to create_engine."""
        ...

    def ping_sql(self) -> str:
        """SQL query used for quick health check / ping (default: 'SELECT 1')."""
        ...


class QueryResult(BaseModel):
    columns: list[str]
    rows: list[dict[str, Any]]
    total_rows: int


@runtime_checkable
class ExtendedConnector(Protocol):
    """Protocol for non-SQLAlchemy / NoSQL connectors (MongoDB, Cassandra, DynamoDB)."""

    async def test_connection(self, config: Dict[str, Any]) -> Tuple[bool, Optional[str]]:
        """Verify network connectivity and credentials."""
        ...

    async def get_schema(self, config: Dict[str, Any]) -> Dict[str, Any]:
        """Inspect collections/tables and schema fields."""
        ...

    async def execute_query(
        self,
        config: Dict[str, Any],
        query: str,
        params: Optional[Dict[str, Any]] = None,
        limit: int = 1000,
    ) -> QueryResult:
        """Execute driver-specific query syntax."""
        ...

