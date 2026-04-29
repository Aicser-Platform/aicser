"""
Semantic Schema Service - Vector-based schema indexing and retrieval
Solves: Schema context overflow for databases with 500+ tables
"""
import asyncio
import logging
from typing import Dict, List, Any, Optional, Tuple
import hashlib
import json
from datetime import datetime, timedelta
import numpy as np
from collections import defaultdict

logger = logging.getLogger(__name__)

try:
    from sentence_transformers import SentenceTransformer
    EMBEDDINGS_AVAILABLE = True
except ImportError:
    EMBEDDINGS_AVAILABLE = False
    logger.warning(
        "sentence-transformers not installed; semantic schema search will use keyword matching. "
        "Install with: pip install sentence-transformers"
    )


class SemanticSchemaService:
    """
    Intelligent schema retrieval using semantic search.
    Reduces context from 5000+ tokens to ~500 tokens by loading only relevant tables.
    """
    
    def __init__(self, cache_ttl_hours: int = 24):
        self.cache_ttl = timedelta(hours=cache_ttl_hours)
        self.embedding_cache: Dict[str, Dict[str, Any]] = {}
        self.schema_graph: Dict[str, List[str]] = {}  # FK relationships
        
        # Initialize embedding model (lazy load)
        self._model = None
        self._model_name = "all-MiniLM-L6-v2"  # Fast, 384-dim embeddings
    
    @property
    def model(self):
        """Lazy load embedding model"""
        if self._model is None and EMBEDDINGS_AVAILABLE:
            self._model = SentenceTransformer(self._model_name)
        return self._model
    
    def _generate_schema_key(self, data_source_id: str, schema: Dict[str, Any]) -> str:
        """Generate cache key for schema"""
        schema_str = json.dumps(schema, sort_keys=True)
        return f"schema_emb:{data_source_id}:{hashlib.md5(schema_str.encode()).hexdigest()}"
    
    def _extract_table_text(self, table_name: str, table_info: Dict[str, Any]) -> str:
        """
        Extract searchable text from table metadata.
        Combines table name, column names, and descriptions.
        """
        parts = [table_name]
        
        # Add columns
        if 'columns' in table_info:
            for col in table_info['columns']:
                if isinstance(col, dict):
                    parts.append(col.get('name', ''))
                    if 'description' in col:
                        parts.append(col['description'])
                elif isinstance(col, str):
                    parts.append(col)
        
        # Add table description if available
        if 'description' in table_info:
            parts.append(table_info['description'])
        
        return " ".join(parts).lower()


    
    def _build_schema_graph(self, schema: Dict[str, Any]) -> None:
        """
        Build FK relationship graph for schema traversal.
        Enables intelligent expansion: if users table is relevant, also load orders table.
        """
        self.schema_graph.clear()
        
        for table_name, table_info in schema.items():
            if not isinstance(table_info, dict):
                continue
            
            self.schema_graph[table_name] = []
            
            # Extract foreign key relationships
            columns = table_info.get('columns', [])
            for col in columns:
                if isinstance(col, dict):
                    # Check for FK indicators
                    col_name = col.get('name', '').lower()
                    if col_name.endswith('_id') or 'foreign_key' in col.get('constraints', []):
                        # Infer referenced table
                        ref_table = col_name.replace('_id', '') + 's'  # Simple heuristic
                        if ref_table in schema:
                            self.schema_graph[table_name].append(ref_table)
    
    async def index_schema(self, data_source_id: str, schema: Dict[str, Any]) -> Dict[str, Any]:
        """
        Index schema with embeddings for semantic search.
        Returns indexed metadata for caching.
        """
        cache_key = self._generate_schema_key(data_source_id, schema)
        
        # Check cache
        if cache_key in self.embedding_cache:
            cached = self.embedding_cache[cache_key]
            if datetime.now() - cached['timestamp'] < self.cache_ttl:
                return cached
        
        # Build relationship graph
        self._build_schema_graph(schema)
        
        # Extract table texts
        table_texts = {}
        for table_name, table_info in schema.items():
            if isinstance(table_info, dict):
                table_texts[table_name] = self._extract_table_text(table_name, table_info)
        
        # Generate embeddings
        embeddings = {}
        if self.model and table_texts:
            table_names = list(table_texts.keys())
            texts = [table_texts[name] for name in table_names]
            
            # Batch encode for efficiency
            emb_vectors = self.model.encode(texts, show_progress_bar=False)
            embeddings = dict(zip(table_names, emb_vectors))
        
        # Cache result
        indexed_data = {
            'embeddings': embeddings,
            'table_texts': table_texts,
            'schema_graph': self.schema_graph.copy(),
            'timestamp': datetime.now(),
            'data_source_id': data_source_id
        }
        
        self.embedding_cache[cache_key] = indexed_data
        return indexed_data


    
    def _cosine_similarity(self, vec1: np.ndarray, vec2: np.ndarray) -> float:
        """Calculate cosine similarity between two vectors"""
        return np.dot(vec1, vec2) / (np.linalg.norm(vec1) * np.linalg.norm(vec2))
    
    def _keyword_match_score(self, query: str, text: str) -> float:
        """Fallback keyword matching when embeddings unavailable"""
        query_words = set(query.lower().split())
        text_words = set(text.lower().split())
        
        if not query_words:
            return 0.0
        
        intersection = query_words & text_words
        return len(intersection) / len(query_words)
    
    async def retrieve_relevant_tables(
        self,
        data_source_id: str,
        schema: Dict[str, Any],
        query: str,
        max_tables: int = 15,
        include_related: bool = True
    ) -> Dict[str, Any]:
        """
        Retrieve most relevant tables for a query using semantic search.
        
        Args:
            data_source_id: Data source identifier
            schema: Full schema dictionary
            query: Natural language query
            max_tables: Maximum tables to return
            include_related: Whether to include FK-related tables
        
        Returns:
            Filtered schema with only relevant tables
        """
        # Index schema if not cached
        indexed = await self.index_schema(data_source_id, schema)
        
        embeddings = indexed['embeddings']
        table_texts = indexed['table_texts']
        schema_graph = indexed['schema_graph']
        
        # Generate query embedding
        if self.model and embeddings:
            query_embedding = self.model.encode([query.lower()], show_progress_bar=False)[0]
            
            # Calculate similarities
            similarities = {}
            for table_name, table_emb in embeddings.items():
                sim = self._cosine_similarity(query_embedding, table_emb)
                similarities[table_name] = sim
        else:
            # Fallback to keyword matching
            similarities = {}
            for table_name, table_text in table_texts.items():
                sim = self._keyword_match_score(query, table_text)
                similarities[table_name] = sim
        
        # Sort by relevance
        ranked_tables = sorted(similarities.items(), key=lambda x: x[1], reverse=True)
        
        # Select top tables
        selected_tables = set()
        for table_name, score in ranked_tables[:max_tables]:
            if score > 0.1:  # Minimum relevance threshold
                selected_tables.add(table_name)
        
        # Expand with related tables (FK relationships)
        if include_related and schema_graph:
            related_tables = set()
            for table in selected_tables:
                if table in schema_graph:
                    related_tables.update(schema_graph[table])
            
            # Add related tables (up to limit)
            for related in related_tables:
                if len(selected_tables) >= max_tables:
                    break
                selected_tables.add(related)
        
        # Build filtered schema
        filtered_schema = {
            table: schema[table]
            for table in selected_tables
            if table in schema
        }
        
        return filtered_schema


    
    def get_schema_summary(self, schema: Dict[str, Any], max_tables: int = 50) -> str:
        """
        Generate compact schema summary for LLM context.
        Groups tables by domain/prefix for better understanding.
        """
        if not schema:
            return "No schema available"
        
        # Group tables by prefix (e.g., user_, order_, product_)
        groups = defaultdict(list)
        for table_name in schema.keys():
            prefix = table_name.split('_')[0] if '_' in table_name else 'other'
            groups[prefix].append(table_name)
        
        # Build summary
        summary_parts = []
        table_count = 0
        
        for prefix, tables in sorted(groups.items()):
            if table_count >= max_tables:
                break
            
            group_tables = tables[:min(10, max_tables - table_count)]
            summary_parts.append(f"{prefix.upper()} domain: {', '.join(group_tables)}")
            table_count += len(group_tables)
        
        if len(schema) > max_tables:
            summary_parts.append(f"... and {len(schema) - max_tables} more tables")
        
        return "\n".join(summary_parts)
    
    def invalidate_cache(self, data_source_id: Optional[str] = None) -> None:
        """Invalidate embedding cache for a data source or all"""
        if data_source_id:
            keys_to_remove = [
                k for k in self.embedding_cache.keys()
                if k.startswith(f"schema_emb:{data_source_id}:")
            ]
            for key in keys_to_remove:
                del self.embedding_cache[key]
        else:
            self.embedding_cache.clear()


# Global instance
_semantic_schema_service = None

def get_semantic_schema_service() -> SemanticSchemaService:
    """Get or create global semantic schema service instance"""
    global _semantic_schema_service
    if _semantic_schema_service is None:
        _semantic_schema_service = SemanticSchemaService()
    return _semantic_schema_service
