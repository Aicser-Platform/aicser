from typing import Dict, Any

SENSITIVE_KEYS = {"password", "api_key", "token", "secret_access_key", "access_key_id", "connection_string", "credentials"}


def mask_connection_info(conn: Dict[str, Any]) -> Dict[str, Any]:
    """Return a shallow copy of conn with sensitive fields masked."""
    if not isinstance(conn, dict):
        return conn
    out = dict(conn)
    for k in list(out.keys()):
        if k in SENSITIVE_KEYS and out.get(k) not in (None, ''):
            try:
                v = str(out.get(k))
                if len(v) > 6:
                    out[k] = v[:3] + '...' + v[-3:]
                else:
                    out[k] = '***'
            except Exception:
                out[k] = '***'
    return out


