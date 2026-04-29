"""
RAG Retrieval Service — Hybrid (semantic + keyword) search over document chunks.

Follows the same hybrid scoring pattern as QueryPatternService:
    final_score = alpha * embedding_score + (1 - alpha) * keyword_score

Optional rerank step after hybrid retrieval improves order before synthesis.
Chunk metadata (e.g. table_names, column_names) can be used for schema–document join
when combining with Schema RAG in hybrid_rag flows.

Uses pgvector when available; falls back to JSONB cosine similarity in Python.
Always scoped by data_source_id to respect data boundaries.
"""

import logging
import math
import os
import re
from dataclasses import dataclass
from typing import Any, Dict, List, Optional, Set

from sqlalchemy import select, text, func
from sqlalchemy.ext.asyncio import AsyncSession

from src.modules.knowledge.models import DocumentChunk, KnowledgeDocument
from src.modules.ai.utils.embedding_service import get_embedding, QUERY_INSTRUCTION_PREFIX

logger = logging.getLogger(__name__)

HYBRID_ALPHA = 0.7  # weight for embedding similarity; 0.3 for keyword
USE_RAG_RERANK = os.environ.get("USE_RAG_RERANK", "").strip().lower() in ("1", "true", "yes")
RAG_RERANK_TOP_N = int(os.environ.get("RAG_RERANK_TOP_N", "10").strip() or "10")


@dataclass
class RetrievedChunk:
    """A chunk returned from retrieval with its score and metadata.

    metadata may contain table_names, column_names (list/str) for schema–document join
    when used with Schema RAG in hybrid_rag flows.
    """
    chunk_id: str
    document_id: str
    content: str
    score: float
    token_count: int
    metadata: Optional[Dict[str, Any]] = None
    document_filename: Optional[str] = None


def _cosine_similarity(a: List[float], b: List[float]) -> float:
    """Cosine similarity between two vectors (0..1). Uses simsimd if available."""
    if not a or not b or len(a) != len(b):
        return 0.0
    try:
        import simsimd
        s = float(simsimd.cosine(a, b))
        return max(0.0, min(1.0, s))
    except Exception:
        pass
    dot = sum(x * y for x, y in zip(a, b))
    na = math.sqrt(sum(x * x for x in a))
    nb = math.sqrt(sum(x * x for x in b))
    if na * nb == 0:
        return 0.0
    return max(0.0, min(1.0, dot / (na * nb)))


def _keyword_score(query: str, content: str) -> float:
    """Simple keyword overlap score between query and chunk content."""
    stop_words = {
        "what", "show", "give", "tell", "list", "find", "from", "with",
        "that", "this", "which", "where", "when", "many", "much", "does",
        "have", "been", "will", "would", "could", "should", "about", "into",
        "than", "then", "them", "they", "their", "there", "these", "those",
        "the", "and", "for", "are", "but", "not", "you", "all", "can",
    }

    def _extract(t: str) -> Set[str]:
        words = set(re.findall(r"[a-z]+", t.lower()))
        return {w for w in words if len(w) > 2 and w not in stop_words}

    q_words = _extract(query)
    c_words = _extract(content)
    if not q_words or not c_words:
        return 0.0
    overlap = q_words & c_words
    return len(overlap) / len(q_words)


def _rerank_chunks(chunks: List[RetrievedChunk], query: str) -> List[RetrievedChunk]:
    """
    Optional rerank: re-score top candidates by keyword relevance to improve order.
    When USE_RAG_RERANK is true, applies a secondary sort so chunks with higher
    keyword overlap to the query rank higher. Can be replaced by a cross-encoder later.
    """
    if not chunks or not query or not query.strip():
        return chunks
    scored: List[tuple] = []
    for ch in chunks:
        kw = _keyword_score(query, ch.content)
        scored.append((kw, ch))
    scored.sort(key=lambda x: x[0], reverse=True)
    return [c for _, c in scored]


