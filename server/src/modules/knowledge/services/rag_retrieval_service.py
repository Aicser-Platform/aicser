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
from src.shared.embedding import QUERY_INSTRUCTION_PREFIX, get_embedding_service

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
        self._pgvector_available: Optional[bool] = None

    async def _pgvector_available_check(self) -> bool:
        if self._pgvector_available is not None:
            return self._pgvector_available
        try:
            ext = await self._session.execute(
                text("SELECT 1 FROM pg_extension WHERE extname = 'vector' LIMIT 1")
            )
            col = await self._session.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'document_chunks' AND column_name = 'embedding_vector' LIMIT 1"
                )
            )
            self._pgvector_available = ext.first() is not None and col.first() is not None
        except Exception:
            self._pgvector_available = False
        return self._pgvector_available

    async def _retrieve_pgvector(
        self,
        query: str,
        query_embedding: Optional[List[float]],
        data_source_id: str,
        top_k: int,
        schema_table_names: Optional[List[str]] = None,
    ) -> Optional[List[RetrievedChunk]]:
        if not query_embedding or not await self._pgvector_available_check():
            return None
        try:
            vec_literal = "[" + ",".join(str(float(v)) for v in query_embedding) + "]"
            ann = await self._session.execute(
                text(
                    """
                    SELECT dc.id, dc.document_id, dc.content, dc.token_count, dc.chunk_metadata,
                           kd.filename,
                           (dc.embedding_vector <=> :qvec::vector) AS dist
                    FROM document_chunks dc
                    JOIN knowledge_documents kd ON kd.id = dc.document_id
                    WHERE dc.data_source_id = :ds_id
                      AND kd.status = 'ready'
                      AND dc.embedding_vector IS NOT NULL
                    ORDER BY dc.embedding_vector <=> :qvec::vector
                    LIMIT :limit
                    """
                ),
                {"qvec": vec_literal, "ds_id": data_source_id, "limit": max(top_k, RAG_RERANK_TOP_N)},
            )
            rows = ann.fetchall()
            if not rows:
                return None
        except Exception as exc:
            logger.debug("pgvector retrieval unavailable, falling back to JSONB: %s", exc)
            return None

        schema_tables_lower: Set[str] = set()
        if schema_table_names:
            schema_tables_lower = {t.strip().lower() for t in schema_table_names if t and isinstance(t, str)}

        candidates: List[RetrievedChunk] = []
        for row in rows:
            chunk_id, document_id, content, token_count, chunk_meta, doc_filename, dist = row
            score = max(0.0, min(1.0, 1.0 - float(dist or 1.0)))
            kw = _keyword_score(query, content or "")
            final_score = 0.85 * score + 0.15 * kw
            if schema_tables_lower and isinstance(chunk_meta, dict):
                meta_tables = chunk_meta.get("table_names") or chunk_meta.get("tables") or []
                if isinstance(meta_tables, str):
                    meta_tables = [meta_tables]
                for t in meta_tables:
                    if t and isinstance(t, str) and t.strip().lower() in schema_tables_lower:
                        final_score = min(1.0, final_score + 0.05)
                        break
            candidates.append(
                RetrievedChunk(
                    chunk_id=str(chunk_id),
                    document_id=str(document_id),
                    content=content,
                    score=round(final_score, 4),
                    token_count=token_count or 0,
                    metadata=chunk_meta,
                    document_filename=doc_filename,
                )
            )
        candidates.sort(key=lambda c: c.score, reverse=True)
        if USE_RAG_RERANK and len(candidates) > top_k:
            candidates = _rerank_chunks(candidates, query)
        return candidates[:top_k]

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

        query_embedding = await get_embedding_service().embed_text(
            query, instruction_prefix=QUERY_INSTRUCTION_PREFIX
        )

        pgvector_hits = await self._retrieve_pgvector(
            query,
            query_embedding,
            data_source_id,
            top_k,
            schema_table_names,
        )
        if pgvector_hits is not None:
            return pgvector_hits

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

    async def retrieve_multi(
        self,
        query: str,
        data_source_ids: List[str],
        top_k_per_source: int = 5,
        global_top_k: int = 8,
        schema_table_names: Optional[List[str]] = None,
    ) -> List[RetrievedChunk]:
        """Retrieve from multiple knowledge bases, dedupe by chunk_id, return global top-k."""
        if not query or not query.strip() or not data_source_ids:
            return []

        merged: Dict[str, RetrievedChunk] = {}
        for ds_id in data_source_ids:
            if not ds_id:
                continue
            try:
                chunks = await self.retrieve(
                    query,
                    str(ds_id),
                    top_k=top_k_per_source,
                    schema_table_names=schema_table_names,
                )
            except Exception as exc:
                logger.warning("retrieve_multi failed for data_source_id=%s: %s", ds_id, exc)
                continue
            for ch in chunks:
                existing = merged.get(ch.chunk_id)
                if existing is None or ch.score > existing.score:
                    merged[ch.chunk_id] = ch

        ranked = sorted(merged.values(), key=lambda c: c.score, reverse=True)
        return ranked[:global_top_k]

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

    async def retrieval_health(self) -> Dict[str, Any]:
        """Report pgvector availability, chunk stats, and optional probe latency."""
        import time

        pgvector_ext = False
        embedding_vector_column = False
        try:
            ext_row = await self._session.execute(
                text("SELECT 1 FROM pg_extension WHERE extname = 'vector' LIMIT 1")
            )
            pgvector_ext = ext_row.first() is not None
        except Exception:
            pgvector_ext = False

        try:
            col_row = await self._session.execute(
                text(
                    "SELECT 1 FROM information_schema.columns "
                    "WHERE table_name = 'document_chunks' AND column_name = 'embedding_vector' LIMIT 1"
                )
            )
            embedding_vector_column = col_row.first() is not None
        except Exception:
            embedding_vector_column = False

        stats_row = await self._session.execute(
            text(
                "SELECT COUNT(*) AS total, "
                "COUNT(*) FILTER (WHERE embedding IS NOT NULL) AS with_json_embedding "
                "FROM document_chunks"
            )
        )
        stats = stats_row.mappings().first() or {}
        total_chunks = int(stats.get("total") or 0)
        with_json = int(stats.get("with_json_embedding") or 0)

        backend = "pgvector" if pgvector_ext and embedding_vector_column else "jsonb_hybrid"
        probe_ms: Optional[float] = None
        if total_chunks > 0:
            ds_row = await self._session.execute(
                select(DocumentChunk.data_source_id)
                .join(KnowledgeDocument, DocumentChunk.document_id == KnowledgeDocument.id)
                .where(KnowledgeDocument.status == "ready")
                .limit(1)
            )
            ds_id = ds_row.scalar()
            if ds_id:
                t0 = time.perf_counter()
                try:
                    await self.retrieve("health check probe", str(ds_id), top_k=1)
                    probe_ms = round((time.perf_counter() - t0) * 1000, 2)
                except Exception as exc:
                    logger.debug("retrieval_health probe failed: %s", exc)

        return {
            "backend": backend,
            "pgvector_extension": pgvector_ext,
            "embedding_vector_column": embedding_vector_column,
            "total_chunks": total_chunks,
            "chunks_with_json_embedding": with_json,
            "probe_latency_ms": probe_ms,
            "healthy": total_chunks == 0 or with_json > 0 or (pgvector_ext and embedding_vector_column),
        }
