"""
Query Execution Adapter - Protocol for unified query execution.

Phase 4 of Workflow Improvement Plan: single interface used by
- Query editor (POST /data/query/execute)
- AI workflow nodes (query_execution, multi_query_execution, etc.)

MultiEngineQueryService is the default implementation.
"""

from typing import Any, Dict, List, Optional, Protocol, runtime_checkable


@runtime_checkable
class QueryExecutionAdapter(Protocol):
    """
    Protocol for query execution. Implementations must support:
    - execute: single SQL
    - execute_batch: multiple SQLs (sequential)
    """

    async def execute_query(
        self,
        query: str,
        data_source: Dict[str, Any],
        engine: Optional[Any] = None,
        optimization: bool = True,
    ) -> Dict[str, Any]:
        """Execute single SQL. Returns dict with success, data, error, engine, etc."""
        ...

    async def execute_batch(
        self,
        sqls: List[str],
        data_source: Dict[str, Any],
        engine: Optional[Any] = None,
        optimization: bool = True,
    ) -> List[Dict[str, Any]]:
        """Execute multiple SQLs sequentially. Returns list of result dicts."""
        ...
