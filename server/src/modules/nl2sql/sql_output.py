"""SQL output parsing and validation for CE NL2SQL (ported from EE sql_cleaner subset)."""

from __future__ import annotations

import json
import re
from typing import Optional, Tuple


def check_parentheses_balance(sql: str) -> Tuple[int, int]:
    if not sql or not isinstance(sql, str):
        return 0, 0
    return sql.count("("), sql.count(")")


def sql_looks_truncated(sql: str) -> bool:
    if not sql or not isinstance(sql, str):
        return True
    s = sql.strip()
    if not s:
        return True
    sql_upper = s.upper()
    if "SELECT" in sql_upper and "FROM" not in sql_upper:
        return True
    if s.count("(") != s.count(")"):
        return True
    if s.count("'") % 2 != 0 or s.count('"') % 2 != 0:
        return True
    last_token = s.rstrip().rstrip(";").rstrip()
    if last_token and last_token[-1] in (",", "(", "=", "+", "-", "/", "*"):
        return True
    if re.search(r"\bdate_trunc\s*\(\s*'[^']+'\s*\)", s, re.IGNORECASE):
        return True
    if re.search(r"\bdate_trunc\s*\(\s*'[^']+'\s*,\s*\)", s, re.IGNORECASE):
        return True
    return False


def extract_sql_from_llm_output(text: str) -> str:
    if not text or not isinstance(text, str):
        return ""

    sql_query = text.strip()

    if sql_query.startswith("{"):
        try:
            parsed = json.loads(sql_query)
            if isinstance(parsed, dict):
                extracted = parsed.get("sql_query") or parsed.get("sql")
                if isinstance(extracted, str) and extracted.strip():
                    ext = extracted.strip()
                    if ext.upper().startswith(("SELECT", "WITH")):
                        sql_query = ext
        except (json.JSONDecodeError, TypeError):
            pass

    sql_query = re.sub(r'\s*":\s*FORMAT\s+JSONEachRow.*$', "", sql_query, flags=re.IGNORECASE | re.DOTALL)

    sql_start = re.search(r"\b(SELECT|WITH)\b", sql_query, re.IGNORECASE)
    if sql_start:
        start_pos = sql_start.start()
        paren_depth = 0
        in_string = False
        string_char = None
        end_pos = len(sql_query)

        for i in range(start_pos, len(sql_query)):
            char = sql_query[i]
            if char in ('"', "'") and (i == start_pos or sql_query[i - 1] != "\\"):
                if not in_string:
                    in_string = True
                    string_char = char
                elif char == string_char:
                    in_string = False
                    string_char = None
                continue
            if not in_string:
                if char == "(":
                    paren_depth += 1
                elif char == ")":
                    paren_depth -= 1
                elif paren_depth == 0:
                    remaining = sql_query[i:]
                    if (
                        re.match(r'\s*["\']\s*[,:]\s*["\']', remaining)
                        or re.match(r"\s*\}\s*\]\s*\}", remaining)
                        or re.match(r'\s*":\s*FORMAT', remaining, re.IGNORECASE)
                    ):
                        end_pos = i
                        break

        extracted = sql_query[start_pos:end_pos].strip()
        if extracted and extracted.upper().startswith(("SELECT", "WITH")):
            sql_query = extracted

    sql_query = re.sub(r";\s*$", "", sql_query.strip())
    return sql_query.strip()


def validate_sql_basic(sql: str) -> Tuple[bool, Optional[str]]:
    if not sql or not isinstance(sql, str):
        return False, "SQL query is empty"

    sql_upper = sql.upper().strip()
    if not sql_upper.startswith(("SELECT", "WITH")):
        return False, "SQL query must start with SELECT or WITH"
    if "FROM" not in sql_upper:
        return False, "SQL query must contain FROM clause"

    dangerous_patterns = [
        (r";\s*DROP\s+TABLE", "DROP TABLE detected"),
        (r";\s*DELETE\s+FROM", "DELETE FROM detected"),
        (r";\s*TRUNCATE", "TRUNCATE detected"),
        (r";\s*ALTER\s+TABLE", "ALTER TABLE detected"),
        (r";\s*CREATE\s+TABLE", "CREATE TABLE detected"),
        (r";\s*INSERT\s+INTO", "INSERT INTO detected"),
        (r";\s*UPDATE\s+", "UPDATE detected"),
        (r";\s*EXEC\s*\(", "EXEC detected"),
        (r";\s*EXECUTE\s*\(", "EXECUTE detected"),
    ]
    for pattern, description in dangerous_patterns:
        if re.search(pattern, sql, re.IGNORECASE):
            return False, f"SQL contains dangerous operation: {description}"

    open_count, close_count = check_parentheses_balance(sql)
    if open_count != close_count:
        return False, f"Unbalanced parentheses (open: {open_count}, close: {close_count})"

    return True, None


def parse_json_llm_response(text: str) -> dict:
    """Parse JSON from LLM output, tolerating markdown fences."""
    if not text:
        return {}
    cleaned = text.strip()
    if cleaned.startswith("```"):
        cleaned = re.sub(r"^```(?:json)?\s*", "", cleaned, flags=re.IGNORECASE)
        cleaned = re.sub(r"\s*```\s*$", "", cleaned)
    try:
        data = json.loads(cleaned)
        return data if isinstance(data, dict) else {}
    except json.JSONDecodeError:
        match = re.search(r"\{[\s\S]*\}", cleaned)
        if match:
            try:
                data = json.loads(match.group(0))
                return data if isinstance(data, dict) else {}
            except json.JSONDecodeError:
                pass
    return {}
