"""CE query pattern store — pgvector + keyword few-shot retrieval."""

from __future__ import annotations

import hashlib
import json
import logging
import math
import re
from typing import Any, Dict, List, Optional

from sqlalchemy import text

from src.modules.nl2sql.few_shot import keyword_overlap_score
from src.shared.embedding import QUERY_INSTRUCTION_PREFIX, get_embedding_service

logger = logging.getLogger(__name__)


def _normalize_query(query: str) -> str:
    q = query.lower().strip()
    q = re.sub(r"\s+", " ", q)
    return q.rstrip("?!.")


def compute_schema_hash(schema: Dict[str, Any]) -> str:
    tables = schema.get("tables", [])
    parts = []
    for t in sorted(tables, key=lambda x: x.get("name", "")):
        t_name = t.get("name", "")
        cols = sorted(c.get("name", "") for c in t.get("columns", []))
        parts.append(f"{t_name}:{','.join(cols)}")
    return hashlib.md5("|".join(parts).encode()).hexdigest()[:12]


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    if not a or not b or len(a) != len(b):
        return 0.0
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na * nb == 0:
        return 0.0
    return max(0.0, min(1.0, dot / (na * nb)))


class QueryPatternStore:
    def __init__(self, async_session_factory=None):
        self._session_factory = async_session_factory

    def _factory(self):
        if self._session_factory:
            return self._session_factory
        from src.db.session import async_session
        return async_session

    async def store_pattern(
        self,
        nl_query: str,
        sql: str,
        schema: Dict[str, Any],
        *,
        data_source_id: Optional[str] = None,
        user_id: Optional[str] = None,
        origin: str = "ce_query_editor",
    ) -> bool:
        if not nl_query or not sql or not schema:
            return False
        factory = self._factory()
        schema_hash = compute_schema_hash(schema)
        normalized = _normalize_query(nl_query)
        embedding = await get_embedding_service().embed_text(nl_query, instruction_prefix=QUERY_INSTRUCTION_PREFIX)
        emb_json = json.dumps(embedding) if embedding else None

        try:
            async with factory() as session:
                await session.execute(
                    text("""
                        INSERT INTO query_patterns
                            (schema_hash, nl_query, nl_query_normalized, sql, analytics_type,
                             data_source_id, user_id, origin, score, execution_count, embedding)
                        VALUES
                            (:schema_hash, :nl_query, :normalized, :sql, 'descriptive',
                             :data_source_id, :user_id, :origin, 1, 1, CAST(:embedding AS JSONB))
                    """),
                    {
                        "schema_hash": schema_hash,
                        "nl_query": nl_query.strip(),
                        "normalized": normalized,
                        "sql": sql.strip(),
                        "data_source_id": data_source_id,
                        "user_id": user_id,
                        "origin": origin,
                        "embedding": emb_json,
                    },
                )
                if embedding:
                    try:
                        vec_literal = "[" + ",".join(str(float(v)) for v in embedding) + "]"
                        await session.execute(
                            text("""
                                UPDATE query_patterns
                                SET embedding_vector = :qvec::vector
                                WHERE schema_hash = :schema_hash AND nl_query_normalized = :normalized
                            """),
                            {"qvec": vec_literal, "schema_hash": schema_hash, "normalized": normalized},
                        )
                    except Exception:
                        pass
                await session.commit()
            return True
        except Exception as exc:
            logger.debug("QueryPatternStore.store_pattern failed: %s", exc)
            return False

    async def retrieve_similar(
        self,
        nl_query: str,
        schema: Dict[str, Any],
        top_k: int = 3,
        min_similarity: float = 0.15,
    ) -> List[Dict[str, str]]:
        if not nl_query or not schema:
            return []
        factory = self._factory()
        schema_hash = compute_schema_hash(schema)
        normalized = _normalize_query(nl_query)
        query_embedding = await get_embedding_service().embed_text(
            nl_query, instruction_prefix=QUERY_INSTRUCTION_PREFIX
        )

        try:
            async with factory() as session:
                if query_embedding:
                    try:
                        vec_literal = "[" + ",".join(str(float(v)) for v in query_embedding) + "]"
                        ann = await session.execute(
                            text("""
                                SELECT nl_query, sql, nl_query_normalized, score
                                FROM query_patterns
                                WHERE schema_hash = :schema_hash
                                  AND score > 0
                                  AND embedding_vector IS NOT NULL
                                ORDER BY embedding_vector <=> :qvec::vector
                                LIMIT :limit
                            """),
                            {"schema_hash": schema_hash, "qvec": vec_literal, "limit": top_k * 3},
                        )
                        rows = ann.fetchall()
                        if rows:
                            return [
                                {"query": r[0], "sql": r[1]}
                                for r in rows
                                if r[2] != normalized
                            ][:top_k]
                    except Exception:
                        pass

                result = await session.execute(
                    text("""
                        SELECT nl_query, sql, nl_query_normalized, score, embedding
                        FROM query_patterns
                        WHERE schema_hash = :schema_hash AND score > 0
                        ORDER BY execution_count DESC, updated_at DESC
                        LIMIT 200
                    """),
                    {"schema_hash": schema_hash},
                )
                rows = result.fetchall()

            if not rows:
                return []

            scored: List[tuple] = []
            for row in rows:
                if row[2] == normalized:
                    continue
                kw = keyword_overlap_score(normalized, row[2])
                if query_embedding and row[4]:
                    try:
                        emb = row[4] if isinstance(row[4], list) else json.loads(row[4])
                        if isinstance(emb, list) and len(emb) == len(query_embedding):
                            final = 0.3 * kw + 0.7 * _cosine_similarity(query_embedding, emb)
                        else:
                            final = kw
                    except Exception:
                        final = kw
                else:
                    final = kw
                if final >= min_similarity:
                    scored.append((final, {"query": row[0], "sql": row[1]}))

            scored.sort(key=lambda x: x[0], reverse=True)
            return [item for _, item in scored[:top_k]]
        except Exception as exc:
            logger.debug("QueryPatternStore.retrieve_similar failed: %s", exc)
            return []
