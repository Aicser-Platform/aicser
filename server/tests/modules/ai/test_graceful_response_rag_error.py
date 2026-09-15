"""Regression tests for graceful_response_node's error_code routing.

Context: rag_retrieval_node sets error_code="rag_error" when knowledge-base
retrieval fails, with a message like "Knowledge base retrieval failed: <the
underlying exception text>". graceful_response_node had no branch checking
for error_code == "rag_error" at all, so it fell through every specific
error_code check to the generic `elif "sql" in error_lower or "generation
failed" in error_lower` branch -- which matched because SQLAlchemy exception
text almost always contains the word "sql" somewhere (dialect name, the
"[SQL: ...]" diagnostic dump). The result: a knowledge-base/document search
failure showed NL2SQL guidance ("Show me total sales by category", "top 10
customers by revenue") for a question about uploaded documents, reading as
"it's treating my documents like a SQL table" even though routing to RAG
itself was correct.
"""

import pytest

from ee.modules.ai.nodes.graceful_response_node import graceful_response_node


@pytest.mark.asyncio
async def test_rag_error_gets_knowledge_base_guidance_not_sql_guidance():
    state = {
        "query": "give me a summary of docs",
        "error": "Knowledge base retrieval failed: (sqlalchemy.dialects.postgresql.asyncpg.Error) "
                 "<class 'asyncpg.exceptions.InFailedSQLTransactionError'>: current transaction is "
                 "aborted, commands ignored until end of transaction block [SQL: SELECT document_chunks...]",
        "error_code": "rag_error",
        "data_source_name": "KBb",
        "data_source_schema": None,
    }

    result = await graceful_response_node(state)

    message = result["message"]
    assert "translate your question into a query" not in message
    assert "total sales by category" not in message
    assert "top 10 customers by revenue" not in message
    assert "KBb" in message
    assert "documents" in message.lower() or "knowledge base" in message.lower()


@pytest.mark.asyncio
async def test_sql_error_without_rag_error_code_still_gets_sql_guidance():
    """Control case: a genuine NL2SQL generation failure (no error_code, or
    one not otherwise handled, with "sql" in the error text) must still get
    the SQL-specific guidance -- this fix must not regress that path."""
    state = {
        "query": "some unanswerable question",
        "error": "SQL generation failed: could not produce a valid query",
        "error_code": "",
        "data_source_name": "sales_db",
        "data_source_schema": None,
    }

    result = await graceful_response_node(state)

    assert "translate your question into a query" in result["message"]
