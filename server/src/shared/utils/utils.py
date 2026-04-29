"""
Common utility functions for the chat2chart service
"""

import math
from typing import Any, Dict, List
from datetime import datetime, date
from decimal import Decimal
import json


def _is_nan_or_inf(val: Any) -> bool:
    """Check if value is NaN or Infinity (invalid in JSON/PostgreSQL JSONB)."""
    if isinstance(val, float):
        return math.isnan(val) or math.isinf(val)
    try:
        import numpy as np
        if isinstance(val, (np.floating, np.integer)):
            if np.issubdtype(type(val), np.floating):
                return bool(np.isnan(val) or np.isinf(val))
    except ImportError:
        pass
    return False


def sanitize_for_jsonb(obj: Any) -> Any:
    """
    Recursively sanitize a structure for PostgreSQL JSONB storage.
    Replaces NaN, Infinity, -Infinity with None (invalid in JSON spec).
    Converts numpy types to Python native.
    """
    if obj is None:
        return None
    if isinstance(obj, dict):
        return {k: sanitize_for_jsonb(v) for k, v in obj.items()}
    if isinstance(obj, list):
        return [sanitize_for_jsonb(item) for item in obj]
    if _is_nan_or_inf(obj):
        return None
    if isinstance(obj, float):
        return obj
    try:
        import numpy as np
        if isinstance(obj, np.integer):
            return int(obj)
        if isinstance(obj, np.floating):
            return float(obj) if not (np.isnan(obj) or np.isinf(obj)) else None
        if isinstance(obj, np.ndarray):
            return sanitize_for_jsonb(obj.tolist())
    except ImportError:
        pass
    return obj


def jsonable_encoder(obj: Any) -> Any:
    """
    Convert an object to a JSON-serializable format.
    Similar to FastAPI's jsonable_encoder but lightweight.
    """
    if obj is None:
        return None
    elif isinstance(obj, (str, int, float, bool)):
        return obj
    elif isinstance(obj, datetime):
        return obj.isoformat()
    elif isinstance(obj, date):
        return obj.isoformat()
    elif isinstance(obj, Decimal):
        return float(obj)
    elif isinstance(obj, dict):
        return {key: jsonable_encoder(value) for key, value in obj.items()}
    elif isinstance(obj, list):
        return [jsonable_encoder(item) for item in obj]
    elif hasattr(obj, "dict"):
        # Pydantic models
        return jsonable_encoder(obj.dict())
    elif hasattr(obj, "__dict__"):
        # Regular objects
        return jsonable_encoder(obj.__dict__)
    else:
        # Try to convert to string as fallback
        try:
            return str(obj)
        except Exception:
            return None


def safe_json_dumps(obj: Any) -> str:
    """
    Safely serialize an object to JSON string.
    """
    try:
        return json.dumps(jsonable_encoder(obj), default=str)
    except Exception:
        return str(obj)


def filter_dict(data: Dict[str, Any], allowed_keys: List[str]) -> Dict[str, Any]:
    """
    Filter a dictionary to only include specified keys.
    """
    return {key: value for key, value in data.items() if key in allowed_keys}


def exclude_dict(data: Dict[str, Any], excluded_keys: List[str]) -> Dict[str, Any]:
    """
    Filter a dictionary to exclude specified keys.
    """
    return {key: value for key, value in data.items() if key not in excluded_keys}


def deep_merge(dict1: Dict[str, Any], dict2: Dict[str, Any]) -> Dict[str, Any]:
    """
    Deep merge two dictionaries.
    """
    result = dict1.copy()
    for key, value in dict2.items():
        if key in result and isinstance(result[key], dict) and isinstance(value, dict):
            result[key] = deep_merge(result[key], value)
        else:
            result[key] = value
    return result
