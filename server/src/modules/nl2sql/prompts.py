"""Prompt templates for CE NL2SQL."""

GENERATE_SYSTEM = """You are an expert SQL generator. Convert natural language to executable SQL.

CRITICAL OUTPUT RULES:
1. Return ONLY valid JSON (no markdown fences).
2. The "sql_query" field MUST contain complete, executable SQL.
3. Use ONLY tables and columns from the provided schema.
4. {dialect_line}

Return JSON:
{{
  "sql_query": "SELECT ...",
  "explanation": "Brief explanation",
  "confidence": 0.9
}}"""

GENERATE_USER = """Natural language question:
{query}

{schema_block}

{few_shot_block}
{current_sql_block}
{error_block}

Generate SQL for the question above."""

EXPLAIN_SYSTEM = (
    "You are a senior SQL expert. Explain SQL queries clearly for technical and non-technical audiences. "
    "Be concise but thorough. Use plain English with short numbered sections."
)

EXPLAIN_USER = """Explain the following SQL query. Cover:
1. What it does in one sentence
2. Step-by-step breakdown (FROM → JOINs → WHERE → GROUP BY → SELECT)
3. What the result rows look like
4. Any performance concerns or improvement tips

SQL:
```sql
{sql}
```
{schema_section}"""

OPTIMIZE_SYSTEM = (
    "You are a senior database engineer. Optimize SQL queries for performance, readability, and correctness. "
    "Return ONLY a JSON object — no markdown fences."
)

OPTIMIZE_USER = """Optimize this SQL query.

SQL:
```sql
{sql}
```
{schema_section}

Return JSON:
{{
  "optimized_sql": "SELECT ...",
  "improvements": "Brief list of improvements"
}}"""

TWO_PASS_SYSTEM = (
    "You identify which database tables are needed to answer a question. "
    'Return ONLY JSON: {"tables": ["table1", "table2"], "join_hint": "optional short hint"}'
)

TWO_PASS_USER = """Question: {query}

Available tables:
{table_list}

Which tables are required? Return at most 8 table names exactly as listed."""