class RAGRetrievalService:
    """
    Hybrid retrieval over document_chunks.

    Usage:
        service = RAGRetrievalService(session)
        chunks = await service.retrieve("What is the refund policy?", ds_id, top_k=5)
    """

    def __init__(self, session: AsyncSession):
        self._session = session

    async def retrieve(
        self,
        query: str,
        data_source_id: str,
        top_k: int = 5,
        schema_table_names: Optional[List[str]] = None,
    ) -> List[RetrievedChunk]:
        """
        Retrieve top-k relevant chunks for a query, scoped to a data source.
        Uses hybrid ranking: embedding similarity + keyword overlap.
        Optional rerank (USE_RAG_RERANK) re-orders top candidates for relevance.
        When schema_table_names is provided (e.g. from Schema RAG), chunks whose
        metadata contains those table names get a small score boost for schema–document join.
        """
        if not query or not query.strip():
            return []

        # 1. Load all chunks for this data source (with document filenames)
        stmt = (
            select(
                DocumentChunk.id,
                DocumentChunk.document_id,
                DocumentChunk.content,
                DocumentChunk.token_count,
                DocumentChunk.embedding,
                DocumentChunk.chunk_metadata,
                KnowledgeDocument.filename,
            )
            .join(KnowledgeDocument, DocumentChunk.document_id == KnowledgeDocument.id)
            .where(DocumentChunk.data_source_id == data_source_id)
            .where(KnowledgeDocument.status == "ready")
        )
        result = await self._session.execute(stmt)
        rows = result.all()

        if not rows:
            logger.debug("No ready chunks found for data_source_id=%s", data_source_id)
            return []

        # 2. Get query embedding
        query_embedding = await get_embedding(query, instruction_prefix=QUERY_INSTRUCTION_PREFIX)

        schema_tables_lower: Set[str] = set()
        if schema_table_names:
            schema_tables_lower = {t.strip().lower() for t in schema_table_names if t and isinstance(t, str)}

        # 3. Score each chunk
        scored: List[tuple] = []
        for row in rows:
            chunk_id, document_id, content, token_count, embedding, chunk_meta, doc_filename = row

            # Embedding similarity
            emb_score = 0.0
            if query_embedding and embedding and isinstance(embedding, list):
                emb_score = _cosine_similarity(query_embedding, embedding)

            # Keyword similarity
            kw_score = _keyword_score(query, content)

            # Hybrid score
            if query_embedding:
                final_score = HYBRID_ALPHA * emb_score + (1 - HYBRID_ALPHA) * kw_score
            else:
                final_score = kw_score

            # Optional: boost chunks that reference schema tables (for schema–document join)
            if schema_tables_lower and isinstance(chunk_meta, dict):
                meta_tables = chunk_meta.get("table_names") or chunk_meta.get("tables") or []
                if isinstance(meta_tables, str):
                    meta_tables = [meta_tables]
                for t in meta_tables:
                    if t and isinstance(t, str) and t.strip().lower() in schema_tables_lower:
                        final_score = min(1.0, final_score + 0.05)
                        break

            scored.append((
                final_score,
                RetrievedChunk(
                    chunk_id=str(chunk_id),
                    document_id=str(document_id),
                    content=content,
                    score=round(final_score, 4),
                    token_count=token_count or 0,
                    metadata=chunk_meta,
                    document_filename=doc_filename,
                ),
            ))

        # 4. Sort by score descending; take more if rerank enabled
        scored.sort(key=lambda x: x[0], reverse=True)
        take_n = max(top_k, RAG_RERANK_TOP_N) if USE_RAG_RERANK else top_k
        candidates = [item[1] for item in scored[:take_n]]

        # 5. Optional rerank over top candidates
        if USE_RAG_RERANK and len(candidates) > top_k:
            candidates = _rerank_chunks(candidates, query)
        return candidates[:top_k]

    async def has_documents(self, data_source_id: str) -> bool:
        """Check if a data source has any ready knowledge documents."""
        stmt = (
            select(func.count(KnowledgeDocument.id))
            .where(KnowledgeDocument.data_source_id == data_source_id)
            .where(KnowledgeDocument.status == "ready")
        )
        result = await self._session.execute(stmt)
        count = result.scalar() or 0
        return count > 0
