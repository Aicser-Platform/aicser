"""Optional LiteLLM adapter for CE-safe chart services.

CE must start without ``src.modules.ai.services``. EE still provides the real
LiteLLM service through the existing ``src.modules.ai`` shim.
"""

from __future__ import annotations

import logging
from typing import Any, Dict, List

from src.core.edition import is_ee_enabled

logger = logging.getLogger(__name__)


class NoOpLiteLLMService:
    """Small fallback that preserves chart-service behavior without EE AI."""

    async def _get_model_config(self) -> Dict[str, Any]:
        return {"model": "ce-rule-based"}

    async def analyze_natural_language_query(
        self,
        query: str,
        context: Dict[str, Any] | None = None,
    ) -> Dict[str, Any]:
        del context
        query_lower = (query or "").lower()
        query_type: List[str] = []
        if any(word in query_lower for word in ("trend", "over time", "growth", "change")):
            query_type.append("trends")
        if any(word in query_lower for word in ("compare", "vs", "versus", "difference")):
            query_type.append("comparisons")
        if any(word in query_lower for word in ("count", "total", "sum", "average", "avg")):
            query_type.append("metrics")
        if any(word in query_lower for word in ("breakdown", "distribution", "split", "by")):
            query_type.append("segmentation")

        return {
            "original_query": query,
            "query_type": query_type or ["general"],
            "intent": "rule_based_chart_analysis",
            "business_context": {"type": "general"},
            "fallback": True,
        }

    async def generate_business_insights(
        self,
        data: List[Dict[str, Any]],
        query_analysis: Dict[str, Any] | None = None,
    ) -> List[str]:
        del query_analysis
        if not data:
            return ["No rows were returned for this chart."]
        return [f"Chart generated from {len(data)} row(s)."]


def get_litellm_service() -> Any:
    """Return EE LiteLLM service when available, otherwise a CE no-op service."""
    if is_ee_enabled():
        try:
            from src.modules.ai.services.litellm_service import LiteLLMService

            return LiteLLMService()
        except ImportError as exc:
            logger.warning("EE LiteLLM service unavailable; using chart fallback: %s", exc)

    return NoOpLiteLLMService()
