import os
import re
from typing import Dict, Any, Iterable, List, Tuple

SENSITIVE_KEYS = {"password", "api_key", "token", "secret_access_key", "access_key_id", "connection_string", "credentials"}
SENSITIVE_RESULT_KEYS = {
    "access_key",
    "access_key_id",
    "access_token",
    "api_key",
    "apikey",
    "auth",
    "authorization",
    "bank_account",
    "base_salary",
    "bearer",
    "card_number",
    "client_secret",
    "compensation",
    "connection_string",
    "credential",
    "credentials",
    "credit_card",
    "cvv",
    "id_token",
    "iban",
    "jwt",
    "national_id",
    "pass",
    "passphrase",
    "passwd",
    "password",
    "payroll",
    "private_key",
    "refresh_token",
    "routing_number",
    "salary",
    "secret",
    "secret_access_key",
    "session",
    "ssn",
    "tax_id",
    "token",
    "wage",
}
SENSITIVE_RESULT_SUBSTRINGS = {
    "password",
    "secret",
    "token",
    "credential",
    "private_key",
    "salary",
    "compensation",
}
MASKED_VALUE = "***MASKED***"


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


def _normalize_key(key: Any) -> str:
    name = str(key or "").strip()
    name = re.sub(r"(?<=[a-z0-9])(?=[A-Z])", "_", name)
    name = re.sub(r"[^A-Za-z0-9]+", "_", name).strip("_").lower()
    return name


def is_sensitive_result_column(column: Any) -> bool:
    """Return True when a query result column name likely contains secrets or regulated values."""
    normalized = _normalize_key(column)
    if not normalized:
        return False
    if normalized in SENSITIVE_RESULT_KEYS:
        return True
    tokens = {part for part in normalized.split("_") if part}
    if tokens.intersection(SENSITIVE_RESULT_KEYS):
        return True
    return any(marker in normalized for marker in SENSITIVE_RESULT_SUBSTRINGS)


def sensitive_query_result_masking_enabled() -> bool:
    """Default-on guard for query editor result masking."""
    allow_raw = os.getenv("AICSER_ALLOW_SENSITIVE_QUERY_RESULTS", "").strip().lower()
    if allow_raw in {"1", "true", "yes", "on"}:
        return False
    explicit = os.getenv("AICSER_MASK_SENSITIVE_QUERY_RESULTS", "").strip().lower()
    if explicit in {"0", "false", "no", "off"}:
        return False
    return True


def mask_query_result_rows(
    rows: Iterable[Any],
    columns: Iterable[Any] | None = None,
    *,
    enabled: bool | None = None,
) -> Tuple[List[Any], List[str]]:
    """Mask sensitive-looking columns in row dictionaries returned by user SQL.

    This protects query editor responses from obvious credential/PII/payroll
    leakage without mutating the original result object.
    """
    row_list = list(rows or [])
    if enabled is None:
        enabled = sensitive_query_result_masking_enabled()
    if not enabled:
        return row_list, []

    candidate_columns = [str(col) for col in (columns or [])]
    if not candidate_columns:
        for row in row_list:
            if isinstance(row, dict):
                candidate_columns.extend(str(k) for k in row.keys())

    masked_columns = sorted({col for col in candidate_columns if is_sensitive_result_column(col)})
    if not masked_columns:
        return row_list, []

    masked_lookup = set(masked_columns)
    masked_rows: List[Any] = []
    for row in row_list:
        if not isinstance(row, dict):
            masked_rows.append(row)
            continue
        masked_row = dict(row)
        for col in masked_lookup:
            if col in masked_row and masked_row[col] not in (None, ""):
                masked_row[col] = MASKED_VALUE
        masked_rows.append(masked_row)
    return masked_rows, masked_columns

