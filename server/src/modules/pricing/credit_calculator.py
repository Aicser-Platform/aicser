"""
AI Credit Calculator
Calculates credits consumed based on agents used, LLM calls, and query complexity
"""

from typing import List, Dict, Optional
from math import ceil

# Base credits per agent type
AGENT_BASE_CREDITS = {
    "nl2sql": 1,
    "chart_generation": 2,
    "insights": 3,
    "validation": 0.5,
    "routing": 0.5,
    "error_recovery": 1,
}

# Complexity multipliers
COMPLEXITY_MULTIPLIERS = {
    "simple": 1.0,
    "medium": 1.5,
    "complex": 2.0,
}

# Model multipliers (cost-based) — aligned with LLM Stats / LiteLLM; GPT-3.5 removed (deprecated)
MODEL_MULTIPLIERS = {
    "gpt-4": 2.0,
    "gpt-4-turbo": 2.5,
    "gpt-4o-mini": 0.8,
    "gpt-4o": 2.2,
    "o1-preview": 4.0,
    "o1-mini": 2.5,
    "o1": 4.0,
    "claude-3-5-sonnet-20241022": 2.0,
    "claude-3-5-haiku-20241022": 0.8,
    "claude-sonnet-4-20250514": 2.5,
    "claude-opus-4-20250514": 4.0,
    "gemini-1.5-pro": 1.8,
    "gemini-1.5-flash": 0.6,
    "gemini-2.5-pro": 2.5,
    "gemini-2.5-flash": 1.2,
    "gemini-2.0-flash": 1.0,
}


def calculate_ai_credits(
    agent_types: List[str],
    llm_calls_per_agent: Dict[str, int],
    query_complexity: str = "medium",
    model_used: str = "gpt-4o-mini",
    data_size_mb: float = 0,
    tokens_used: Optional[int] = None,
) -> int:
    """
    Calculate AI credits consumed for a query
    
    Formula:
    - Base credits per agent
    - First LLM call: full credit
    - Retries: 0.5x credit per retry
    - Complexity multiplier
    - Model multiplier
    - Data size penalty (if >10MB)
    
    Args:
        agent_types: List of agent types used (e.g., ["nl2sql", "chart_generation"])
        llm_calls_per_agent: Dict mapping agent type to number of LLM calls
        query_complexity: "simple", "medium", or "complex"
        model_used: Model name (e.g., "gpt-4o-mini")
        data_size_mb: Size of data processed in MB
        tokens_used: Optional total tokens used (for more accurate calculation)
    
    Returns:
        Total credits consumed (rounded up)
    """
    total_credits = 0.0
    
    for agent_type in agent_types:
        base_credit = AGENT_BASE_CREDITS.get(agent_type, 1.0)
        calls = llm_calls_per_agent.get(agent_type, 1)
        
        # First call full credit, retries half credit
        if calls == 1:
            agent_credits = base_credit
        else:
            agent_credits = base_credit + (calls - 1) * base_credit * 0.5
        
        # Apply complexity multiplier
        complexity_mult = COMPLEXITY_MULTIPLIERS.get(query_complexity, 1.0)
        agent_credits *= complexity_mult
        
        # Apply model multiplier
        model_mult = MODEL_MULTIPLIERS.get(model_used, 1.0)
        agent_credits *= model_mult
        
        total_credits += agent_credits
    
    # Add data size penalty for large datasets
    if data_size_mb > 10:
        total_credits += 1.0
    
    # If tokens provided, add token-based adjustment
    # (More accurate for very large queries)
    if tokens_used and tokens_used > 10000:
        token_penalty = (tokens_used - 10000) / 10000  # 1 credit per 10k tokens over 10k
        total_credits += token_penalty
    
    return int(ceil(total_credits))


def estimate_credits_before_query(
    estimated_agents: List[str],
    estimated_complexity: str = "medium",
    estimated_model: str = "gpt-4o-mini",
) -> int:
    """
    Estimate credits before executing query (for rate limiting check)
    Uses conservative estimates (assumes 1 LLM call per agent)
    """
    llm_calls = {agent: 1 for agent in estimated_agents}
    return calculate_ai_credits(
        agent_types=estimated_agents,
        llm_calls_per_agent=llm_calls,
        query_complexity=estimated_complexity,
        model_used=estimated_model,
    )


