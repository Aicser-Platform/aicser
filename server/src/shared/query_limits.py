"""
Unified query and row limit constants.

Use these everywhere to avoid scattered magic numbers and inconsistent behavior
between file upload, query execution, chat/analyze, and SQL editor.
"""

# Default limit for SQL queries when none is specified (nl2sql, query optimizer, etc.)
DEFAULT_QUERY_LIMIT = 1000

# Maximum rows returned to the client for a single query (pagination default)
DEFAULT_PAGE_LIMIT = 1000

# Maximum rows when loading file data for query execution (e.g. from Azure Blob)
DEFAULT_FILE_QUERY_LIMIT = 10000

# Maximum rows kept for AI processing (chart/narration) after query execution.
# Descriptive/standard: 1000 is sufficient (charts + narration).
# Predictive: use holistic history for best trend/seasonality; 10k aligns with Prophet limit
#   so we do not cut query result when user has no row limit (daily ~27y, weekly ~192y).
# Diagnostic: root-cause analysis benefits from full breakdown data.
MAX_ROWS_FOR_AI_PROCESSING = 1000
MAX_ROWS_FOR_PREDICTIVE = 10000
MAX_ROWS_FOR_DIAGNOSTIC = 5000
MAX_ROWS_FOR_ANIMATE = 5000

# Sample size stored when processing uploaded files (CSV/Parquet/JSON).
# Stored in DB as sample_data; full file remains in blob storage.
FILE_UPLOAD_SAMPLE_ROWS = 5

# Rows used only for preview in UI (first N rows in response)
PREVIEW_ROWS = 10

# PandasEngine: max rows when no SQL is provided (return dataframe as-is)
PANDAS_FALLBACK_MAX_ROWS = 1000

# Legacy: max sample rows when upload_with_prompt is used (in-memory storage)
UPLOAD_IN_MEMORY_MAX_SAMPLE_ROWS = 10000

# Default for listing endpoints (data sources, conversations, etc.)
DEFAULT_LIST_PAGE_LIMIT = 100

# Max data sources to fetch when checking for duplicate names on upload
MAX_DATA_SOURCES_CHECK = 500

# Default preview_rows in API requests (e.g. snapshot creation)
DEFAULT_PREVIEW_ROWS_REQUEST = 100

# Rows used for AI schema analysis (kept small for token limits)
SCHEMA_SAMPLE_ROWS = 100

# NL2SQL: sample rows + stats per table when building schema context (accuracy + efficiency)
SCHEMA_NL2SQL_SAMPLE_ROWS = 5

# Insights/recommendations: use full query result in LLM prompt when small (better ECharts + insights)
INSIGHTS_FULL_DATA_ROWS = 50  # Send full result when row count <= this; LLM gets complete data for chart+insights
# When result set is larger, send representative sample (capped) + full stats + highlights; we still inject full data into chart
INSIGHTS_SAMPLE_CAP = 50  # Max rows in sample when not using full result
INSIGHTS_HIGHLIGHTS_TOP_N = 5  # Top/bottom N rows by first numeric column for highlights

# Non-streaming API response caps (payload size and metadata)
MAX_RESPONSE_QUERY_RESULT_ROWS = 500  # Above this, return preview + row_count only
RESPONSE_QUERY_RESULT_PREVIEW_ROWS = 50  # Rows to include when result is truncated
MAX_REASONING_STEPS_IN_RESPONSE = 50  # Cap reasoning_steps list length in execution_metadata
MAX_EXECUTION_METADATA_JSON_CHARS = 80_000  # Truncate or drop large metadata if over (0 = no limit)

# User-facing narration / executive summary: keep concise and correct (premium UX)
MAX_NARRATION_WORDS = 300  # Synthesis prompt says "under 300 words"; enforce for display
MAX_NARRATION_CHARS = 2200  # Fallback cap (~300 words); trim to sentence boundary when possible
MAX_INSIGHT_DESCRIPTION_CHARS = 280  # Per insight/rec description for UI (concise)
