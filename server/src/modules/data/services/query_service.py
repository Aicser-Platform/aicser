import logging
from typing import Dict, Any
from sqlalchemy import text
from sqlalchemy.orm import Session
from src.core.cache import cache
from src.shared.query_limits import DEFAULT_FILE_QUERY_LIMIT, DEFAULT_QUERY_LIMIT
import time

logger = logging.getLogger(__name__)


class QueryExecutionService:
    """Service for executing SQL queries with caching and optimization"""

    def __init__(self):
        self.query_timeout = 30  # seconds
        self.max_rows = DEFAULT_FILE_QUERY_LIMIT

    async def execute_query(
        self, sql_query: str, db: Session, use_cache: bool = True
    ) -> Dict[str, Any]:
        """Execute SQL query with caching and optimization"""
        try:
            # Check cache first if enabled
            if use_cache:
                cached_result = cache.get_query_result(sql_query)
                if cached_result:
                    logger.info(f"Cache hit for query: {sql_query[:50]}...")
                    return cached_result

            # Execute query with timing
            start_time = time.time()

            # Add LIMIT if not present to prevent large result sets
            optimized_query = self._optimize_query(sql_query)

            result = db.execute(text(optimized_query))
            rows = result.fetchall()
            columns = result.keys()

            execution_time = time.time() - start_time

            # Convert to dict format
            data = [{col: value for col, value in zip(columns, row)} for row in rows]

            query_result = {
                "success": True,
                "data": data,
                "columns": list(columns),
                "row_count": len(data),
                "execution_time": round(execution_time, 3),
                "query": optimized_query,
            }

            # Cache the result if successful and not too large
            if use_cache and len(data) < DEFAULT_QUERY_LIMIT:
                cache.set_query_result(sql_query, query_result)
                logger.info(f"Cached query result: {sql_query[:50]}...")

            return query_result

        except Exception as e:
            logger.error(f"Query execution error: {str(e)}")
            return {
                "success": False,
                "error": str(e),
                "data": [],
                "columns": [],
                "row_count": 0,
                "execution_time": 0,
            }

    def _optimize_query(self, sql_query: str) -> str:
        """Optimize SQL query for performance"""
        query_lower = sql_query.lower().strip()

        # Add LIMIT if it's a SELECT query without LIMIT
        if (
            query_lower.startswith("select")
            and "limit" not in query_lower
            and "count(" not in query_lower
        ):
            # Don't add LIMIT if it already has one or is an aggregate query
            if not any(
                keyword in query_lower
                for keyword in ["limit", "count(", "sum(", "avg(", "max(", "min("]
            ):
                sql_query += f" LIMIT {self.max_rows}"

        return sql_query

    async def get_query_plan(self, sql_query: str, db: Session) -> Dict[str, Any]:
        """Get query execution plan for optimization insights"""
        try:
            explain_query = f"EXPLAIN (FORMAT JSON) {sql_query}"
            result = db.execute(text(explain_query))
            plan = result.fetchone()[0]

            return {"success": True, "plan": plan}
        except Exception as e:
            logger.error(f"Query plan error: {str(e)}")
            return {"success": False, "error": str(e)}


# Global service instance
query_service = QueryExecutionService()
