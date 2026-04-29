"""
Authentication helpers - minimal token extraction
All auth logic removed, ready for Supabase integration
"""

from typing import Union
from jose import jwt as jose_jwt
import logging

logger = logging.getLogger(__name__)


def extract_user_payload(token_or_dict: Union[str, dict]) -> dict:
    """Extract user payload from token or dict.
    
    This is a minimal stub that extracts basic info from tokens.
    Full validation will be implemented with Supabase integration.
    
    Args:
        token_or_dict: Either a JWT token string or a dict payload
        
    Returns:
        dict: User payload with id, user_id, sub fields
    """
    # If it's already a dict, return it
    if isinstance(token_or_dict, dict):
        return token_or_dict
    
    # If it's a string, try to extract claims
    if isinstance(token_or_dict, str):
        try:
            # Try to extract unverified claims (for development)
            # In production, this will be replaced with Supabase token verification
            claims = jose_jwt.get_unverified_claims(token_or_dict)
            if isinstance(claims, dict):
                user_id = claims.get('id') or claims.get('user_id') or claims.get('sub')
                if user_id:
                    return {'id': str(user_id), 'user_id': str(user_id), 'sub': str(user_id)}
        except Exception:
            pass
    
    return {}
